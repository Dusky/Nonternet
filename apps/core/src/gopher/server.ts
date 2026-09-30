import { createReadStream } from 'node:fs';
import net from 'node:net';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import * as boards from '../boards';
import * as files from '../files';
import { directory } from '../homes/service';
import { wrapForTerminal } from '../text';

// A read-only Gopher mirror (RFC 1436; docs/05, M7). Everything here is what a logged-out visitor
// sees on the web: public boards and their threads, the homepage directory, public file areas. It
// reads core's database through the same functions as the web API, with no viewer, so it can never
// show more than the web does. No input is ever stored.
//
// Selectors:  ""  /boards  /boards/{slug}  /boards/{slug}/{threadId}  /homes  /files  /files/{slug}  /files/{slug}/{fileId}

const MAX_SELECTOR = 512;
const TIMEOUT_MS = 10_000;
export const MAX_CONNECTIONS = 100;

type Line = { type: string; text: string; selector?: string; host?: string; port?: number };
export type GopherReply = { kind: 'menu'; lines: Line[] } | { kind: 'text'; text: string } | { kind: 'file'; path: string };

// Menu text can't hold tabs or line breaks; everything else passes through as UTF-8.
const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
const info = (text: string): Line => ({ type: 'i', text });
const err = (text: string): Line => ({ type: '3', text });

export function renderMenu(deps: AppDeps, lines: Line[]): string {
  const host = deps.config.gopher.host ?? deps.config.site.domain;
  const port = deps.config.gopher.port;
  const out = lines.map((l) => l.type === 'i' || l.type === '3'
    ? `${l.type}${clean(l.text)}\tfake\t(NULL)\t0`
    : `${l.type}${clean(l.text)}\t${clean(l.selector ?? '')}\t${l.host ?? host}\t${l.port ?? port}`);
  return `${out.join('\r\n')}\r\n.\r\n`;
}

// An external web link, the common "URL:" convention (type h).
const web = (text: string, url: string): Line => ({ type: 'h', text, selector: `URL:${url}` });

export async function answer(deps: AppDeps, raw: string): Promise<GopherReply> {
  const selector = raw.split('\t')[0]!.trim();
  const parts = selector.split('/').filter(Boolean);
  const site = deps.config.site;
  try {
    if (parts.length === 0) {
      return { kind: 'menu', lines: [
        info(site.name), info(''),
        info('A read-only mirror of the public parts of the site.'), info(''),
        { type: '1', text: 'Boards', selector: '/boards' },
        { type: '1', text: 'Homepages', selector: '/homes' },
        { type: '1', text: 'File areas', selector: '/files' },
        info(''),
        web(`The full site: ${deps.publicUrl}`, deps.publicUrl),
      ] };
    }
    const [section, slug, id, ...rest] = parts;
    if (rest.length) return notFound();
    if (section === 'boards' && !slug) {
      const { boards: list } = await boards.listBoards(deps, null);
      const shown = list.filter((b) => !b.hidden); // already only what a visitor may read
      return { kind: 'menu', lines: [info('Boards'), info(''), ...(shown.length ? shown.map((b) => ({ type: '1', text: `${b.name} (${b.thread_count} threads)${b.archived ? ' [archived]' : ''}`, selector: `/boards/${b.slug}` })) : [info('No public boards yet.')])] };
    }
    if (section === 'boards' && slug && !id) {
      const b = await boards.getBoard(deps, null, slug);
      const { threads } = await boards.listThreads(deps, null, slug, { limit: 100 });
      const ok = threads.filter((th) => th.state === 'ok');
      return { kind: 'menu', lines: [
        info(b.name), ...(b.description ? [info(b.description)] : []), info(''),
        ...(ok.length ? ok.map((th) => ({ type: '0', text: `${th.subject} - ${th.author?.handle ?? 'deleted account'}, ${th.reply_count} replies, ${th.last_post_at.slice(0, 10)}`, selector: `/boards/${slug}/${th.id}` })) : [info('No threads yet.')]),
        info(''), web('Read and reply on the web', `${deps.publicUrl}/boards/${slug}`),
      ] };
    }
    if (section === 'boards' && slug && id) {
      const posts = [];
      let after: number | undefined;
      for (let page = 0; page < 20; page++) { // at most 2,000 posts; very long threads end with a link to the web
        const r = await boards.getThread(deps, null, slug, id, { after, limit: 100 });
        posts.push(...r.posts);
        if (r.next === null) break;
        after = r.next;
      }
      const rule = '-'.repeat(79);
      const body = posts.map((p) => {
        const who = p.author?.handle ?? 'deleted account';
        const head = `${p.subject || ''}\r\nFrom: ${who}   Date: ${p.posted_at.slice(0, 16).replace('T', ' ')} UTC`;
        const text = p.state === 'ok' && p.body !== null ? wrapForTerminal(p.body).join('\r\n') : `[${p.state === 'hidden' ? 'hidden by a moderator' : p.state === 'removed' ? 'removed by a moderator' : 'deleted'}]`;
        return `${head}\r\n\r\n${text}`;
      }).join(`\r\n${rule}\r\n`);
      return { kind: 'text', text: `${body}\r\n${rule}\r\nOn the web: ${deps.publicUrl}/boards/${slug}/t/${id}\r\n` };
    }
    if (section === 'homes' && !slug) {
      const { homepages } = await directory(deps, { sort: 'name', limit: 60 });
      return { kind: 'menu', lines: [info('Homepages'), info('These open in a web browser.'), info(''),
        ...(homepages.length ? homepages.map((h) => web(`${h.title || h.handle} (${h.handle})`, h.url)) : [info('No homepages yet.')])] };
    }
    if (section === 'files' && !slug) {
      const areas = await files.listAreas(deps, null);
      return { kind: 'menu', lines: [info('File areas'), info(''), ...(areas.length ? areas.map((a) => ({ type: '1', text: `${a.name} (${a.file_count} files)`, selector: `/files/${a.slug}` })) : [info('No file areas yet.')])] };
    }
    if (section === 'files' && slug && !id) {
      const { area, files: list } = await files.areaWithFiles(deps, null, slug);
      return { kind: 'menu', lines: [
        info(area.name), ...(area.description ? [info(area.description)] : []), info(''),
        ...(list.length ? list.map((f) => ({ type: '9', text: `${f.name} - ${Math.max(1, Math.round(f.size_bytes / 1024))} KB${f.title ? ` - ${f.title}` : ''}`, selector: `/files/${slug}/${f.id}` })) : [info('No files here yet.')]),
      ] };
    }
    if (section === 'files' && slug && id) {
      const f = await files.getFile(deps, null, id);
      if (f.area !== slug) return notFound();
      const d = await files.openForDownload(deps, null, id);
      return { kind: 'file', path: d.path };
    }
    return notFound();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return notFound();
    throw e;
  }
}
const notFound = (): GopherReply => ({ kind: 'menu', lines: [err('Nothing here. Try the main menu.'), { type: '1', text: 'Main menu', selector: '' }] });

export function buildGopherServer(deps: AppDeps, log: (m: string) => void = () => undefined): net.Server {
  const server = net.createServer((sock) => {
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy());
    sock.on('error', () => undefined);
    let buf = '';
    let done = false;
    sock.on('data', (chunk) => {
      if (done) return;
      buf += chunk.toString('utf8');
      if (buf.length > MAX_SELECTOR) { done = true; sock.end(renderMenu(deps, [err('That request is too long.')])); return; }
      const nl = buf.search(/\r?\n/);
      if (nl < 0) return;
      done = true;
      answer(deps, buf.slice(0, nl)).then((r) => {
        if (r.kind === 'menu') sock.end(renderMenu(deps, r.lines));
        else if (r.kind === 'text') sock.end(`${r.text.replace(/^\./gm, '..')}\r\n.\r\n`);
        else createReadStream(r.path).on('error', () => sock.destroy()).pipe(sock);
      }).catch((e) => {
        log(`gopher: ${e instanceof Error ? e.message : String(e)}`);
        sock.end(renderMenu(deps, [err('Something went wrong. Try again later.')]));
      });
    });
  });
  server.maxConnections = MAX_CONNECTIONS;
  return server;
}

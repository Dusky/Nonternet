import tls from 'node:tls';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import * as boards from '../boards';
import * as files from '../files';
import { directory } from '../homes/service';
import { publicProfile } from '../characters';
import * as wiki from '../wiki';
import { describeImages, parseWiki, type Inline } from '@app/shared';
import type { GeminiCert } from './cert';

// A read-only Gemini mirror (gemini://, docs/05, decided 2026-10-05). It shows what the Gopher mirror shows (public
// boards and threads, the homepage directory, public file areas) plus people's profiles and .plans, through the same
// core functions as the web with no viewer, so never more than a logged-out visitor sees. Nothing is ever stored.
//
// Paths:  /  /boards/  /boards/{slug}/  /boards/{slug}/{threadId}  /homes/  /files/  /files/{slug}/  /~{handle}
//         /wiki/  /wiki/{slug}  /wiki/changes  (the site wiki)

const MAX_REQUEST = 1024;
const TIMEOUT_MS = 10_000;
export const MAX_CONNECTIONS = 100;
const PER_ADDRESS = 10;

export type GeminiReply = { status: number; meta: string; body?: string };
const ok = (body: string[]): GeminiReply => ({ status: 20, meta: 'text/gemini; lang=en', body: `${body.join('\n')}\n` });
const notFound = (): GeminiReply => ({ status: 51, meta: 'Nothing here' });

// A line of gemtext that came from someone: on one line, and never read as a link, heading, list or quote marker.
const oneLine = (s: string) => s.replace(/[\p{C}]+/gu, ' ').trim();
const link = (url: string, text: string) => `=> ${url} ${oneLine(text)}`;
// A post or a plan: every line quoted, so nothing in it can become gemtext of its own.
const quoted = (text: string) => text.split('\n').map((l) => `> ${l.replace(/[\p{C}]+/gu, '')}`);

export async function answer(deps: AppDeps, raw: string): Promise<GeminiReply> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { status: 59, meta: 'That is not a gemini:// address' }; }
  if (url.protocol !== 'gemini:') return { status: 59, meta: 'Only gemini:// addresses are served here' };
  const host = (deps.config.gemini.host ?? deps.config.site.domain).toLowerCase();
  if (url.hostname.toLowerCase() !== host) return { status: 53, meta: `This server only serves ${host}` };
  const path = decodeURIComponent(url.pathname || '/');
  const site = deps.config.site;
  try {
    if (path === '/' || path === '') {
      return ok([
        `# ${oneLine(site.name)}`, '',
        'A read-only mirror of the public parts of the site.', '',
        link('/boards/', 'Boards'), link('/wiki/', 'Wiki'), link('/homes/', 'Homepages'), link('/files/', 'File areas'), '',
        'Read someone\'s profile and plan at /~handle.', '',
        link(`${deps.publicUrl}/`, 'The full site, on the web'),
      ]);
    }
    const person = /^\/~([A-Za-z][A-Za-z0-9_-]{0,19})\/?$/.exec(path);
    if (person) {
      const p = await publicProfile(deps, person[1]!);
      return ok([
        `# ${oneLine(p.display_name || p.handle)}`,
        ...(p.display_name ? [`@${p.handle}`] : []),
        ...(p.status_line ? [oneLine(p.status_line)] : []),
        ...(p.pronouns ? [`Pronouns: ${oneLine(p.pronouns)}`] : []),
        ...(p.location ? [`Location: ${oneLine(p.location)}`] : []),
        ...(p.bio ? ['', ...quoted(p.bio)] : []),
        ...p.links.map((l) => link(l.url, oneLine(l.label || l.url))),
        '', '## Plan', ...(p.plan ? quoted(p.plan) : ['No plan.']), '',
        ...(p.homepage_url ? [link(p.homepage_url, 'Homepage (on the web)')] : []),
        link(`${deps.publicUrl}/people/${encodeURIComponent(p.handle)}`, 'Profile on the web'),
        link('/', 'Home'),
      ]);
    }
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'wiki') return await wikiPage(deps, parts.slice(1));
    const [section, slug, id, ...rest] = parts;
    if (rest.length) return notFound();
    if (section === 'boards' && !slug) {
      const { boards: list } = await boards.listBoards(deps, null);
      const shown = list.filter((b) => !b.hidden);
      return ok(['# Boards', '', ...(shown.length ? shown.map((b) => link(`/boards/${b.slug}/`, `${b.name} (${b.thread_count} threads)${b.archived ? ' [archived]' : ''}`)) : ['No public boards yet.']), '', link('/', 'Home')]);
    }
    if (section === 'boards' && slug && !id) {
      const b = await boards.getBoard(deps, null, slug);
      const { threads } = await boards.listThreads(deps, null, slug, { limit: 100 });
      const shown = threads.filter((th) => th.state === 'ok');
      return ok([
        `# ${oneLine(b.name)}`, ...(b.description ? [oneLine(b.description)] : []), '',
        ...(shown.length ? shown.map((th) => link(`/boards/${slug}/${th.id}`, `${th.last_post_at.slice(0, 10)} ${th.subject} - ${th.author?.handle ?? 'deleted account'}, ${th.reply_count} replies`)) : ['No threads yet.']),
        '', link(`${deps.publicUrl}/boards/${slug}`, 'Read and reply on the web'), link('/boards/', 'All boards'),
      ]);
    }
    if (section === 'boards' && slug && id) {
      const posts = [];
      let after: number | undefined;
      for (let page = 0; page < 20; page++) {
        const r = await boards.getThread(deps, null, slug, id, { after, limit: 100 });
        posts.push(...r.posts);
        if (r.next === null) break;
        after = r.next;
      }
      const lines = [`# ${oneLine(posts[0]?.subject || 'Thread')}`, ''];
      for (const p of posts) {
        lines.push(`## ${p.author?.handle ?? 'deleted account'}, ${p.posted_at.slice(0, 16).replace('T', ' ')} UTC`);
        lines.push(...(p.state === 'ok' && p.body !== null ? quoted(describeImages(p.body, deps.publicUrl)) : [`[${p.state === 'hidden' ? 'hidden by a moderator' : p.state === 'removed' ? 'removed by a moderator' : 'deleted'}]`]), '');
      }
      lines.push(link(`${deps.publicUrl}/boards/${slug}/t/${id}`, 'Reply on the web'), link(`/boards/${slug}/`, 'Back to the board'));
      return ok(lines);
    }
    if (section === 'homes' && !slug) {
      const { homepages } = await directory(deps, { sort: 'name', limit: 60 });
      return ok(['# Homepages', 'These open in a web browser.', '', ...(homepages.length ? homepages.map((h) => link(h.url, `${h.title || h.handle} (${h.handle})`)) : ['No homepages yet.']), '', link('/', 'Home')]);
    }
    if (section === 'files' && !slug) {
      const areas = await files.listAreas(deps, null);
      return ok(['# File areas', '', ...(areas.length ? areas.map((a) => link(`/files/${a.slug}/`, `${a.name} (${a.file_count} files)`)) : ['No file areas yet.']), '', link('/', 'Home')]);
    }
    if (section === 'files' && slug && !id) {
      const { area, files: list } = await files.areaWithFiles(deps, null, slug);
      return ok([
        `# ${oneLine(area.name)}`, ...(area.description ? [oneLine(area.description)] : []), 'Files download on the web.', '',
        ...(list.length ? list.map((f) => link(`${deps.publicUrl}/files/${slug}`, `${f.name} - ${Math.max(1, Math.round(f.size_bytes / 1024))} KB${f.title ? ` - ${f.title}` : ''}`)) : ['No files here yet.']),
        '', link('/files/', 'All file areas'),
      ]);
    }
    return notFound();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return notFound();
    throw e;
  }
}

// A wiki page as gemtext. Headings and lists map straight across; gemtext links are lines of their own, so the
// links in a paragraph, list or quote follow it. Code blocks are preformatted, and nothing the writer typed can open
// or close one early.
export function wikiGemtext(body: string, base: string, missing: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const text = (segs: Inline[]) => oneLine(segs.map((s) => s.text).join(''));
  const links = (segs: Inline[]) => segs.flatMap((s) => s.kind === 'wiki' ? [missing.has(s.slug) ? `${oneLine(s.text)} (no page yet)` : link(`${base}${s.slug}`, s.text)] : s.kind === 'link' ? [link(s.href, s.text)] : []);
  // A line from a page never starts with a gemtext marker of its own.
  const plain = (s: string) => (/^(=>|#|\* |>|```)/.test(s) ? ` ${s}` : s);
  for (const b of parseWiki(body)) {
    if (b.kind === 'heading') out.push(`${'#'.repeat(Math.min(3, b.level + 1))} ${text(b.content)}`);
    else if (b.kind === 'paragraph') out.push(plain(text(b.content)), ...links(b.content));
    else if (b.kind === 'list') out.push(...b.items.map((it, i) => (b.ordered ? plain(`${i + 1}. ${text(it)}`) : `* ${text(it)}`)), ...b.items.flatMap(links));
    else if (b.kind === 'quote') out.push(...b.content.map((q) => `> ${text(q)}`), ...b.content.flatMap(links));
    else out.push('```', ...b.text.split('\n').map((l) => (l.startsWith('```') ? ` ${l}` : l.replace(/[\p{Cc}]+/gu, ''))), '```');
    out.push('');
  }
  return out;
}

async function wikiPage(deps: AppDeps, rest: string[]): Promise<GeminiReply> {
  const [slug, ...more] = rest;
  if (more.length) return notFound();
  if (!slug) {
    const pages = await wiki.listPages(deps, null, 'site');
    return ok(['# Wiki', '', link('/wiki/changes', 'Recent changes'), '', '## All pages',
      ...(pages.length ? pages.map((p) => link(`/wiki/${p.slug}`, p.title)) : ['This wiki has no pages yet.']), '', link('/', 'Home')]);
  }
  if (slug === 'changes') {
    const list = await wiki.changes(deps, null, 'site', 100);
    return ok(['# Recent changes', '', ...(list.length ? list.map((c) => link(`/wiki/${c.page.slug}`,
      `${c.created_at.slice(0, 16).replace('T', ' ')} ${c.page.title} - ${c.editor?.handle ?? 'deleted account'}${c.created ? ', new page' : c.reverted_to ? `, put back revision ${c.reverted_to}` : c.summary ? `: ${c.summary}` : ''}`)) : ['Nothing has changed yet.']),
      '', link('/wiki/', 'All pages')]);
  }
  const p = await wiki.getPage(deps, null, 'site', slug);
  if (p.redirected_from) return { status: 31, meta: `/wiki/${p.slug}` };
  return ok([`# ${oneLine(p.title)}`, `Revision ${p.revision}, ${p.updated_at.slice(0, 10)}${p.updated_by ? ` by ${p.updated_by.handle}` : ''}`, '',
    ...wikiGemtext(p.body, '/wiki/', new Set(p.links.filter((l) => !l.exists).map((l) => l.slug))),
    link(`${deps.publicUrl}/wiki/p/${p.slug}`, 'Edit or see the history on the web'), link('/wiki/', 'All pages')]);
}

export const render = (r: GeminiReply): string => `${r.status} ${r.meta}\r\n${r.status === 20 ? r.body ?? '' : ''}`;

export interface GeminiServer { server: tls.Server; reload: (c: GeminiCert) => void }

export function buildGeminiServer(deps: AppDeps, cert: GeminiCert, log: (m: string) => void = () => undefined): GeminiServer {
  const perAddress = new Map<string, number>();
  const server = tls.createServer({ cert: cert.cert, key: cert.key, minVersion: 'TLSv1.2' }, (sock) => {
    const addr = sock.remoteAddress ?? '';
    const n = (perAddress.get(addr) ?? 0) + 1;
    perAddress.set(addr, n);
    sock.once('close', () => { const left = (perAddress.get(addr) ?? 1) - 1; if (left > 0) perAddress.set(addr, left); else perAddress.delete(addr); });
    if (n > PER_ADDRESS) { sock.end(render({ status: 44, meta: '30' })); return; } // "slow down", try again in 30 s
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy());
    sock.on('error', () => undefined);
    let buf = '';
    let done = false;
    sock.on('data', (chunk) => {
      if (done) return;
      buf += chunk.toString('utf8');
      if (Buffer.byteLength(buf) > MAX_REQUEST + 2) { done = true; sock.end(render({ status: 59, meta: 'That request is too long' })); return; }
      const nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      done = true;
      answer(deps, buf.slice(0, nl)).then((r) => sock.end(render(r))).catch((e) => {
        log(`gemini: ${e instanceof Error ? e.message : String(e)}`);
        sock.end(render({ status: 40, meta: 'Something went wrong. Try again later' }));
      });
    });
  });
  server.on('tlsClientError', () => undefined);
  server.maxConnections = MAX_CONNECTIONS;
  return { server, reload: (c) => server.setSecureContext({ cert: c.cert, key: c.key }) };
}

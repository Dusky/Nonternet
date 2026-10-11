import { BOOKMARK_DESCRIPTION_MAX, BOOKMARK_TITLE_MAX, bookmarkCreateSchema, type BookmarkImportResult } from '@app/shared';
import type { SessionUser } from './accounts';
import { addBookmark, plainText } from './bookmarks';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// Importing a bookmarks file from a browser or from Linkding (docs/21, B4). Both write the Netscape bookmark format: HTML where each
// link is <A HREF ADD_DATE TAGS>, an optional <DD> after it holds a description, and <H3> names the folder the links
// after it are in. (Linkding writing this format was checked 2026-10-11; Linkwarden's JSON could not be, so it is not read.)
// Nothing here fetches a page: titles come from the file, and everything arrives private.

// Inline formatting inside a title or note (<b>, <i>) is dropped without leaving a gap; anything else becomes a space.
const text = (s: string, max: number) => plainText(s.replace(/<\/?(?:b|i|em|strong|u|s|span|font|code|small|big|sup|sub)\b[^>]*>/gi, ''), max);

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export interface ParsedBookmark { url: string; title: string; description: string; tags: string[]; created_at: Date | null }

const tagText = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined) ?? null;

// Reads the file as a list of links. It scans for the few tags that matter rather than building a page, so odd or broken
// HTML still gives up the links it has. Only http and https addresses are kept.
export function parseNetscape(html: string): ParsedBookmark[] {
  const out: ParsedBookmark[] = [];
  const folders: string[] = [];
  const folderDepths: number[] = [];
  let depth = 0;
  let pendingFolder: string | null = null;
  const lower = html.toLowerCase();
  const re = /<(\/?)(dl|h3|a|dd)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m: RegExpExecArray | null;
  let last: ParsedBookmark | null = null;
  while ((m = re.exec(html))) {
    const close = m[1] === '/', name = m[2]!.toLowerCase(), rest = m[3] ?? '';
    // The text belonging to this tag runs to where the next link, folder or list begins (inline tags like <b> stay inside it).
    const stops = name === 'h3' ? ['</h3'] : name === 'a' ? ['</a', '<a ', '<dt', '<dd', '<dl', '</dl'] : ['<dt', '<dd', '<dl', '</dl'];
    const end = Math.min(...stops.map((x) => { const i = lower.indexOf(x, re.lastIndex); return i === -1 ? html.length : i; }));
    const inner = html.slice(re.lastIndex, end);
    if (name === 'dl') {
      if (!close) { depth += 1; if (pendingFolder !== null) { folders.push(pendingFolder); folderDepths.push(depth); pendingFolder = null; } }
      else { if (folderDepths.at(-1) === depth) { folders.pop(); folderDepths.pop(); } depth = Math.max(0, depth - 1); }
    } else if (name === 'h3' && !close) {
      pendingFolder = text(inner, 60);
    } else if (name === 'a' && !close) {
      const href = (attr(rest, 'href') ?? '').trim();
      let ok = false;
      try { const u = new URL(href); ok = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { /* not an address */ }
      if (!ok) { last = null; continue; }
      const fromAttr = (attr(rest, 'tags') ?? '').split(',').map(tagText);
      const folder = folders.length ? tagText(folders[folders.length - 1]!) : '';
      const tags = [...new Set([...fromAttr, folder].filter((t) => /^[a-z0-9][a-z0-9-]{1,19}$/.test(t)))].slice(0, 5);
      const added = Number(attr(rest, 'add_date'));
      last = {
        url: href, title: text(inner, BOOKMARK_TITLE_MAX), description: '', tags,
        created_at: Number.isFinite(added) && added > 0 && added < 4e9 ? new Date(added * 1000) : null,
      };
      out.push(last);
    } else if (name === 'dd' && !close && last) {
      last.description = text(inner, BOOKMARK_DESCRIPTION_MAX);
      last = null;
    }
  }
  return out;
}

// The other way: every bookmark as a Netscape file that browsers (and the importer above) read. Tags go in TAGS, the
// description in <DD>, the date saved in ADD_DATE. Everything is escaped; nothing from a bookmark becomes markup.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toNetscape(items: { url: string; title: string; description: string; tags: string[]; created_at: string }[]): string {
  const lines = items.map((b) => {
    const added = Math.floor(Date.parse(b.created_at) / 1000);
    const tags = b.tags.length ? ` TAGS="${esc(b.tags.join(','))}"` : '';
    const dd = b.description ? `\n<DD>${esc(b.description)}` : '';
    return `<DT><A HREF="${esc(b.url)}" ADD_DATE="${added}"${tags}>${esc(b.title)}</A>${dd}`;
  });
  return ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>', ...lines, '</DL><p>', ''].join('\n');
}

export async function importFile(deps: AppDeps, v: SessionUser, bytes: Buffer): Promise<BookmarkImportResult> {
  if (!bytes.length) throw new ApiError(400, 'empty', 'Choose a bookmarks file to import.');
  if (bytes.length > IMPORT_MAX_BYTES) throw new ApiError(413, 'too_big', 'That file is too big. Bookmark files can be up to 5 MB.');
  const items = parseNetscape(bytes.toString('utf8'));
  if (!items.length) throw new ApiError(400, 'no_bookmarks', 'No bookmarks found in that file. Export them from your browser as an HTML file and try again.');
  const result: BookmarkImportResult = { added: 0, existing: 0, invalid: 0, too_many: 0 };
  for (const [i, x] of items.entries()) {
    const parsed = bookmarkCreateSchema.safeParse({ url: x.url, title: x.title || undefined, description: x.description, tags: x.tags });
    if (!parsed.success) { result.invalid += 1; continue; }
    try {
      const r = await addBookmark(deps, v, parsed.data, { fetch: false });
      if (r.existing) { result.existing += 1; continue; }
      result.added += 1;
      if (x.created_at) await deps.db.query(`UPDATE bookmarks SET created_at = $2 WHERE id = $1`, [r.bookmark.id, x.created_at]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'too_many') { result.too_many = items.length - i; break; }
      result.invalid += 1;
    }
  }
  return result;
}

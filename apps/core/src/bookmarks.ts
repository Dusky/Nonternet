import sharp from 'sharp';
import {
  BOOKMARKS_MAX, BOOKMARK_DESCRIPTION_MAX, BOOKMARK_TITLE_MAX, bookmarkKey,
  type BookmarkPage, type BookmarkView, type BookmarkVisibility,
} from '@app/shared';
import type { z } from 'zod';
import { bookmarkCreateSchema, type bookmarkListQuerySchema, type bookmarkUpdateSchema } from '@app/shared';
import type { SessionUser } from './accounts';
import { isMember } from './boards';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { safeFetch } from './safe-fetch';
import type { Queryable } from './db';

// Bookmarks (docs/21): a person's saved links. The site keeps the address, a title, a description and a small icon. It
// reads the top of the page once to fill those in, keeps only plain text from it, and never keeps a copy of the page.

const PAGE_BYTES = 512 * 1024;     // the title and icon links are near the top
const ICON_BYTES = 200 * 1024;
const ICON_SIZE = 32;

interface Row {
  id: string; url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility;
  ring_slug: string | null; ring_name: string | null; has_icon: boolean; created_at: Date; updated_at: Date; link_ok: boolean | null; checked_at: Date | null;
}
const COLUMNS = `b.id, b.url, b.title, b.description, b.tags, b.pinned, b.visibility, g.slug AS ring_slug, g.name AS ring_name,
  b.favicon IS NOT NULL AS has_icon, b.created_at, b.updated_at, b.link_ok, b.checked_at`;
const FROM = `FROM bookmarks b LEFT JOIN rings g ON g.id = b.ring_id`;

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const toView = (r: Row): BookmarkView => ({
  id: r.id, url: r.url, title: r.title, description: r.description, tags: r.tags, pinned: r.pinned, visibility: r.visibility,
  ring: r.ring_slug ? { slug: r.ring_slug, name: r.ring_name! } : null, host: hostOf(r.url), has_icon: r.has_icon,
  created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(), link_ok: r.link_ok, checked_at: r.checked_at?.toISOString() ?? null,
});

function mustBeMember(v: SessionUser): void {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
}
const notFound = () => new ApiError(404, 'not_found', 'There is no such bookmark.');

// ---------------------------------------------------------------- reading the page

// Plain text only: entities decoded, tags and control characters gone, spaces squeezed.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', copy: '©', reg: '®', trade: '™' };
export function plainText(s: string, max: number): string {
  const decoded = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' ';
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  // eslint-disable-next-line no-control-regex
  const clean = decoded.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, max).join('');
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined) ?? null;

export interface PageInfo { title: string; description: string; icons: string[] }
// What a page says about itself, from its HTML. Pure, so it can be tested without the network.
export function readPage(html: string, base: string): PageInfo {
  const head = html.slice(0, PAGE_BYTES);
  // A tag ends at the first > outside quotes.
  const tags = (name: string) => head.match(new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi')) ?? [];
  const metas = tags('meta');
  const meta = (...names: string[]) => {
    for (const n of names) {
      for (const m of metas) {
        const key = (attr(m, 'property') ?? attr(m, 'name') ?? '').toLowerCase();
        if (key === n) { const c = attr(m, 'content'); if (c?.trim()) return c; }
      }
    }
    return '';
  };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const title = plainText(meta('og:title', 'twitter:title') || titleTag, BOOKMARK_TITLE_MAX);
  const description = plainText(meta('description', 'og:description', 'twitter:description'), BOOKMARK_DESCRIPTION_MAX);
  const icons: { href: string; rank: number }[] = [];
  for (const l of tags('link')) {
    const rel = (attr(l, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(l, 'href');
    if (!href) continue;
    // Prefer PNG and SVG-free icons near our size; apple-touch icons are always PNG.
    const type = (attr(l, 'type') ?? '').toLowerCase();
    let rank = -1;
    if (rel.includes('icon')) rank = type.includes('svg') || /\.svg(\?|$)/i.test(href) ? -1 : 2;
    if (rel.includes('apple-touch-icon')) rank = 1;
    if (rank < 0) continue;
    try { icons.push({ href: new URL(plainText(href, 2000), base).toString(), rank }); } catch { /* a broken address */ }
  }
  icons.sort((a, b) => b.rank - a.rank);
  let fallback: string | null = null;
  try { fallback = new URL('/favicon.ico', base).toString(); } catch { /* none */ }
  return { title, description, icons: [...new Set([...icons.map((i) => i.href), ...(fallback ? [fallback] : [])])].filter((u) => /^https?:/.test(u)) };
}

// An .ico file is a small directory of pictures. Modern ones hold PNGs, which sharp can read; older bitmap entries are
// skipped (no icon is better than a broken one).
export function pngFromIco(data: Buffer): Buffer | null {
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null;
  const count = data.readUInt16LE(4);
  let best: Buffer | null = null, bestSize = 0;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= data.length; i++) {
    const e = 6 + i * 16;
    const w = data[e] || 256;
    const len = data.readUInt32LE(e + 8), off = data.readUInt32LE(e + 12);
    if (off + len > data.length || len < 8) continue;
    const img = data.subarray(off, off + len);
    if (img.readUInt32BE(0) !== 0x89504e47) continue;
    if (!best || Math.abs(w - ICON_SIZE) < Math.abs(bestSize - ICON_SIZE)) { best = img; bestSize = w; }
  }
  return best;
}

async function iconFrom(data: Buffer): Promise<Buffer | null> {
  const png = pngFromIco(data);
  try {
    const img = sharp(png ?? data, { limitInputPixels: 4_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) return null;
    return await img.resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

export interface Fetched { title: string; description: string; icon: Buffer | null }
// Reads the page once. Any failure leaves what it could not find empty; the bookmark is saved anyway.
export async function fetchPage(deps: AppDeps, url: string): Promise<Fetched> {
  const allowPrivate = deps.allowPrivateFetch;
  let info: PageInfo = { title: '', description: '', icons: [] };
  try {
    const f = await safeFetch(url, { maxBytes: PAGE_BYTES, truncate: true, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', allowPrivate, timeoutMs: 8000 });
    if (/html|xml/i.test(f.contentType) || !f.contentType) {
      const charset = /charset=["']?([\w-]+)/i.exec(f.contentType)?.[1] ?? 'utf-8';
      let html: string;
      try { html = new TextDecoder(charset).decode(f.data); } catch { html = f.data.toString('utf8'); }
      info = readPage(html, f.finalUrl);
    } else {
      info = readPage('', f.finalUrl);
    }
  } catch {
    try { info = readPage('', url); } catch { /* no icon either */ }
  }
  let icon: Buffer | null = null;
  for (const href of info.icons.slice(0, 3)) {
    try {
      const f = await safeFetch(href, { maxBytes: ICON_BYTES, accept: 'image/*', allowPrivate, timeoutMs: 5000 });
      icon = await iconFrom(f.data);
      if (icon) break;
    } catch { /* try the next one */ }
  }
  return { title: info.title, description: info.description, icon };
}

// ---------------------------------------------------------------- the person's own bookmarks

export async function getBookmark(deps: AppDeps, v: SessionUser, id: string, q: Queryable = deps.db): Promise<BookmarkView> {
  const r = await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.id = $1 AND b.user_id = $2`, [id, v.userId]);
  if (!r.rows[0]) throw notFound();
  return toView(r.rows[0]);
}

// Saves a link. An address they already have (compared without the fragment and tracking parameters) gives back the
// bookmark they have, unchanged, with `existing: true`.
export async function addBookmark(deps: AppDeps, v: SessionUser, input: z.infer<typeof bookmarkCreateSchema>, opts: { fetch?: boolean } = {}): Promise<{ bookmark: BookmarkView; existing: boolean }> {
  mustBeMember(v);
  const key = bookmarkKey(input.url);
  const had = await deps.db.query<{ id: string }>(`SELECT id FROM bookmarks WHERE user_id = $1 AND url_key = $2`, [v.userId, key]);
  if (had.rows[0]) return { bookmark: await getBookmark(deps, v, had.rows[0].id), existing: true };
  const count = await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks WHERE user_id = $1`, [v.userId]);
  if (Number(count.rows[0]!.n) >= BOOKMARKS_MAX) throw new ApiError(409, 'too_many', `You can keep up to ${BOOKMARKS_MAX.toLocaleString('en')} bookmarks. Remove some to add more.`);
  // What the person typed wins; the page fills in the rest.
  const page = opts.fetch === false || (input.title && input.description !== undefined) ? null : await fetchPage(deps, input.url);
  const id = newId('bm');
  const title = input.title || page?.title || hostOf(input.url) + new URL(input.url).pathname.replace(/\/$/, '');
  try {
    await deps.db.query(
      `INSERT INTO bookmarks (id, user_id, url, url_key, title, description, tags, pinned, visibility, favicon) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'private', $9)`,
      [id, v.userId, input.url, key, [...title].slice(0, BOOKMARK_TITLE_MAX).join(''), input.description ?? page?.description ?? '', input.tags, input.pinned, page?.icon ?? null]);
  } catch (e) {
    // Saved twice at once: give back the one that won.
    if ((e as { code?: string }).code === '23505') {
      const r = await deps.db.query<{ id: string }>(`SELECT id FROM bookmarks WHERE user_id = $1 AND url_key = $2`, [v.userId, key]);
      if (r.rows[0]) return { bookmark: await getBookmark(deps, v, r.rows[0].id), existing: true };
    }
    throw e;
  }
  return { bookmark: await getBookmark(deps, v, id), existing: false };
}

export async function updateBookmark(deps: AppDeps, v: SessionUser, id: string, input: z.infer<typeof bookmarkUpdateSchema>): Promise<BookmarkView> {
  const sets: string[] = [];
  const params: unknown[] = [id, v.userId];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.url !== undefined) {
    const key = bookmarkKey(input.url);
    const clash = await deps.db.query(`SELECT 1 FROM bookmarks WHERE user_id = $1 AND url_key = $2 AND id <> $3`, [v.userId, key, id]);
    if (clash.rowCount) throw new ApiError(409, 'duplicate', 'You already have a bookmark for that address.');
    set('url', input.url); set('url_key', key);
  }
  if (input.title !== undefined) set('title', input.title);
  if (input.description !== undefined) set('description', input.description);
  if (input.tags !== undefined) set('tags', input.tags);
  if (input.pinned !== undefined) set('pinned', input.pinned);
  const r = await deps.db.query(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, params);
  if (!r.rowCount) throw notFound();
  return getBookmark(deps, v, id);
}

export async function deleteBookmark(deps: AppDeps, v: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(`DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, [id, v.userId]);
  if (!r.rowCount) throw notFound();
}

// Newest first, or the best matches first when searching. The cursor is the last row's time and id.
export async function listBookmarks(deps: AppDeps, v: SessionUser, query: z.infer<typeof bookmarkListQuerySchema>): Promise<BookmarkPage> {
  const where = ['b.user_id = $1'];
  const params: unknown[] = [v.userId];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
  if (query.tag) add('? = ANY(b.tags)', query.tag);
  if (query.pinned !== undefined) add('b.pinned = ?', query.pinned);
  if (query.q) add(`b.search @@ websearch_to_tsquery('simple', ?)`, query.q);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks b WHERE ${where.join(' AND ')}`, params)).rows[0]!.n);
  if (query.before) {
    const [at, bid] = query.before.split('|');
    if (at && bid && !Number.isNaN(Date.parse(at))) { params.push(at, bid); where.push(`(b.created_at, b.id) < ($${params.length - 1}::timestamptz, $${params.length})`); }
  }
  params.push(query.limit + 1);
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC, b.id DESC LIMIT $${params.length}`, params);
  const rows = r.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return { bookmarks: rows.map(toView), next: r.rows.length > query.limit && last ? `${last.created_at.toISOString()}|${last.id}` : null, total };
}

// The home panel's section (docs/21): pinned ones first, then the newest.
export async function hub(deps: AppDeps, v: SessionUser): Promise<{ pinned: BookmarkView[]; recent: BookmarkView[]; total: number }> {
  const pinned = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.user_id = $1 AND b.pinned ORDER BY b.created_at DESC LIMIT 24`, [v.userId]);
  const recent = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.user_id = $1 AND NOT b.pinned ORDER BY b.created_at DESC LIMIT 8`, [v.userId]);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks WHERE user_id = $1`, [v.userId])).rows[0]!.n);
  return { pinned: pinned.rows.map(toView), recent: recent.rows.map(toView), total };
}

export async function tagCounts(deps: AppDeps, v: SessionUser): Promise<{ tag: string; count: number }[]> {
  const r = await deps.db.query<{ tag: string; n: string }>(
    `SELECT t AS tag, count(*) AS n FROM bookmarks, unnest(tags) AS t WHERE user_id = $1 GROUP BY t ORDER BY count(*) DESC, t LIMIT 200`, [v.userId]);
  return r.rows.map((x) => ({ tag: x.tag, count: Number(x.n) }));
}

export async function readIcon(deps: AppDeps, v: SessionUser, id: string): Promise<Buffer> {
  const r = await deps.db.query<{ favicon: Buffer | null }>(`SELECT favicon FROM bookmarks WHERE id = $1 AND user_id = $2`, [id, v.userId]);
  if (!r.rows[0]?.favicon) throw notFound();
  return r.rows[0].favicon;
}

// ---------------------------------------------------------------- export and import (docs/12)

export interface ExportedBookmark { url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility; ring: string | null; created_at: string }

export async function exportBookmarks(q: Queryable, userId: string): Promise<ExportedBookmark[]> {
  const r = await q.query<{ url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility; ring: string | null; created_at: Date }>(
    `SELECT b.url, b.title, b.description, b.tags, b.pinned, b.visibility, g.slug AS ring, b.created_at ${FROM} WHERE b.user_id = $1 ORDER BY b.created_at`, [userId]);
  return r.rows.map((x) => ({ ...x, created_at: x.created_at.toISOString() }));
}

// Brings bookmarks back without fetching anything: the export already has their titles. Everything comes back
// private (sharing again is the person's choice); ones they already have are left alone.
export async function importBookmarks(deps: AppDeps, v: SessionUser, items: unknown[]): Promise<{ restored: number; codes: string[] }> {
  const codes: string[] = [];
  let restored = 0;
  for (const raw of items.slice(0, BOOKMARKS_MAX)) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const parsed = bookmarkCreateSchema.safeParse({ url: x.url, title: typeof x.title === 'string' && x.title.trim() ? x.title.slice(0, BOOKMARK_TITLE_MAX) : undefined,
      description: typeof x.description === 'string' ? x.description.slice(0, BOOKMARK_DESCRIPTION_MAX) : '', tags: Array.isArray(x.tags) ? x.tags : [], pinned: x.pinned === true });
    if (!parsed.success) { codes.push('invalid'); continue; }
    try {
      const r = await addBookmark(deps, v, parsed.data, { fetch: false });
      if (r.existing) { codes.push('exists'); continue; }
      restored += 1;
      if (x.visibility && x.visibility !== 'private') codes.push('made_private');
      if (typeof x.created_at === 'string' && !Number.isNaN(Date.parse(x.created_at))) {
        await deps.db.query(`UPDATE bookmarks SET created_at = $2 WHERE id = $1`, [r.bookmark.id, x.created_at]);
      }
    } catch (e) {
      codes.push(e instanceof ApiError ? e.code : 'failed');
      if (e instanceof ApiError && e.code === 'too_many') break;
    }
  }
  return { restored, codes };
}

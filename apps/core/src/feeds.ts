import { createHash } from 'node:crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// Atom feeds (RFC 4287; docs/05, decided 2026-10-05) of what anyone can read on the web: public boards only, nothing a
// moderator hid, nothing deleted, no guests or suspended people. Text goes out as escaped plain text, never as HTML.
// Entry ids are tag: URIs built from the stable post ids, so a renamed board or person doesn't make readers see
// everything twice.

const LIMIT = 50;
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
  // Characters XML 1.0 can't carry at all (most control characters) are dropped.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

interface Entry { id: string; title: string; url: string; author: string; published: Date; updated: Date; content: string }
export interface Feed { title: string; selfPath: string; webPath: string; entries: Entry[] }

const PUBLIC = `b.visibility = 'public' AND b.hidden_at IS NULL AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND u.status = 'active' AND u.role <> 'guest'`;
interface Row { id: string; thread_id: string; subject: string; body: string; posted_at: Date; edited_at: Date | null; handle: string; slug: string; board: string }
const COLS = `p.id, COALESCE(p.thread_root_id, p.id) AS thread_id, COALESCE(NULLIF(p.subject, ''), t.subject, '') AS subject, p.body, p.posted_at, p.edited_at,
  u.handle, b.slug, b.name AS board`;
const FROM = `posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.author_id LEFT JOIN posts t ON t.id = p.thread_root_id`;

function entries(deps: AppDeps, rows: Row[]): Entry[] {
  return rows.map((r) => ({
    id: `tag:${deps.config.site.domain},2026:post/${r.id}`,
    title: r.subject || '(no subject)',
    url: `${deps.publicUrl}/boards/${r.slug}/t/${r.thread_id}`,
    author: r.handle,
    published: r.posted_at,
    updated: r.edited_at ?? r.posted_at,
    content: r.body,
  }));
}

async function publicBoard(deps: AppDeps, slug: string): Promise<{ id: string; name: string }> {
  const b = (await deps.db.query<{ id: string; name: string }>(`SELECT id, name FROM boards WHERE slug = $1 AND visibility = 'public' AND hidden_at IS NULL`, [slug])).rows[0];
  if (!b) throw new ApiError(404, 'not_found', 'There is no public board by that name.');
  return b;
}

// New threads on one public board.
export async function boardFeed(deps: AppDeps, slug: string): Promise<Feed> {
  const b = await publicBoard(deps, slug);
  const r = await deps.db.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE ${PUBLIC} AND b.id = $1 AND p.thread_root_id IS NULL ORDER BY p.seq DESC LIMIT ${LIMIT}`, [b.id]);
  return { title: `${b.name} - ${deps.config.site.name}`, selfPath: `/feeds/boards/${slug}.atom`, webPath: `/boards/${slug}`, entries: entries(deps, r.rows) };
}

// Every post in one thread, newest first.
export async function threadFeed(deps: AppDeps, slug: string, threadId: string): Promise<Feed> {
  const b = await publicBoard(deps, slug);
  const r = await deps.db.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE ${PUBLIC} AND b.id = $1 AND (p.id = $2 OR p.thread_root_id = $2) ORDER BY p.seq DESC LIMIT ${LIMIT}`, [b.id, threadId]);
  if (!r.rows.length) throw new ApiError(404, 'not_found', 'There is no such thread.');
  const root = r.rows.find((x) => x.id === threadId);
  return { title: `${root?.subject || r.rows[0]!.subject} - ${b.name}`, selfPath: `/feeds/boards/${slug}/threads/${threadId}.atom`, webPath: `/boards/${slug}/t/${threadId}`, entries: entries(deps, r.rows) };
}

// One person's posts on public boards.
export async function personFeed(deps: AppDeps, handle: string): Promise<Feed> {
  const u = (await deps.db.query<{ id: string; handle: string }>(`SELECT id, handle FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle])).rows[0];
  if (!u) throw new ApiError(404, 'not_found', 'Nobody here goes by that name.');
  const r = await deps.db.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE ${PUBLIC} AND p.author_id = $1 ORDER BY p.seq DESC LIMIT ${LIMIT}`, [u.id]);
  return { title: `${u.handle} - ${deps.config.site.name}`, selfPath: `/feeds/people/${u.handle}.atom`, webPath: `/people/${u.handle}`, entries: entries(deps, r.rows) };
}

// New threads across every public board.
export async function allFeed(deps: AppDeps): Promise<Feed> {
  const r = await deps.db.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE ${PUBLIC} AND p.thread_root_id IS NULL ORDER BY p.seq DESC LIMIT ${LIMIT}`);
  return { title: `New threads - ${deps.config.site.name}`, selfPath: '/feeds/all.atom', webPath: '/boards', entries: entries(deps, r.rows) };
}

export function renderAtom(deps: AppDeps, f: Feed): string {
  const updated = f.entries.reduce((m, e) => (e.updated > m ? e.updated : m), new Date(0));
  const id = `tag:${deps.config.site.domain},2026:feed${f.selfPath.replace(/\.atom$/, '')}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${xml(id)}</id>`,
    `  <title>${xml(f.title)}</title>`,
    `  <updated>${(f.entries.length ? updated : new Date(0)).toISOString()}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(deps.publicUrl + f.selfPath)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(deps.publicUrl + f.webPath)}"/>`,
    `  <generator>${xml(deps.config.site.name)}</generator>`,
    ...f.entries.map((e) => [
      '  <entry>',
      `    <id>${xml(e.id)}</id>`,
      `    <title>${xml(e.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${xml(e.url)}"/>`,
      `    <author><name>${xml(e.author)}</name><uri>${xml(`${deps.publicUrl}/people/${encodeURIComponent(e.author)}`)}</uri></author>`,
      `    <published>${e.published.toISOString()}</published>`,
      `    <updated>${e.updated.toISOString()}</updated>`,
      `    <content type="text">${xml(e.content)}</content>`,
      '  </entry>',
    ].join('\n')),
    '</feed>',
    '',
  ].join('\n');
}

export const etagOf = (body: string): string => `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;

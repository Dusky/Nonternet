import type { AppDeps } from './deps';
import { online } from './presence-view';

// What a visitor who is not signed in sees on the front page (docs/10): how many people are around
// (a number, never names), the newest threads on public boards, and a few rings and homepages to
// look at. Everything here is already public elsewhere; nothing is shown that a visitor couldn't
// find by browsing the boards, the ring directory or the homepage directory.
export interface Landing {
  online: number;
  threads: { board: { slug: string; name: string }; id: string; subject: string; author: string | null; excerpt: string; last_post_at: string; reply_count: number }[];
  rings: { slug: string; name: string; description: string; members: number }[];
  homepages: { handle: string; title: string; description: string; url: string }[];
}

const EXCERPT = 160;

export async function landing(deps: AppDeps): Promise<Landing> {
  const [people, threads, rings, homepages] = await Promise.all([
    online(deps),
    deps.db.query<{ id: string; subject: string; body: string; slug: string; name: string; handle: string | null; display_name: string | null; reply_count: number; last_at: Date }>(
      `SELECT p.id, p.subject, p.body, b.slug, b.name, u.handle, u.display_name, p.reply_count,
         (SELECT max(x.posted_at) FROM posts x WHERE x.id = p.id OR x.thread_root_id = p.id) AS last_at
       FROM posts p JOIN boards b ON b.id = p.board_id LEFT JOIN users u ON u.id = p.author_id AND u.status = 'active'
       WHERE p.thread_root_id IS NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL
         AND b.visibility = 'public' AND b.hidden_at IS NULL AND b.archived_at IS NULL
       ORDER BY p.last_seq DESC LIMIT 6`),
    deps.db.query<{ slug: string; name: string; description: string; members: number }>(
      `SELECT r.slug, r.name, r.description,
         (SELECT count(*)::int FROM ring_members m WHERE m.ring_id = r.id AND m.status = 'member') AS members
       FROM rings r WHERE r.hidden_at IS NULL AND r.archived_at IS NULL ORDER BY random() LIMIT 3`),
    deps.db.query<{ handle: string; title: string; description: string }>(
      `SELECT u.handle, h.title, h.description FROM homepages h JOIN users u ON u.id = h.user_id
       WHERE h.has_index AND h.hidden_at IS NULL AND u.status = 'active' ORDER BY random() LIMIT 3`),
  ]);
  return {
    online: people.length,
    threads: threads.rows.map((t) => ({
      board: { slug: t.slug, name: t.name }, id: t.id, subject: t.subject, author: t.display_name || t.handle,
      excerpt: t.body.length > EXCERPT ? `${t.body.slice(0, EXCERPT).trimEnd()}…` : t.body,
      last_post_at: t.last_at.toISOString(), reply_count: t.reply_count,
    })),
    rings: rings.rows,
    homepages: homepages.rows.map((h) => ({ ...h, url: deps.homesUrl(h.handle) })),
  };
}

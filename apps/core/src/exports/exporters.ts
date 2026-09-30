import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AppDeps } from '../deps';
import { formatMbox } from './mbox';
import { mudExport } from '../mud/sync';

// Ownership is a feature (docs/12, CLAUDE.md): everything a person makes is in their export. Every
// table is either handled by an exporter below or listed in EXEMPT with the reason it is not the
// person's content. A test walks the real database and fails on any table in neither list, so a new
// kind of content cannot be added without deciding how it is exported.
export interface ExportUser { id: string; handle: string; display_name: string | null; bio: string | null; email: string; role: string; theme: string | null; created_at: Date; public_key: string | null }

export interface ExportCtx {
  deps: AppDeps;
  user: ExportUser;
  add(path: string, data: string | Buffer): void;
}
export interface Exporter { id: string; tables: string[]; run(ctx: ExportCtx): Promise<void> }

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const profile: Exporter = {
  id: 'profile',
  tables: ['users', 'handle_history', 'watches', 'board_members', 'ring_members', 'custom_domains', 'scoped_roles'],
  async run({ deps, user, add }) {
    const q = deps.db;
    const [names, domains, rings, boards, watching, ops, history] = await Promise.all([
      q.query<{ handle: string; changed_at: Date }>(`SELECT handle, changed_at FROM handle_history WHERE user_id = $1 ORDER BY id`, [user.id]),
      q.query<{ domain: string; status: string; verified_at: Date | null }>(`SELECT domain, status, verified_at FROM custom_domains WHERE user_id = $1 ORDER BY created_at`, [user.id]),
      q.query<{ slug: string; name: string; status: string; joined_at: Date }>(`SELECT r.slug, r.name, m.status, m.joined_at FROM ring_members m JOIN rings r ON r.id = m.ring_id WHERE m.user_id = $1 ORDER BY r.slug`, [user.id]),
      q.query<{ slug: string }>(`SELECT b.slug FROM board_members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = $1 ORDER BY b.slug`, [user.id]),
      q.query<{ slug: string }>(`SELECT b.slug FROM watches w JOIN boards b ON b.id = w.board_id WHERE w.user_id = $1 ORDER BY b.slug`, [user.id]),
      q.query<{ scope_type: string; scope_id: string; created_at: Date }>(`SELECT scope_type, scope_id, created_at FROM scoped_roles WHERE user_id = $1 ORDER BY created_at`, [user.id]),
      q.query<{ created_at: Date; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
        `SELECT created_at, action, before, after FROM audit_log WHERE target_type = 'user' AND target_id = $1 AND action IN ('user.role_changed', 'user.ops_changed', 'user.renamed') ORDER BY id`, [user.id]),
    ]);
    add('profile.json', json({
      id: user.id, handle: user.handle, display_name: user.display_name, bio: user.bio, email: user.email, joined_at: user.created_at.toISOString(),
      role: user.role, theme: user.theme, previous_handles: names.rows.map((n) => ({ handle: n.handle, until: n.changed_at.toISOString() })),
      custom_domains: domains.rows.map((d) => ({ domain: d.domain, status: d.status, verified_at: iso(d.verified_at) })),
      rings: rings.rows.map((r) => ({ slug: r.slug, name: r.name, status: r.status, joined_at: r.joined_at.toISOString() })),
      private_board_memberships: boards.rows.map((b) => b.slug), watching_boards: watching.rows.map((b) => b.slug),
      ops: ops.rows.map((o) => ({ scope: `${o.scope_type}:${o.scope_id}`, since: o.created_at.toISOString() })),
      // Role changes are kept without the admin's stated reason, which is an internal note.
      role_history: history.rows.map((h) => ({ at: h.created_at.toISOString(), action: h.action, before: h.before, after: h.after ? Object.fromEntries(Object.entries(h.after).filter(([k]) => k !== 'reason')) : null })),
    }));
  },
};

const posts: Exporter = {
  id: 'posts',
  tables: ['posts'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ id: string; slug: string; thread_id: string; reply_to_id: string | null; subject: string; body: string; posted_at: Date; deleted_at: Date | null; hidden_at: Date | null }>(
      `SELECT p.id, b.slug, COALESCE(p.thread_root_id, p.id) AS thread_id, p.reply_to_id, p.subject, p.body, p.posted_at, p.deleted_at, p.hidden_at
       FROM posts p JOIN boards b ON b.id = p.board_id WHERE p.author_id = $1 ORDER BY p.seq`, [user.id]);
    const rows = r.rows.map((p) => ({
      id: p.id, board: p.slug, thread_id: p.thread_id, reply_to: p.reply_to_id, subject: p.subject, body: p.body,
      posted_at: p.posted_at.toISOString(), state: p.deleted_at ? 'deleted' : p.hidden_at ? 'hidden' : 'ok',
    }));
    add('posts/posts.json', json(rows));
    // The same posts as a mailbox, for mail and news readers (docs/12).
    add('posts/posts.mbox', formatMbox(rows.filter((p) => p.state !== 'deleted'), { handle: user.handle, domain: deps.config.site.domain }));
  },
};

const homepage: Exporter = {
  id: 'homepage',
  tables: ['homepages'],
  async run({ deps, user, add }) {
    const h = await deps.db.query<{ title: string; description: string; guestbook_mode: string; last_updated_at: Date | null }>(`SELECT title, description, guestbook_mode, last_updated_at FROM homepages WHERE user_id = $1`, [user.id]);
    if (h.rows[0]) add('homepage.json', json({ title: h.rows[0].title, description: h.rows[0].description, guestbook_mode: h.rows[0].guestbook_mode, last_updated_at: iso(h.rows[0].last_updated_at) }));
    // The files exactly as uploaded, under their own names.
    const max = Math.floor(deps.config.limits.homepage_file_max_mb * 1048576);
    for (const e of await deps.homes.tree(user.id)) if (e.type === 'file') add(`homepage/${e.path}`, await deps.homes.read(user.id, e.path, max));
  },
};

const guestbook: Exporter = {
  id: 'guestbook',
  tables: ['guestbook_entries'],
  async run({ deps, user, add }) {
    const [on, by] = await Promise.all([
      deps.db.query<{ name: string; url: string | null; message: string; status: string; created_at: Date; member: string | null }>(
        `SELECT g.name, g.url, g.message, g.status, g.created_at, u.handle AS member FROM guestbook_entries g LEFT JOIN users u ON u.id = g.author_id WHERE g.home_user_id = $1 ORDER BY g.created_at`, [user.id]),
      deps.db.query<{ home: string; name: string; url: string | null; message: string; status: string; created_at: Date }>(
        `SELECT h.handle AS home, g.name, g.url, g.message, g.status, g.created_at FROM guestbook_entries g JOIN users h ON h.id = g.home_user_id WHERE g.author_id = $1 ORDER BY g.created_at`, [user.id]),
    ]);
    add('guestbook.json', json({
      on_my_page: on.rows.map((g) => ({ name: g.name, member: g.member, url: g.url, message: g.message, status: g.status, at: g.created_at.toISOString() })),
      signed_by_me: by.rows.map((g) => ({ page_of: g.home, name: g.name, url: g.url, message: g.message, status: g.status, at: g.created_at.toISOString() })),
    }));
  },
};

// Rings someone founded or is an op of: the profile and the member list, which is public information.
// Not the members' own content (docs/12).
const rings: Exporter = {
  id: 'rings',
  tables: ['rings'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ id: string; slug: string; name: string; description: string; about: string; tags: string[]; join_policy: string; founder: string; created_at: Date; archived_at: Date | null }>(
      `SELECT r.id, r.slug, r.name, r.description, r.about, r.tags, r.join_policy, f.handle AS founder, r.created_at, r.archived_at FROM rings r JOIN users f ON f.id = r.founder_id
       WHERE r.founder_id = $1 OR r.id IN (SELECT scope_id FROM scoped_roles WHERE user_id = $1 AND scope_type = 'ring') ORDER BY r.slug`, [user.id]);
    for (const ring of r.rows) {
      const m = await deps.db.query<{ handle: string; joined_at: Date }>(`SELECT u.handle, m.joined_at FROM ring_members m JOIN users u ON u.id = m.user_id WHERE m.ring_id = $1 AND m.status = 'member' ORDER BY m.position`, [ring.id]);
      add(`rings/${ring.slug}/ring.json`, json({ slug: ring.slug, name: ring.name, description: ring.description, about: ring.about, tags: ring.tags, join_policy: ring.join_policy, founder: ring.founder, created_at: ring.created_at.toISOString(), archived: ring.archived_at !== null }));
      add(`rings/${ring.slug}/members.json`, json(m.rows.map((x) => ({ handle: x.handle, joined_at: x.joined_at.toISOString() }))));
    }
  },
};

// Boards a person owns: the board itself, not other people's messages (docs/12). A ring's board goes with the ring.
const boards: Exporter = {
  id: 'boards',
  tables: ['boards'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ slug: string; name: string; description: string; visibility: string; created_at: Date; archived_at: Date | null }>(
      `SELECT slug, name, description, visibility, created_at, archived_at FROM boards WHERE owner_id = $1 AND ring_id IS NULL ORDER BY slug`, [user.id]);
    for (const b of r.rows) add(`boards/${b.slug}.json`, json({ slug: b.slug, name: b.name, description: b.description, visibility: b.visibility, created_at: b.created_at.toISOString(), archived: b.archived_at !== null }));
  },
};

const keys: Exporter = {
  id: 'keys',
  tables: [],
  async run({ user, add }) {
    if (user.public_key) add('keys/public.key', user.public_key);
  },
};

// IRC channels a person registered (docs/08). Chat messages live in Ergo's memory for a few days and are
// not exported (Q9 is still open).
const irc: Exporter = {
  id: 'irc',
  tables: ['irc_channels'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ name: string; created_at: Date; removed_at: Date | null }>(`SELECT name, created_at, removed_at FROM irc_channels WHERE owner_id = $1 ORDER BY name`, [user.id]);
    if (r.rows.length) add('irc/channels.json', json(r.rows.map((c) => ({ name: c.name, created_at: c.created_at.toISOString(), removed: c.removed_at !== null }))));
  },
};

// MUD characters (docs/09, 18) live in the MUD's own database; the MUD hands them over by core id. If the
// MUD is set up but does not answer, the export fails rather than quietly leaving characters out.
const mud: Exporter = {
  id: 'mud',
  // mud_characters is core's copy of what the MUD hands over here in full.
  tables: ['mud_characters'],
  async run({ deps, user, add }) {
    if (!deps.mud) return;
    const out = await mudExport(deps, user.id);
    if (out.characters.length) add('mud/characters.json', json(out));
  },
};

// Private mail (docs/10): each conversation the person is in, with who was there and the messages they
// wrote. Others' messages are left out, as with board posts (Q9, still open, PROPOSED default).
const mail: Exporter = {
  id: 'mail',
  tables: ['mail_threads', 'mail_participants', 'mail_messages', 'user_blocks'],
  async run({ deps, user, add }) {
    const threads = await deps.db.query<{ id: string; subject: string; created_at: Date; joined_at: Date; left_at: Date | null }>(
      `SELECT t.id, t.subject, t.created_at, p.joined_at, p.left_at FROM mail_participants p JOIN mail_threads t ON t.id = p.thread_id WHERE p.user_id = $1 ORDER BY t.created_at`, [user.id]);
    const out = [];
    for (const t of threads.rows) {
      const people = await deps.db.query<{ handle: string }>(`SELECT u.handle FROM mail_participants p JOIN users u ON u.id = p.user_id WHERE p.thread_id = $1 AND u.status <> 'deleted' ORDER BY u.handle`, [t.id]);
      const mine = await deps.db.query<{ body: string; created_at: Date; deleted_at: Date | null }>(
        `SELECT body, created_at, deleted_at FROM mail_messages WHERE thread_id = $1 AND author_id = $2 AND kind = 'message' ORDER BY created_at`, [t.id, user.id]);
      out.push({
        subject: t.subject, started: t.created_at.toISOString(), joined: t.joined_at.toISOString(), left: t.left_at ? t.left_at.toISOString() : null,
        people: people.rows.map((p) => p.handle),
        my_messages: mine.rows.map((m) => ({ at: m.created_at.toISOString(), body: m.deleted_at ? null : m.body })),
      });
    }
    const blocks = await deps.db.query<{ handle: string }>(`SELECT u.handle FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY u.handle`, [user.id]);
    if (out.length) add('mail/conversations.json', json(out));
    if (blocks.rowCount) add('mail/blocked.json', json(blocks.rows.map((b) => b.handle)));
  },
};

// Vouching (docs/03): the vouches the person gave. Vouches others gave for them are those people's words.
const vouching: Exporter = {
  id: 'vouches',
  tables: ['vouches'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ handle: string; note: string; created_at: Date; withdrawn_at: Date | null; outcome: string | null }>(
      `SELECT u.handle, v.note, v.created_at, v.withdrawn_at, v.outcome FROM vouches v JOIN users u ON u.id = v.candidate_id WHERE v.voucher_id = $1 ORDER BY v.created_at`, [user.id]);
    if (r.rowCount) add('vouches.json', json(r.rows.map((v) => ({ for: v.handle, note: v.note, at: v.created_at.toISOString(), state: v.withdrawn_at ? 'withdrawn' : v.outcome ?? 'open' }))));
  },
};

// File areas (docs/05): every file they uploaded, as uploaded, with its details. Areas are made by admins.
const fileAreas: Exporter = {
  id: 'files',
  tables: ['files', 'file_areas'],
  async run({ deps, user, add }) {
    const r = await deps.db.query<{ id: string; area: string; name: string; title: string; description: string; size_bytes: string; sha256: string; downloads: number; created_at: Date; hidden_at: Date | null }>(
      `SELECT f.id, a.slug AS area, f.name, f.title, f.description, f.size_bytes, f.sha256, f.downloads, f.created_at, f.hidden_at
       FROM files f JOIN file_areas a ON a.id = f.area_id WHERE f.uploader_id = $1 AND f.deleted_at IS NULL ORDER BY f.created_at`, [user.id]);
    for (const f of r.rows) {
      const bytes = await fs.readFile(join(deps.filesDir, f.id)).catch(() => null);
      if (bytes) add(`files/${f.area}/${f.name}`, bytes);
    }
    if (r.rowCount) add('files.json', json(r.rows.map((f) => ({ area: f.area, name: f.name, title: f.title, description: f.description, size_bytes: Number(f.size_bytes), sha256: f.sha256, downloads: f.downloads, uploaded_at: f.created_at.toISOString(), hidden: !!f.hidden_at }))));
  },
};

export const EXPORTERS: Exporter[] = [profile, posts, homepage, guestbook, rings, boards, keys, irc, mud, mail, vouching, fileAreas];

// Tables that hold no one's own content, each with the reason. Anything not here and not in an
// exporter fails the test in exports/exporters.test.ts.
export const EXEMPT: Record<string, string> = {
  legal_pages: 'site documents written by admins',
  legal_page_versions: 'site documents written by admins',
  legal_requests: 'takedown requests from the public, about content rather than by the account',
  sessions: 'security state, not content',
  terminal_tickets: 'one-use sign-in tickets for chat and the MUD',
  irc_applied: 'a record of what the bot has told the IRC server',
  email_verifications: 'security state, not content',
  password_resets: 'security state, not content',
  recovery_codes: 'security state, not content',
  invites: 'admin-issued sign-up codes',
  audit_log: 'append-only administrative record; role and handle changes are summarised in profile.json',
  events_outbox: 'internal message queue',
  oidc_payloads: 'sign-in protocol state',
  oidc_keys: 'the site’s own signing keys',
  board_categories: 'site structure set by admins',
  read_state: 'a reading position, rebuilt by reading again',
  notifications: 'derived from other people’s activity',
  reports: 'moderation records kept by moderators',
  mod_actions: 'moderation records, public in each board’s mod log',
  sponsor_flags: 'moderation records kept by admins',
  ring_bans: 'moderation records kept by ring ops',
  home_hits: 'a visitor count, not a person’s content',
  home_hit_seen: 'anonymous, short-lived counter records',
  exports: 'the export records themselves',
  metrics_rollup: 'site-wide numbers, not a person’s content',
  activity_days: 'which days an account was used, for site statistics; not content',
  backup_runs: 'the operator’s backup and restore-test record',
  settings_current: 'site-wide settings set by admins',
  settings_history: 'site-wide settings history kept by admins',
  announcements: 'site-wide notices written by admins',
  schema_migrations: 'database bookkeeping',
};

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

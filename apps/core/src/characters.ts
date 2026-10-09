import { coarseLastSeen } from './personal';
import type { CharacterView, PublicProfile, TowerLeaderboard } from '@app/shared';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { SessionUser } from './accounts';

// MUD characters for the rest of the site (docs/09). The MUD is the source of truth; core keeps a copy,
// pulled after each sync pass and every two minutes, so boards and profiles never wait on the MUD.

interface MudCharacter {
  id: string; core_id: string; name: string; created: string; level: number; xp: number; hp: number; hp_max: number; coins: number; abilities: Record<string, number>;
  tower?: { season: number | null; best: number | null; checkpoint: number | null };
}

// Pulls run one at a time in this process: the MUD's nudge, the five-minute pass and the two-minute timer all queue here, so
// a slow, older pull can't finish after a newer one. Each pull also stamps rows with the database time taken just before
// it asked the MUD, and never overwrites or removes a row stamped later: an older list can't undo a newer one even across
// more than one core.
let queue: Promise<unknown> = Promise.resolve();
export function pullCharacters(deps: AppDeps): Promise<{ saved: number; removed: number }> {
  const run = queue.then(() => pullOnce(deps));
  queue = run.catch(() => undefined);
  return run;
}

// The two keys of pg_advisory_xact_lock for "copying characters from the MUD".
const LOCK = [0x6d7564, 1] as const;

// Also what a second core would run; tests use it to check the time stamps hold without the queue.
export async function pullOnce(deps: AppDeps): Promise<{ saved: number; removed: number }> {
  const mud = deps.mud!;
  const asOf = (await deps.db.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0]!.t;
  const res = await fetch(`${mud.url}/internal/characters`, { headers: { authorization: `Bearer ${mud.secrets.controlToken}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`mud characters: HTTP ${res.status}`);
  const { characters } = (await res.json()) as { characters: MudCharacter[] };
  return deps.db.tx(async (q) => {
    await q.query(`SELECT pg_advisory_xact_lock($1, $2)`, [...LOCK]);
    const known = new Set((await q.query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1)`, [[...new Set(characters.map((c) => c.core_id))]])).rows.map((r) => r.id));
    let saved = 0;
    for (const c of characters) {
      if (!known.has(c.core_id)) continue;
      const r = await q.query(
        `INSERT INTO mud_characters (id, user_id, name, level, xp, hp, hp_max, coins, abilities, created_at, tower_season, tower_best, tower_checkpoint, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET user_id = $2, name = $3, level = $4, xp = $5, hp = $6, hp_max = $7, coins = $8, abilities = $9,
           tower_season = $11, tower_best = $12, tower_checkpoint = $13, synced_at = $14
         WHERE mud_characters.synced_at <= $14`,
        [c.id, c.core_id, c.name, c.level, c.xp, c.hp, c.hp_max, c.coins, JSON.stringify(c.abilities), c.created,
          c.tower?.season ?? null, c.tower?.best ?? 0, c.tower?.checkpoint ?? 0, asOf]);
      saved += r.rowCount ?? 0;
    }
    // A character the MUD no longer has is gone (deleted in-game, or its account was) — unless a newer pull has seen it since.
    const removed = await q.query(`DELETE FROM mud_characters WHERE NOT (id = ANY($1)) AND synced_at < $2`, [characters.map((c) => c.id), asOf]);
    return { saved, removed: removed.rowCount ?? 0 };
  });
}

interface Row {
  id: string; name: string; level: number; xp: number; hp: number; hp_max: number; coins: number; abilities: Record<string, number>; created_at: Date;
  tower_season: number | null; tower_best: number; tower_checkpoint: number;
}
const view = (r: Row): CharacterView => ({
  id: r.id, name: r.name, level: r.level, xp: r.xp, hp: r.hp, hp_max: r.hp_max, coins: r.coins,
  abilities: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0, ...r.abilities },
  created_at: r.created_at.toISOString(),
  tower: r.tower_season ? { season: r.tower_season, best: r.tower_best, checkpoint: r.tower_checkpoint } : null,
});
const COLS = 'id, name, level, xp, hp, hp_max, coins, abilities, created_at, tower_season, tower_best, tower_checkpoint';

// The tower's leaderboard (docs/18): the highest floors of the latest season anyone has climbed in. Characters of active people only.
export async function towerLeaderboard(deps: AppDeps, limit = 20): Promise<TowerLeaderboard> {
  const r = await deps.db.query<{ name: string; level: number; best: number; handle: string; season: number }>(
    `SELECT c.name, c.level, c.tower_best AS best, u.handle, c.tower_season AS season
       FROM mud_characters c JOIN users u ON u.id = c.user_id
      WHERE c.tower_season = (SELECT max(tower_season) FROM mud_characters) AND c.tower_best > 0 AND u.status = 'active'
      ORDER BY c.tower_best DESC, c.level DESC, c.name LIMIT $1`, [limit]);
  return { season: r.rows[0]?.season ?? null, leaders: r.rows.map(({ season: _s, ...row }) => row) };
}

export async function charactersOf(deps: AppDeps, userId: string): Promise<CharacterView[]> {
  const r = await deps.db.query<Row>(`SELECT ${COLS} FROM mud_characters WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return r.rows.map(view);
}

// Anyone may see a person's profile, signed in or not, as they can see their homepage (docs/07).
// Suspended and deleted people, and guests, have none.
export async function publicProfile(deps: AppDeps, handle: string): Promise<PublicProfile> {
  const r = await deps.db.query<{ id: string; handle: string; display_name: string | null; bio: string | null; role: PublicProfile['role']; created_at: Date; featured_character_id: string | null; has_page: boolean;
    status_line: string | null; plan: string; pronouns: string | null; location: string | null; links: { label: string; url: string }[]; away: boolean; last_seen_at: Date | null; show_last_seen: boolean; hp_title: string | null; hp_updated: Date | null }>(
    `SELECT u.id, u.handle, u.display_name, u.bio, u.role, u.created_at, u.featured_character_id,
            (h.has_index AND h.hidden_at IS NULL) AS has_page,
            u.status_line, u.plan, u.pronouns, u.location, u.links, u.away, u.last_seen_at, u.show_last_seen, h.title AS hp_title, h.last_updated_at AS hp_updated
     FROM users u LEFT JOIN homepages h ON h.user_id = u.id
     WHERE lower(u.handle) = lower($1) AND u.status = 'active' AND u.role <> 'guest'`, [handle]);
  const u = r.rows[0];
  if (!u) throw new ApiError(404, 'not_found', 'Nobody here goes by that name.');
  const rings = await deps.db.query<{ slug: string; name: string }>(
    `SELECT r.slug, r.name FROM ring_members m JOIN rings r ON r.id = m.ring_id
     WHERE m.user_id = $1 AND m.status = 'member' AND r.archived_at IS NULL AND r.hidden_at IS NULL ORDER BY r.name`, [u.id]);
  // Their latest posts on boards anyone can read: a profile is public, so it never shows more than that.
  const recent = await deps.db.query<{ id: string; thread_id: string; subject: string; posted_at: Date; slug: string; board_name: string }>(
    `SELECT p.id, COALESCE(p.thread_root_id, p.id) AS thread_id, COALESCE(NULLIF(p.subject, ''), t.subject, '') AS subject, p.posted_at AS posted_at, b.slug, b.name AS board_name
       FROM posts p JOIN boards b ON b.id = p.board_id LEFT JOIN posts t ON t.id = p.thread_root_id
      WHERE p.author_id = $1 AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND b.visibility = 'public' AND b.hidden_at IS NULL
      ORDER BY p.seq DESC LIMIT 5`, [u.id]);
  // Pages they edited in the site wiki that anyone can read (latest edit per page).
  const wiki = await deps.db.query<{ slug: string; title: string; at: Date }>(
    `SELECT * FROM (SELECT DISTINCT ON (p.id) p.slug, p.title, r.created_at AS at
       FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id JOIN wikis w ON w.id = p.wiki_id AND w.scope_type = 'site'
      WHERE r.editor_id = $1 AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND r.text_hidden_at IS NULL
      ORDER BY p.id, r.created_at DESC) x ORDER BY at DESC LIMIT 5`, [u.id]);
  const activity: PublicProfile['activity'] = [
    ...recent.rows.map((p) => ({ kind: 'post' as const, at: p.posted_at.toISOString(), title: p.subject, link: { app: 'boards' as const, to: `${p.slug}/t/${p.thread_id}` }, place: p.board_name })),
    ...wiki.rows.map((p) => ({ kind: 'wiki' as const, at: p.at.toISOString(), title: p.title, link: { app: 'wiki' as const, to: p.slug }, place: null })),
    ...(u.has_page && u.hp_updated ? [{ kind: 'homepage' as const, at: u.hp_updated.toISOString(), title: u.hp_title || u.handle, link: { app: 'homepages' as const, to: u.handle }, place: null }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return {
    id: u.id, handle: u.handle, display_name: u.display_name, bio: u.bio, role: u.role, joined_at: u.created_at.toISOString(),
    homepage_url: u.has_page ? deps.homesUrl(u.handle) : null, rings: rings.rows,
    status_line: u.status_line, plan: u.plan, pronouns: u.pronouns, location: u.location, links: u.links, activity, away: u.away, last_seen: coarseLastSeen(u.last_seen_at, u.show_last_seen),
    homepage: u.has_page ? { title: u.hp_title || u.handle, updated_at: u.hp_updated?.toISOString() ?? null } : null,
    recent_posts: recent.rows.map((p) => ({ id: p.id, thread_id: p.thread_id, subject: p.subject, posted_at: p.posted_at.toISOString(), board: { slug: p.slug, name: p.board_name } })),
    characters: await charactersOf(deps, u.id), featured_character_id: u.featured_character_id,
  };
}

export async function setFeatured(deps: AppDeps, user: SessionUser, characterId: string | null): Promise<void> {
  if (characterId) {
    const own = await deps.db.query(`SELECT 1 FROM mud_characters WHERE id = $1 AND user_id = $2`, [characterId, user.userId]);
    if (!own.rowCount) throw new ApiError(404, 'not_found', 'You have no character like that.');
  }
  await deps.db.query(`UPDATE users SET featured_character_id = $2 WHERE id = $1`, [user.userId, characterId]);
}

import type { CharacterView, PublicProfile } from '@app/shared';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { SessionUser } from './accounts';

// MUD characters for the rest of the site (docs/09). The MUD is the source of truth; core keeps a copy,
// pulled after each sync pass and every two minutes, so boards and profiles never wait on the MUD.

interface MudCharacter { id: string; core_id: string; name: string; created: string; level: number; xp: number; hp: number; hp_max: number; coins: number; abilities: Record<string, number> }

export async function pullCharacters(deps: AppDeps): Promise<{ saved: number; removed: number }> {
  const mud = deps.mud!;
  const res = await fetch(`${mud.url}/internal/characters`, { headers: { authorization: `Bearer ${mud.secrets.controlToken}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`mud characters: HTTP ${res.status}`);
  const { characters } = (await res.json()) as { characters: MudCharacter[] };
  return deps.db.tx(async (q) => {
    const known = new Set((await q.query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1)`, [[...new Set(characters.map((c) => c.core_id))]])).rows.map((r) => r.id));
    let saved = 0;
    for (const c of characters) {
      if (!known.has(c.core_id)) continue;
      await q.query(
        `INSERT INTO mud_characters (id, user_id, name, level, xp, hp, hp_max, coins, abilities, created_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (id) DO UPDATE SET user_id = $2, name = $3, level = $4, xp = $5, hp = $6, hp_max = $7, coins = $8, abilities = $9, synced_at = now()`,
        [c.id, c.core_id, c.name, c.level, c.xp, c.hp, c.hp_max, c.coins, JSON.stringify(c.abilities), c.created]);
      saved++;
    }
    // A character the MUD no longer has is gone (deleted in-game, or its account was).
    const removed = await q.query(`DELETE FROM mud_characters WHERE NOT (id = ANY($1))`, [characters.map((c) => c.id)]);
    return { saved, removed: removed.rowCount ?? 0 };
  });
}

interface Row { id: string; name: string; level: number; xp: number; hp: number; hp_max: number; coins: number; abilities: Record<string, number>; created_at: Date }
const view = (r: Row): CharacterView => ({
  id: r.id, name: r.name, level: r.level, xp: r.xp, hp: r.hp, hp_max: r.hp_max, coins: r.coins,
  abilities: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0, ...r.abilities },
  created_at: r.created_at.toISOString(),
});

export async function charactersOf(deps: AppDeps, userId: string): Promise<CharacterView[]> {
  const r = await deps.db.query<Row>(`SELECT id, name, level, xp, hp, hp_max, coins, abilities, created_at FROM mud_characters WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return r.rows.map(view);
}

// Anyone may see a person's profile, signed in or not, as they can see their homepage (docs/07).
// Suspended and deleted people, and guests, have none.
export async function publicProfile(deps: AppDeps, handle: string): Promise<PublicProfile> {
  const r = await deps.db.query<{ id: string; handle: string; display_name: string | null; bio: string | null; role: PublicProfile['role']; created_at: Date; featured_character_id: string | null; has_page: boolean }>(
    `SELECT u.id, u.handle, u.display_name, u.bio, u.role, u.created_at, u.featured_character_id,
            (h.has_index AND h.hidden_at IS NULL) AS has_page
     FROM users u LEFT JOIN homepages h ON h.user_id = u.id
     WHERE lower(u.handle) = lower($1) AND u.status = 'active' AND u.role <> 'guest'`, [handle]);
  const u = r.rows[0];
  if (!u) throw new ApiError(404, 'not_found', 'Nobody here goes by that name.');
  const rings = await deps.db.query<{ slug: string; name: string }>(
    `SELECT r.slug, r.name FROM ring_members m JOIN rings r ON r.id = m.ring_id
     WHERE m.user_id = $1 AND m.status = 'member' AND r.archived_at IS NULL AND r.hidden_at IS NULL ORDER BY r.name`, [u.id]);
  return {
    id: u.id, handle: u.handle, display_name: u.display_name, bio: u.bio, role: u.role, joined_at: u.created_at.toISOString(),
    homepage_url: u.has_page ? deps.homesUrl(u.handle) : null, rings: rings.rows,
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

import { audit } from './audit';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';

export interface AnnouncementView { id: string; title: string; body: string; level: 'info' | 'warning'; starts_at: string; ends_at: string | null; state: 'scheduled' | 'live' | 'ended' | 'archived'; channels: string[] }
interface Row { id: string; title: string; body: string; level: 'info' | 'warning'; channels: string[]; starts_at: Date; ends_at: Date | null; archived_at: Date | null }

const stateOf = (r: Row, now: number): AnnouncementView['state'] =>
  r.archived_at ? 'archived' : r.starts_at.getTime() > now ? 'scheduled' : r.ends_at && r.ends_at.getTime() <= now ? 'ended' : 'live';
const view = (r: Row, now: number): AnnouncementView => ({ id: r.id, title: r.title, body: r.body, level: r.level, starts_at: r.starts_at.toISOString(), ends_at: r.ends_at ? r.ends_at.toISOString() : null, state: stateOf(r, now), channels: r.channels });

// What everyone sees right now: the live ones for the shell.
export async function liveAnnouncements(deps: AppDeps): Promise<AnnouncementView[]> {
  const now = deps.now();
  const r = await deps.db.query<Row>(
    `SELECT id, title, body, level, channels, starts_at, ends_at, archived_at FROM announcements
     WHERE archived_at IS NULL AND 'shell' = ANY(channels) AND starts_at <= to_timestamp($1 / 1000.0) AND (ends_at IS NULL OR ends_at > to_timestamp($1 / 1000.0)) ORDER BY starts_at DESC LIMIT 5`, [now]);
  return r.rows.map((x) => view(x, now));
}

export async function listAnnouncements(deps: AppDeps): Promise<AnnouncementView[]> {
  const now = deps.now();
  const r = await deps.db.query<Row>(`SELECT id, title, body, level, channels, starts_at, ends_at, archived_at FROM announcements ORDER BY created_at DESC LIMIT 100`);
  return r.rows.map((x) => view(x, now));
}

export async function createAnnouncement(deps: AppDeps, admin: SessionUser, input: { title: string; body: string; level: 'info' | 'warning'; starts_at?: string; ends_at?: string }, ctx: Ctx): Promise<AnnouncementView> {
  const start = input.starts_at ? new Date(input.starts_at) : new Date(deps.now());
  const end = input.ends_at ? new Date(input.ends_at) : null;
  if (end && end.getTime() <= start.getTime()) throw new ApiError(400, 'bad_dates', 'It has to end after it starts.');
  const id = newId('a');
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO announcements (id, title, body, level, starts_at, ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, input.title, input.body, input.level, start, end, admin.userId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'announcement.created', targetType: 'announcement', targetId: id, after: { title: input.title, level: input.level, starts_at: start.toISOString(), ends_at: end?.toISOString() ?? null }, origin: 'web', ipHash: ctx.ipHash });
  });
  return (await listAnnouncements(deps)).find((a) => a.id === id)!;
}

// Ending one early hides it at once and keeps the record.
export async function archiveAnnouncement(deps: AppDeps, admin: SessionUser, id: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE announcements SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`, [id]);
    if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'No such announcement, or it is already ended.');
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'announcement.archived', targetType: 'announcement', targetId: id, origin: 'web', ipHash: ctx.ipHash });
  });
}

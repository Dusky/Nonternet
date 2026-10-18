import { CLIENT_SCHEMAS, CLIENT_SETTINGS_MAX_BYTES, desktopClientSchema, type ClientName, type DesktopClient } from '@app/shared';
import { audit } from './audit';
import type { AppDeps } from './deps';
import type { Queryable } from './db';
import { ApiError } from './errors';
import type { SessionUser } from './accounts';

// The chat and MUD clients' settings (docs/08, 18): one JSON document per person per client, checked against
// its schema on the way in and on the way out (so an old document gains new defaults).
export async function getClientSettings(q: Queryable, userId: string, client: ClientName): Promise<unknown> {
  const r = await q.query<{ data: unknown }>(`SELECT data FROM client_settings WHERE user_id = $1 AND client = $2`, [userId, client]);
  // Someone who never arranged their desktop gets the site's default layout, if an admin set one.
  const start = r.rows[0] ? r.rows[0].data : client === 'desktop' ? (await desktopDefault(q)) ?? {} : {};
  const parsed = CLIENT_SCHEMAS[client].safeParse(start);
  return parsed.success ? parsed.data : CLIENT_SCHEMAS[client].parse({});
}

// The site's default desktop layout (docs/10): only the shared parts of a layout. Shortcuts, folders and notes point at one
// person's own things, so they never go into it, and neither do positions for them.
export function sharedLayout(input: unknown): DesktopClient {
  const d = desktopClientSchema.parse(input);
  const own = (k: string) => k.startsWith('sc:') || k.startsWith('fd:');
  return desktopClientSchema.parse({
    positions: Object.fromEntries(Object.entries(d.positions).filter(([k]) => !own(k))),
    phone_order: d.phone_order.filter((k) => !own(k)),
    hidden: d.hidden, widgets_set: d.widgets_set, widgets: d.widgets,
  });
}

export async function desktopDefault(q: Queryable): Promise<DesktopClient | null> {
  const r = await q.query<{ data: unknown }>(`SELECT data FROM site_defaults WHERE key = 'desktop'`);
  const p = r.rows[0] ? desktopClientSchema.safeParse(r.rows[0].data) : null;
  return p?.success ? p.data : null;
}

export async function setDesktopDefault(deps: AppDeps, v: SessionUser, input: unknown | null, ctx: { ipHash?: string | null }): Promise<DesktopClient | null> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can set the site\'s default desktop.');
  return deps.db.tx(async (q) => {
    const before = await desktopDefault(q);
    if (input === null) {
      await q.query(`DELETE FROM site_defaults WHERE key = 'desktop'`);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'site.desktop_default_cleared', targetType: 'site', targetId: 'desktop', before, origin: 'web', ipHash: ctx.ipHash });
      return null;
    }
    const layout = sharedLayout(input);
    await q.query(`INSERT INTO site_defaults (key, data, updated_by) VALUES ('desktop', $1, $2) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(layout), v.userId]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'site.desktop_default_set', targetType: 'site', targetId: 'desktop', before, after: layout, origin: 'web', ipHash: ctx.ipHash });
    return layout;
  });
}

export async function putClientSettings(deps: AppDeps, v: SessionUser, client: ClientName, input: unknown): Promise<unknown> {
  const parsed = CLIENT_SCHEMAS[client].safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'invalid', parsed.error.issues[0]?.message ?? 'Those settings are not valid.');
  const json = JSON.stringify(parsed.data);
  if (Buffer.byteLength(json) > CLIENT_SETTINGS_MAX_BYTES) throw new ApiError(413, 'too_large', 'Those settings are too big to keep. Remove some rules first.');
  await deps.db.query(
    `INSERT INTO client_settings (user_id, client, data) VALUES ($1, $2, $3) ON CONFLICT (user_id, client) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [v.userId, client, json]);
  return parsed.data;
}

import { CLIENT_SCHEMAS, CLIENT_SETTINGS_MAX_BYTES, type ClientName } from '@app/shared';
import type { AppDeps } from './deps';
import type { Queryable } from './db';
import { ApiError } from './errors';
import type { SessionUser } from './accounts';

// The chat and MUD clients' settings (docs/08, 18): one JSON document per person per client, checked against
// its schema on the way in and on the way out (so an old document gains new defaults).
export async function getClientSettings(q: Queryable, userId: string, client: ClientName): Promise<unknown> {
  const r = await q.query<{ data: unknown }>(`SELECT data FROM client_settings WHERE user_id = $1 AND client = $2`, [userId, client]);
  const parsed = CLIENT_SCHEMAS[client].safeParse(r.rows[0]?.data ?? {});
  return parsed.success ? parsed.data : CLIENT_SCHEMAS[client].parse({});
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

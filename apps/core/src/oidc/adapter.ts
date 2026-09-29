import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { Db } from '../db';

// The record types that belong to a grant and die with it. Revoking a grant removes these and
// nothing else: the in-flight sign-in (Interaction) and the browser Session can carry the same grant
// ID and must survive, or a sign-in that has just ended someone else's session would lose its own state.
const GRANTABLE = ['AccessToken', 'AuthorizationCode', 'RefreshToken', 'DeviceCode', 'BackchannelAuthenticationRequest'];

// Stores the provider's records in Postgres (table oidc_payloads).
export function postgresAdapterFactory(db: Db): (name: string) => Adapter {
  return (name: string): Adapter => ({
    async upsert(id, payload, expiresIn) {
      await db.query(
        `INSERT INTO oidc_payloads (id, type, payload, grant_id, user_code, uid, account_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8 * interval '1 second')
         ON CONFLICT (id, type) DO UPDATE SET payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id,
           user_code = EXCLUDED.user_code, uid = EXCLUDED.uid, account_id = EXCLUDED.account_id, expires_at = EXCLUDED.expires_at`,
        [id, name, JSON.stringify(payload), payload.grantId ?? null, payload.userCode ?? null, payload.uid ?? null, payload.accountId ?? null, expiresIn]);
    },

    async find(id) {
      return one(await db.query(`SELECT payload, consumed_at FROM oidc_payloads WHERE id = $1 AND type = $2 AND (expires_at IS NULL OR expires_at > now())`, [id, name]));
    },
    async findByUid(uid) {
      return one(await db.query(`SELECT payload, consumed_at FROM oidc_payloads WHERE uid = $1 AND type = $2 AND (expires_at IS NULL OR expires_at > now())`, [uid, name]));
    },
    async findByUserCode(userCode) {
      return one(await db.query(`SELECT payload, consumed_at FROM oidc_payloads WHERE user_code = $1 AND type = $2 AND (expires_at IS NULL OR expires_at > now())`, [userCode, name]));
    },

    async consume(id) {
      await db.query(`UPDATE oidc_payloads SET consumed_at = now() WHERE id = $1 AND type = $2`, [id, name]);
    },
    async destroy(id) {
      await db.query(`DELETE FROM oidc_payloads WHERE id = $1 AND type = $2`, [id, name]);
    },
    async revokeByGrantId(grantId) {
      await db.query(`DELETE FROM oidc_payloads WHERE grant_id = $1 AND type = ANY($2)`, [grantId, GRANTABLE]);
    },
  });
}

function one(r: { rows: { payload: AdapterPayload; consumed_at: Date | null }[] }): AdapterPayload | undefined {
  const row = r.rows[0];
  if (!row) return undefined;
  // The provider expects `consumed` as seconds since the epoch.
  return row.consumed_at ? { ...row.payload, consumed: Math.floor(new Date(row.consumed_at).getTime() / 1000) } : row.payload;
}

// Called from housekeeping: expired records are useless, so remove them.
export async function pruneOidc(db: Db): Promise<number> {
  const r = await db.query(`DELETE FROM oidc_payloads WHERE expires_at < now()`);
  return r.rowCount;
}

// Ends every OIDC grant and token for a user (suspension, password reset, 2FA reset). Services
// holding a refresh token can no longer renew it, and access tokens stop working at once.
export async function revokeOidcForUser(q: { query: Db['query'] }, userId: string): Promise<number> {
  const r = await q.query(`DELETE FROM oidc_payloads WHERE account_id = $1 OR payload->>'accountId' = $1`, [userId]);
  return r.rowCount;
}

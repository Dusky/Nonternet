import { randomBytes } from 'node:crypto';
import { audit } from '../audit';
import { newId } from '../crypto';
import { isUniqueViolation } from '../db';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { assertCanHost } from './service';
import type { Ctx, SessionUser } from '../accounts';

export const VERIFY_LABEL = '_home-verify';   // the TXT record goes at _home-verify.{domain}
export const txtValue = (token: string) => `home-verify=${token}`;

export interface DomainView {
  domain: string; status: 'pending' | 'verified'; verified_at: string | null; last_checked_at: string | null; last_error: string | null;
  dns: { txt: { name: string; value: string }; point_to: { type: 'CNAME' | 'A'; value: string; note: string } };
}

// A public web name a person could own: at least two labels, letters, digits and hyphens, and not
// ours (the site's own names and everything under the homes domain).
export function cleanDomain(input: string, deps: Pick<AppDeps, 'config'>): string {
  const d = input.trim().toLowerCase().replace(/\.$/, '');
  if (d.length > 253 || !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    throw new ApiError(400, 'bad_domain', 'That does not look like a domain name. For example: mysite.com or www.mysite.com.');
  }
  const own = [deps.config.site.domain, deps.config.site.homes_domain].map((x) => x.toLowerCase());
  if (own.some((o) => d === o || d.endsWith(`.${o}`))) throw new ApiError(400, 'own_domain', 'That name belongs to this site. Use a domain of your own.');
  return d;
}

const view = (deps: AppDeps, handle: string, r: { domain: string; verify_token: string; status: 'pending' | 'verified'; verified_at: Date | null; last_checked_at: Date | null; last_error: string | null }): DomainView => {
  const apex = r.domain.split('.').length === 2;
  const ip = deps.config.homes.public_ip;
  return {
    domain: r.domain, status: r.status, verified_at: r.verified_at ? r.verified_at.toISOString() : null,
    last_checked_at: r.last_checked_at ? r.last_checked_at.toISOString() : null, last_error: r.last_error,
    dns: {
      txt: { name: `${VERIFY_LABEL}.${r.domain}`, value: txtValue(r.verify_token) },
      // A name with a www or other prefix can point at us with a CNAME. A bare domain cannot have a
      // CNAME, so it needs an A record (or an ALIAS or ANAME record if the DNS host offers one).
      point_to: apex && ip
        ? { type: 'A', value: ip, note: 'Or an ALIAS or ANAME record to the address below, if your DNS host has those.' }
        : { type: 'CNAME', value: new URL(deps.homesUrl(handle)).hostname, note: apex ? 'A bare domain cannot use a CNAME; use an A, ALIAS or ANAME record to the same place.' : '' },
    },
  };
};

export async function listDomains(deps: AppDeps, v: SessionUser): Promise<{ domains: DomainView[]; max: number }> {
  assertCanHost(v);
  const r = await deps.db.query<{ domain: string; verify_token: string; status: 'pending' | 'verified'; verified_at: Date | null; last_checked_at: Date | null; last_error: string | null }>(
    `SELECT domain, verify_token, status, verified_at, last_checked_at, last_error FROM custom_domains WHERE user_id = $1 ORDER BY created_at`, [v.userId]);
  return { domains: r.rows.map((x) => view(deps, v.handle, x)), max: deps.config.homes.max_domains };
}

export async function addDomain(deps: AppDeps, v: SessionUser, input: string, ctx: Ctx): Promise<DomainView> {
  assertCanHost(v);
  const domain = cleanDomain(input, deps);
  const token = randomBytes(16).toString('hex');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [v.userId]);
      if ((await q.query(`SELECT 1 FROM custom_domains WHERE user_id = $1 AND domain = $2`, [v.userId, domain])).rowCount > 0) throw new ApiError(409, 'exists', 'You already added that domain.');
      const n = await q.query<{ n: string }>(`SELECT count(*) AS n FROM custom_domains WHERE user_id = $1`, [v.userId]);
      if (Number(n.rows[0]!.n) >= deps.config.homes.max_domains) throw new ApiError(409, 'too_many_domains', `You can have up to ${deps.config.homes.max_domains} domains. Remove one first.`);
      const taken = await q.query(`SELECT 1 FROM custom_domains WHERE domain = $1 AND status = 'verified'`, [domain]);
      if (taken.rowCount > 0) throw new ApiError(409, 'domain_taken', 'Someone has already verified that domain.');
      await q.query(`INSERT INTO custom_domains (id, user_id, domain, verify_token) VALUES ($1, $2, $3, $4)`, [newId('d'), v.userId, domain, token]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'custom_domain.added', targetType: 'custom_domain', targetId: domain, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'exists', 'You already added that domain.');
    throw err;
  }
  return (await listDomains(deps, v)).domains.find((d) => d.domain === domain)!;
}

// Looks for the TXT record. A record that is not there yet is normal, since DNS takes a while to spread.
export async function verifyDomain(deps: AppDeps, v: SessionUser, input: string, ctx: Ctx): Promise<DomainView> {
  assertCanHost(v);
  const domain = cleanDomain(input, deps);
  const r = await deps.db.query<{ verify_token: string; status: string }>(`SELECT verify_token, status FROM custom_domains WHERE user_id = $1 AND domain = $2`, [v.userId, domain]);
  const row = r.rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'You have not added that domain.');
  if (row.status === 'verified') return (await listDomains(deps, v)).domains.find((d) => d.domain === domain)!;

  const name = `${VERIFY_LABEL}.${domain}`;
  let found: string[] = [];
  let lookupError: string | null = null;
  try {
    found = (await deps.dnsTxt(name)).map((parts) => parts.join(''));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    lookupError = code === 'ENOTFOUND' || code === 'ENODATA' ? null : 'The DNS lookup did not answer. Try again in a few minutes.';
  }
  const ok = found.includes(txtValue(row.verify_token));
  const error = ok ? null : lookupError ?? (found.length ? `Found ${found.length} TXT record${found.length === 1 ? '' : 's'} at ${name}, but none matches.` : `No TXT record found at ${name} yet. DNS changes can take a while to show up.`);
  try {
    await deps.db.tx(async (q) => {
      await q.query(`UPDATE custom_domains SET last_checked_at = now(), last_error = $3 WHERE user_id = $1 AND domain = $2`, [v.userId, domain, error]);
      if (ok) {
        await q.query(`UPDATE custom_domains SET status = 'verified', verified_at = now() WHERE user_id = $1 AND domain = $2`, [v.userId, domain]);
        // Anyone else who had only asked for this name loses their request: it is taken now.
        await q.query(`DELETE FROM custom_domains WHERE domain = $1 AND user_id <> $2 AND status = 'pending'`, [domain, v.userId]);
        await audit(q, { actorId: v.userId, actorKind: 'user', action: 'custom_domain.verified', targetType: 'custom_domain', targetId: domain, origin: 'web', ipHash: ctx.ipHash });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'domain_taken', 'Someone else verified that domain first.');
    throw err;
  }
  if (!ok) throw new ApiError(409, 'not_verified', error!);
  return (await listDomains(deps, v)).domains.find((d) => d.domain === domain)!;
}

export async function removeDomain(deps: AppDeps, v: SessionUser, input: string, ctx: Ctx): Promise<void> {
  assertCanHost(v);
  const domain = cleanDomain(input, deps);
  await deps.db.tx(async (q) => {
    const r = await q.query(`DELETE FROM custom_domains WHERE user_id = $1 AND domain = $2`, [v.userId, domain]);
    if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'You have not added that domain.');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'custom_domain.removed', targetType: 'custom_domain', targetId: domain, origin: 'web', ipHash: ctx.ipHash });
  });
}

// Caddy asks this before it gets a certificate for a name it has not seen (docs/15): only our own
// people's homepage names and verified custom domains are worth one. Nothing else is.
export async function mayHaveCertificate(deps: AppDeps, host: string): Promise<boolean> {
  const d = host.trim().toLowerCase();
  const homes = deps.config.site.homes_domain.toLowerCase();
  if (d.endsWith(`.${homes}`)) {
    const label = d.slice(0, -(homes.length + 1));
    if (!/^[a-z][a-z0-9_-]{1,19}$/.test(label)) return false;
    return (await deps.db.query(`SELECT 1 FROM users WHERE lower(handle) = $1 AND status = 'active'`, [label])).rowCount > 0;
  }
  return (await deps.db.query(
    `SELECT 1 FROM custom_domains c JOIN users u ON u.id = c.user_id WHERE c.domain = $1 AND c.status = 'verified' AND u.status = 'active'`, [d])).rowCount > 0;
}

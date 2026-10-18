import { createHmac } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';
import { createChallenge, verifySolution, type Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import { hashIp } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { DISPOSABLE_DOMAINS } from './disposable-domains';
import { ApiError } from './errors';

// Protections for open and application sign-up (docs/15, 17 2026-10-18): a proof-of-work check, a daily limit per
// network, and email domain rules. Invite sign-up skips the first two: an invite is already a gate an admin handed out.

// ---------------------------------------------------------------- proof of work (ALTCHA)

// SHA-256 with a four-hex-digit prefix: about 65,000 tries on average, a second or two in a browser, and one hash to check.
const POW = { algorithm: 'SHA-256', cost: 1, keyPrefix: '0000' } as const;
const POW_MINUTES = 10;
const powSecret = (deps: AppDeps) => createHmac('sha256', deps.secretKey).update('signup-proof-of-work').digest('hex');

export const needsProof = (deps: AppDeps) => deps.config.signup.mode !== 'invite' && deps.config.signup.proof_of_work;

export async function signupChallenge(deps: AppDeps): Promise<Challenge | null> {
  if (!needsProof(deps)) return null;
  return createChallenge({ ...POW, deriveKey, expiresAt: Math.floor(deps.now() / 1000) + POW_MINUTES * 60, hmacSignatureSecret: powSecret(deps) });
}

const proofFailed = () => new ApiError(400, 'proof_failed', 'The check that this is a real browser did not finish. Reload the page and try again.');

// `proof` is the base64 JSON { challenge, solution } the shell sends. Each solved challenge works once.
export async function checkProof(deps: AppDeps, q: Queryable, proof: string | undefined): Promise<void> {
  if (!needsProof(deps)) return;
  if (!proof) throw proofFailed();
  let payload: { challenge: Challenge; solution: { counter: number; derivedKey: string } };
  try { payload = JSON.parse(Buffer.from(proof, 'base64').toString('utf8')); } catch { throw proofFailed(); }
  const p = payload?.challenge?.parameters;
  // Only challenges this server would have made: the same algorithm, cost and prefix.
  if (!p || p.algorithm !== POW.algorithm || p.cost !== POW.cost || p.keyPrefix !== POW.keyPrefix || typeof payload.challenge.signature !== 'string') throw proofFailed();
  const r = await verifySolution({ challenge: payload.challenge, solution: payload.solution, deriveKey, hmacSignatureSecret: powSecret(deps) }).catch(() => null);
  if (!r?.verified || (p.expiresAt && p.expiresAt * 1000 < deps.now())) throw proofFailed();
  await q.query(`DELETE FROM signup_proofs WHERE expires_at < now()`);
  const used = await q.query(`INSERT INTO signup_proofs (signature, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING`, [payload.challenge.signature, p.expiresAt ?? Math.floor(deps.now() / 1000) + POW_MINUTES * 60]);
  if (!used.rowCount) throw proofFailed();
}

// ---------------------------------------------------------------- networks

// The network an address belongs to: /24 for IPv4, /48 for IPv6 (where one home or small office usually gets).
export function networkOf(ip: string): string | null {
  const v4 = ip.startsWith('::ffff:') && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (!isIPv6(ip)) return null;
  const [head = '', tail = ''] = ip.split('%')[0]!.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups.slice(0, 3).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/48`;
}

// Only a keyed hash of the network is kept, like every other address (docs/15).
export const networkHash = (deps: AppDeps, ip: string | undefined): string | null => {
  const net = ip ? networkOf(ip) : null;
  return net ? hashIp(deps.secretKey, `net:${net}`) : null;
};

export async function checkNetwork(deps: AppDeps, q: Queryable, net: string | null): Promise<void> {
  const max = deps.config.signup.per_network_per_day;
  if (!net || max === 0 || deps.config.signup.mode === 'invite') return;
  const n = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE signup_net = $1 AND created_at > now() - interval '1 day'`, [net]);
  if (n.rows[0]!.n >= max) throw new ApiError(429, 'network_limit', 'Too many accounts were made from your network today. Try again tomorrow, or ask the admins for an invite.');
}

// ---------------------------------------------------------------- email domains

let disposable: Set<string> | null = null;
let disposableFrom = '';
// The bundled list, or the newer copy sitectl downloaded (DISPOSABLE_DOMAINS_FILE), reread when that file changes.
function disposableSet(): Set<string> {
  const file = process.env.DISPOSABLE_DOMAINS_FILE ?? '';
  let stamp = '';
  if (file) { try { stamp = `${file}@${statSync(file).mtimeMs}`; } catch { /* no newer copy yet */ } }
  if (disposable && disposableFrom === stamp) return disposable;
  let text = DISPOSABLE_DOMAINS;
  if (stamp) { try { text = readFileSync(file, 'utf8'); } catch { /* keep the bundled list */ } }
  disposable = new Set(text.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
  disposableFrom = stamp;
  return disposable;
}

const domainsIn = (list: string) => list.toLowerCase().split(/[\s,]+/).map((d) => d.replace(/^\.+|\.+$/g, '')).filter(Boolean);
// example.org covers mail.example.org too.
const covers = (domain: string, d: string) => domain === d || domain.endsWith(`.${d}`);

export function checkEmailDomain(deps: AppDeps, email: string): void {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '');
  const cfg = deps.config.signup;
  if (domainsIn(cfg.email_deny).some((d) => covers(domain, d))) {
    throw new ApiError(400, 'email_domain_refused', 'This site does not accept addresses at that email service. Use another address.');
  }
  if (domainsIn(cfg.email_allow).some((d) => covers(domain, d))) return;
  if (cfg.block_disposable_email) {
    const set = disposableSet();
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      if (set.has(parts.slice(i).join('.'))) throw new ApiError(400, 'email_disposable', 'That looks like a throwaway email address. Use one you will keep, so you can get back into your account.');
    }
  }
}

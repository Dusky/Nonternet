import webpush from 'web-push';
import { MAX_PUSH_DEVICES, toPublicSite, type PushDevice, type PushKind } from '@app/shared';
import { makeT } from '@app/strings';
import type { JobHelpers, Task } from 'graphile-worker';
import type { SessionUser } from './accounts';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// Push notifications (docs/10, decided 2026-10-05). A browser that allows it gives us an address at its push service;
// we send it a short encrypted message and the service wakes the device. What a message says is what the notification
// shows (who, and where) and never the text of a post or a letter. Sending is a job (graphile-worker), so a push
// service that is down is tried again with backoff, and a post never waits on one.

export interface PushDeps { publicKey: string; privateKey: string; subject: string }

// VAPID keys say the messages come from this site. Without them push is off and nothing is queued.
export function pushFromEnv(env: NodeJS.ProcessEnv, domain: string): PushDeps | undefined {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return undefined;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || `mailto:admin@${domain}` };
}

export const newVapidKeys = (): { publicKey: string; privateKey: string } => webpush.generateVAPIDKeys();

interface Row { id: string; endpoint: string; label: string; kinds: PushKind[]; created_at: Date; last_used_at: Date | null }
const view = (r: Row): PushDevice => ({ id: r.id, endpoint: r.endpoint, label: r.label, kinds: r.kinds, created_at: r.created_at.toISOString(), last_used_at: r.last_used_at?.toISOString() ?? null });

export async function listDevices(deps: AppDeps, userId: string): Promise<PushDevice[]> {
  const r = await deps.db.query<Row>(`SELECT id, endpoint, label, kinds, created_at, last_used_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return r.rows.map(view);
}

// A browser signing up, or signing up again (same address: the kinds and keys are updated). A browser shared by two
// accounts belongs to whoever turned push on last, so one person's notifications never reach another's screen.
export async function subscribe(deps: AppDeps, user: SessionUser, input: { endpoint: string; keys: { p256dh: string; auth: string }; kinds: PushKind[]; label?: string }): Promise<PushDevice> {
  if (!deps.push) throw new ApiError(404, 'push_off', 'This site does not send push notifications.');
  return deps.db.tx(async (q) => {
    const r = await q.query<Row>(
      `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, kinds, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         kinds = EXCLUDED.kinds, label = EXCLUDED.label, failures = 0
       RETURNING id, endpoint, label, kinds, created_at, last_used_at`,
      [newId('ps'), user.userId, user.sessionId, input.endpoint, input.keys.p256dh, input.keys.auth, [...new Set(input.kinds)], input.label ?? '']);
    // Ten devices each at most: the oldest goes when an eleventh signs up.
    await q.query(`DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2)`, [user.userId, MAX_PUSH_DEVICES]);
    return view(r.rows[0]!);
  });
}

export async function updateDevice(deps: AppDeps, user: SessionUser, id: string, kinds: PushKind[]): Promise<void> {
  const r = await deps.db.query(`UPDATE push_subscriptions SET kinds = $3 WHERE id = $1 AND user_id = $2`, [id, user.userId, [...new Set(kinds)]]);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'That device is not on your account.');
}

export async function removeDevice(deps: AppDeps, user: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(`DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2`, [id, user.userId]);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'That device is not on your account.');
}

export interface PushMessage { title: string; body: string; url: string; tag: string }

// One job per device that wants this kind and whose session is still signed in. Runs inside the caller's transaction,
// so a post that is rolled back queues nothing. Nothing is queued when push is off.
export async function queuePush(deps: AppDeps, q: Queryable, userIds: string[], kind: PushKind, message: PushMessage): Promise<number> {
  if (!deps.push || userIds.length === 0) return 0;
  const r = await q.query(
    `SELECT graphile_worker.add_job('push_send', json_build_object('sub', s.id, 'title', $3::text, 'body', $4::text, 'url', $5::text, 'tag', $6::text), max_attempts => 5)
       FROM push_subscriptions s JOIN sessions x ON x.id = s.session_id AND x.revoked_at IS NULL AND x.expires_at > now()
      WHERE s.user_id = ANY($1) AND $2 = ANY(s.kinds)`,
    [userIds, kind, message.title, message.body, message.url, message.tag]);
  return r.rowCount;
}

// The words a notification shows, in the site's own name.
export function pushText(deps: AppDeps, kind: PushKind, vars: { name: string; board?: string }): { title: string; body: string } {
  const t = makeT(toPublicSite(deps.config));
  return { title: deps.config.site.name, body: t(`push.${kind}`, { name: vars.name, board: vars.board ?? '' }) };
}

interface Job { sub: string; title: string; body: string; url: string; tag: string }

// The job: send one message to one device. A device the push service says is gone (404, 410) is forgotten; any
// other failure throws, and graphile-worker tries again later (up to five times).
export function pushTask(deps: AppDeps, send: typeof webpush.sendNotification = webpush.sendNotification.bind(webpush)): Task {
  return async (payload: unknown, helpers: JobHelpers) => {
    const job = payload as Job;
    if (!deps.push) return;
    const r = await deps.db.query<{ endpoint: string; p256dh: string; auth: string }>(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE id = $1`, [job.sub]);
    const s = r.rows[0];
    if (!s) return; // removed since: nothing to do
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.tag }),
        { vapidDetails: { subject: deps.push.subject, publicKey: deps.push.publicKey, privateKey: deps.push.privateKey }, TTL: 60 * 60 * 24, urgency: 'normal', timeout: 10_000 });
      await deps.db.query(`UPDATE push_subscriptions SET last_used_at = now(), failures = 0 WHERE id = $1`, [job.sub]);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await deps.db.query(`DELETE FROM push_subscriptions WHERE id = $1`, [job.sub]);
        helpers.logger.info(`push: ${job.sub} is gone (${status}); forgotten`);
        return;
      }
      await deps.db.query(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1`, [job.sub]);
      throw e;
    }
  };
}

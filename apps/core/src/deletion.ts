import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { en } from '@app/strings';
import { audit } from './audit';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { emit } from './events';
import { revokeAllSessions, requireSecondFactor, type Ctx, type SessionUser } from './accounts';
import { verifyPassword } from './passwords';

// Deleting an account (docs/12). What happens to what the person made:
//   - their homepage, files, custom domains, exports and keys are deleted;
//   - their rings and boards: a ring must be handed over or archived first; boards they own are archived;
//   - their posts and guestbook entries stay without their name ("posts: keep", the default, so
//     conversations still make sense) or are erased ("posts: erase", each becomes a tombstone) — their choice;
//   - the row itself stays, emptied of anything personal, so nothing that points at it breaks;
//   - the handle is held for 90 days so nobody can pick up their old address.
export type PostsChoice = 'keep' | 'erase';

export async function deleteAccount(deps: AppDeps, userId: string, opts: { posts: PostsChoice; actor: SessionUser | null; reason?: string }, ctx: Ctx): Promise<void> {
  let exportIds: string[] = [];
  await deps.db.tx(async (q) => {
    const r = await q.query<{ handle: string; role: string; status: string }>(`SELECT handle, role, status FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const u = r.rows[0];
    if (!u || u.status === 'deleted') throw new ApiError(404, 'not_found', 'No such user.');
    if (u.role === 'admin') {
      const others = await q.query(`SELECT 1 FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`, [userId]);
      if (others.rowCount === 0) throw new ApiError(409, 'last_admin', 'This is the only admin. Make someone else an admin first.');
    }
    const rings = await q.query<{ slug: string }>(`SELECT slug FROM rings WHERE founder_id = $1 AND archived_at IS NULL ORDER BY slug`, [userId]);
    if (rings.rowCount > 0) {
      throw new ApiError(409, 'owns_rings', `Hand over or archive ${rings.rows.length === 1 ? 'this ring' : 'these rings'} first: ${rings.rows.map((x) => x.slug).join(', ')}.`);
    }

    // Posts: anonymised in both cases; erased too if asked. Reply counts follow the ones that stop counting.
    if (opts.posts === 'erase') {
      await q.query(
        `UPDATE posts r SET reply_count = GREATEST(r.reply_count - x.n, 0)
         FROM (SELECT thread_root_id, count(*) AS n FROM posts WHERE author_id = $1 AND thread_root_id IS NOT NULL AND deleted_at IS NULL AND hidden_at IS NULL GROUP BY 1) x WHERE r.id = x.thread_root_id`, [userId]);
      await q.query(`UPDATE posts SET deleted_at = now(), deleted_by = 'author', subject = '', body = '' WHERE author_id = $1 AND deleted_at IS NULL`, [userId]);
    }
    await q.query(`UPDATE posts SET author_id = NULL WHERE author_id = $1`, [userId]);
    if (opts.posts === 'erase') await q.query(`UPDATE guestbook_entries SET message = '', name = $2, url = NULL, status = 'hidden', author_id = NULL WHERE author_id = $1`, [userId, en['account.deletedName']]);
    else await q.query(`UPDATE guestbook_entries SET name = $2, url = NULL, author_id = NULL WHERE author_id = $1`, [userId, en['account.deletedName']]);

    // Mail follows the same choice as posts: kept without their name, or erased. They leave every
    // conversation, and their blocks go.
    if (opts.posts === 'erase') await q.query(`UPDATE mail_messages SET body = '', deleted_at = COALESCE(deleted_at, now()) WHERE author_id = $1 AND kind = 'message'`, [userId]);
    await q.query(`UPDATE mail_messages SET author_id = NULL WHERE author_id = $1`, [userId]);
    await q.query(`UPDATE mail_participants SET left_at = COALESCE(left_at, now()) WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM user_blocks WHERE user_id = $1 OR blocked_id = $1`, [userId]);

    // Whatever they had on their own page goes with it.
    await q.query(`DELETE FROM guestbook_entries WHERE home_user_id = $1`, [userId]);
    await q.query(`DELETE FROM home_hit_seen WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM home_hits WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM homepages WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM custom_domains WHERE user_id = $1`, [userId]);

    // Boards they own are archived, so they stay readable but nobody has to run them.
    await q.query(`UPDATE boards SET archived_at = COALESCE(archived_at, now()) WHERE owner_id = $1 AND ring_id IS NULL`, [userId]);
    await q.query(`DELETE FROM watches WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM read_state WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM notifications WHERE user_id = $1 OR actor_id = $1`, [userId]);
    await q.query(`DELETE FROM board_members WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM ring_members WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM scoped_roles WHERE user_id = $1`, [userId]);
    exportIds = (await q.query<{ id: string }>(`DELETE FROM exports WHERE user_id = $1 RETURNING id`, [userId])).rows.map((x) => x.id);
    await q.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM email_verifications WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);

    // The handle is held, and the account becomes a husk nobody can log in to.
    await q.query(`INSERT INTO handle_history (user_id, handle) VALUES ($1, lower($2))`, [userId, u.handle]);
    const gone = `deleted-${userId.slice(-8).toLowerCase()}`;
    await q.query(
      `UPDATE users SET status = 'deleted', handle = $2, display_name = NULL, bio = NULL, email = $3, email_verified_at = NULL, password_hash = 'deleted',
         totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, public_key = NULL, private_key_enc = NULL, theme = NULL,
         role = 'guest', role_rev = role_rev + 1, updated_at = now() WHERE id = $1`, [userId, gone, `${gone}@deleted.invalid`]);
    await revokeAllSessions(q, userId, 'account_deleted');
    await audit(q, {
      actorId: opts.actor?.userId ?? userId, actorKind: 'user', action: 'user.deleted', targetType: 'user', targetId: userId,
      before: { handle: u.handle, role: u.role }, after: { posts: opts.posts, by: opts.actor && opts.actor.userId !== userId ? 'admin' : 'self', reason: opts.reason ?? null }, origin: 'web', ipHash: ctx.ipHash,
    });
    await emit(q, 'user.deleted', { user_id: userId });
  });
  // Files last, outside the transaction: if this fails, the account is already gone and a leftover folder can be cleaned up.
  await deps.homes.removeAll(userId).catch(() => undefined);
  for (const id of exportIds) await fs.rm(join(deps.exportsDir, `${id}.zip`), { force: true });
}

// The person deleting their own account proves it is them, as strictly as logging in.
export async function deleteOwnAccount(
  deps: AppDeps, v: SessionUser, input: { password: string; totp?: string; recovery_code?: string; confirm_handle: string; posts: PostsChoice }, ctx: Ctx,
): Promise<void> {
  const r = await deps.db.query<{ password_hash: string; totp_enabled_at: Date | null; totp_secret_enc: string | null; handle: string }>(
    `SELECT password_hash, totp_enabled_at, totp_secret_enc, handle FROM users WHERE id = $1`, [v.userId]);
  const u = r.rows[0]!;
  if (input.confirm_handle.trim().toLowerCase() !== u.handle.toLowerCase()) throw new ApiError(400, 'confirm_mismatch', 'Type your handle exactly to confirm.');
  if (!(await verifyPassword(u.password_hash, input.password))) throw new ApiError(400, 'wrong_password', 'That is not your password.');
  await requireSecondFactor(deps, { id: v.userId, ...u }, input, ctx);
  await deleteAccount(deps, v.userId, { posts: input.posts, actor: v }, ctx);
}

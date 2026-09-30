import type { Queryable } from './db';

export interface AuditEntry {
  actorId?: string | null;
  actorKind: 'user' | 'system' | 'cli';
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  origin: 'web' | 'cli' | 'system' | 'console';
  ipHash?: string | null;
}

// Pass a transaction's queryable so the audit row commits or rolls back with the change itself.
export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (actor_id, actor_kind, action, target_type, target_id, before, after, origin, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.actorId ?? null, e.actorKind, e.action, e.targetType ?? null, e.targetId ?? null,
     e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.origin, e.ipHash ?? null],
  );
}

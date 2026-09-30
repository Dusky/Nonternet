import { audit } from './audit';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';

export const LEGAL_SLUGS = ['terms', 'privacy', 'acceptable-use', 'takedown'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
export const REQUEST_KINDS = ['copyright', 'illegal', 'privacy', 'other'] as const;

export interface LegalPage { slug: LegalSlug; title: string; body: string; version: number; updated_at: string | null; placeholder: boolean }

// Stand-in text so a new site is never without pages. It is NOT legal advice and says so at the top of every
// page until an admin replaces it (docs/15). The site name and contact come from config, never from here.
function defaults(deps: AppDeps, slug: LegalSlug): { title: string; body: string } {
  const { name, domain } = deps.config.site;
  const contact = `abuse@${domain}`;
  switch (slug) {
    case 'terms':
      return { title: 'Terms of service', body: `## Using ${name}\n\nThese are placeholder terms. The people who run ${name} have not written their real ones yet.\n\nYou are responsible for what you post. Do not post things that break the law or the acceptable use page. We can remove content and close accounts that do.\n\n## Your content\n\nWhat you make here is yours. You can export all of it, and delete your account, from Settings.` };
    case 'privacy':
      return { title: 'Privacy policy', body: `## What ${name} keeps\n\nThis is placeholder text. The people who run ${name} have not written their real policy yet.\n\nWe keep your account details, what you post, and a hashed form of your IP address for abuse handling. You can export or delete all of it from Settings.` };
    case 'acceptable-use':
      return { title: 'Acceptable use', body: `## Be decent\n\nThis is placeholder text. The people who run ${name} have not written their real rules yet.\n\nNo harassment, no spam, no illegal content, and nothing that puts other people at risk.` };
    case 'takedown':
      return { title: 'Takedown requests', body: `## If something here is yours or is illegal\n\nThis is placeholder text. Use the form on this page to tell the operators about content that infringes your rights or is illegal. You can also write to ${contact}.\n\nEvery request is read by an admin. Give the exact address of the page and say what is wrong with it.` };
  }
}

const isSlug = (s: string): s is LegalSlug => (LEGAL_SLUGS as readonly string[]).includes(s);

export async function getPage(deps: AppDeps, slug: string): Promise<LegalPage> {
  if (!isSlug(slug)) throw new ApiError(404, 'not_found', 'No such page.');
  const r = await deps.db.query<{ title: string; body: string; version: number; updated_at: Date }>(`SELECT title, body, version, updated_at FROM legal_pages WHERE slug = $1`, [slug]);
  const row = r.rows[0];
  if (!row) return { slug, ...defaults(deps, slug), version: 0, updated_at: null, placeholder: true };
  return { slug, title: row.title, body: row.body, version: row.version, updated_at: row.updated_at.toISOString(), placeholder: false };
}

export const listPages = (deps: AppDeps) => Promise.all(LEGAL_SLUGS.map((s) => getPage(deps, s)));

export async function savePage(deps: AppDeps, admin: SessionUser, slug: string, input: { title: string; body: string; reason: string }, ctx: Ctx): Promise<LegalPage> {
  if (!isSlug(slug)) throw new ApiError(404, 'not_found', 'No such page.');
  await deps.db.tx(async (q) => {
    const cur = await q.query<{ version: number; title: string; body: string }>(`SELECT version, title, body FROM legal_pages WHERE slug = $1 FOR UPDATE`, [slug]);
    const version = (cur.rows[0]?.version ?? 0) + 1;
    await q.query(
      `INSERT INTO legal_pages (slug, title, body, version, updated_at, updated_by) VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (slug) DO UPDATE SET title = $2, body = $3, version = $4, updated_at = now(), updated_by = $5`,
      [slug, input.title, input.body, version, admin.userId]);
    await q.query(`INSERT INTO legal_page_versions (slug, version, title, body, reason, changed_by) VALUES ($1, $2, $3, $4, $5, $6)`, [slug, version, input.title, input.body, input.reason, admin.userId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'legal.page_saved', targetType: 'legal_page', targetId: slug,
      before: cur.rows[0] ? { version: cur.rows[0].version, title: cur.rows[0].title } : null, after: { version, title: input.title, reason: input.reason }, origin: 'web', ipHash: ctx.ipHash });
  });
  return getPage(deps, slug);
}

export async function pageVersions(deps: AppDeps, slug: string) {
  if (!isSlug(slug)) throw new ApiError(404, 'not_found', 'No such page.');
  const r = await deps.db.query<{ version: number; title: string; reason: string; changed_at: Date; handle: string | null }>(
    `SELECT v.version, v.title, v.reason, v.changed_at, u.handle FROM legal_page_versions v LEFT JOIN users u ON u.id = v.changed_by WHERE v.slug = $1 ORDER BY v.version DESC LIMIT 50`, [slug]);
  return r.rows.map((x) => ({ version: x.version, title: x.title, reason: x.reason, changed_at: x.changed_at.toISOString(), changed_by: x.handle }));
}

// ---------------------------------------------------------------- takedown / legal requests

export interface LegalRequestInput { kind: (typeof REQUEST_KINDS)[number]; url: string; description: string; contact_name: string; contact_email: string; good_faith: boolean }

export async function submitRequest(deps: AppDeps, input: LegalRequestInput, ctx: Ctx): Promise<{ id: string }> {
  if (!input.good_faith) throw new ApiError(400, 'statement_required', 'Please confirm the statement at the bottom of the form.');
  const id = newId('lr');
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO legal_requests (id, kind, url, description, contact_name, contact_email, good_faith) VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [id, input.kind, input.url, input.description, input.contact_name, input.contact_email]);
    await audit(q, { actorKind: 'system', action: 'legal.request_received', targetType: 'legal_request', targetId: id, after: { kind: input.kind, url: input.url }, origin: 'web', ipHash: ctx.ipHash });
  });
  return { id };
}

export interface LegalRequestView extends LegalRequestInput { id: string; status: 'open' | 'actioned' | 'declined'; created_at: string; resolved_at: string | null; resolved_by: string | null; resolution_note: string | null }

export async function listRequests(deps: AppDeps, status?: string): Promise<LegalRequestView[]> {
  const r = await deps.db.query<Record<string, unknown>>(
    `SELECT r.*, u.handle AS resolver FROM legal_requests r LEFT JOIN users u ON u.id = r.resolved_by WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`, [status ?? null]);
  return r.rows.map((x) => ({
    id: x.id as string, kind: x.kind as LegalRequestView['kind'], url: x.url as string, description: x.description as string, contact_name: x.contact_name as string,
    contact_email: x.contact_email as string, good_faith: x.good_faith as boolean, status: x.status as LegalRequestView['status'],
    created_at: (x.created_at as Date).toISOString(), resolved_at: x.resolved_at ? (x.resolved_at as Date).toISOString() : null,
    resolved_by: (x.resolver as string | null) ?? null, resolution_note: (x.resolution_note as string | null) ?? null,
  }));
}

export async function resolveRequest(deps: AppDeps, admin: SessionUser, id: string, status: 'actioned' | 'declined', note: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE legal_requests SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1 AND status = 'open'`, [id, status, admin.userId, note]);
    if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'No such open request.');
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: `legal.request_${status}`, targetType: 'legal_request', targetId: id, after: { note }, origin: 'web', ipHash: ctx.ipHash });
  });
}

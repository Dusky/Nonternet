import type { FastifyInstance, FastifyRequest } from 'fastify';
import { wikiReasonSchema, wikiRefSchema, wikiRenameSchema, wikiRevertSchema, wikiSaveSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as wiki from '../wiki';

// The wiki (docs/20). `:wiki` is "site" or "ring:{slug}". Reading is open to visitors; everything else needs a session.
const slug = z.string().min(1).max(100);
const params = (req: FastifyRequest) => {
  const p = req.params as { wiki: string; slug?: string; revision?: string };
  return { ref: wikiRefSchema.parse(p.wiki), slug: p.slug === undefined ? '' : slug.parse(p.slug), revision: p.revision === undefined ? 0 : z.coerce.number().int().min(1).parse(p.revision) };
};
const reportBody = z.object({ category: z.enum(['spam', 'abuse', 'illegal', 'other']), note: z.string().trim().max(500).default('') });
const MODERATE = ['protect', 'unprotect', 'hide', 'unhide', 'delete', 'restore'] as const;

export function wikiRoutes(app: FastifyInstance, deps: AppDeps): void {
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.get('/api/v1/wiki/:wiki', async (req) => wiki.wikiInfo(deps, req.session, params(req).ref));
  app.get('/api/v1/wiki/:wiki/pages', async (req) => ({ pages: await wiki.listPages(deps, req.session, params(req).ref) }));
  app.get('/api/v1/wiki/:wiki/changes', async (req) => ({ changes: await wiki.changes(deps, req.session, params(req).ref) }));
  app.get('/api/v1/wiki/:wiki/wanted', async (req) => ({ wanted: await wiki.wanted(deps, req.session, params(req).ref) }));
  app.get('/api/v1/wiki/:wiki/search', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ q: z.string().trim().min(2, 'type at least two letters').max(200) }).parse(req.query).q;
    return { hits: await wiki.search(deps, req.session, params(req).ref, q) };
  });
  app.get('/api/v1/wiki/:wiki/pages/:slug', async (req) => { const p = params(req); return wiki.getPage(deps, req.session, p.ref, p.slug); });
  app.put('/api/v1/wiki/:wiki/pages/:slug', write, async (req) => {
    const p = params(req);
    return wiki.savePage(deps, requireUser(req), p.ref, p.slug, wikiSaveSchema.parse(req.body));
  });
  app.get('/api/v1/wiki/:wiki/pages/:slug/history', async (req) => { const p = params(req); return { revisions: await wiki.history(deps, req.session, p.ref, p.slug) }; });
  app.get('/api/v1/wiki/:wiki/pages/:slug/revisions/:revision', async (req) => { const p = params(req); return wiki.getRevision(deps, req.session, p.ref, p.slug, p.revision); });
  app.get('/api/v1/wiki/:wiki/pages/:slug/links-here', async (req) => { const p = params(req); return { pages: await wiki.linksHere(deps, req.session, p.ref, p.slug) }; });
  app.post('/api/v1/wiki/:wiki/pages/:slug/revert', write, async (req) => {
    const p = params(req);
    const b = wikiRevertSchema.parse(req.body);
    return wiki.revert(deps, requireUser(req), p.ref, p.slug, b.revision, b.base_revision);
  });
  app.post('/api/v1/wiki/:wiki/pages/:slug/rename', write, async (req) => {
    const p = params(req);
    const b = wikiRenameSchema.parse(req.body);
    return wiki.rename(deps, requireUser(req), p.ref, p.slug, b.title, b.base_revision);
  });
  app.post('/api/v1/wiki/:wiki/pages/:slug/:action', write, async (req) => {
    const p = params(req);
    const action = z.enum(MODERATE).parse((req.params as { action: string }).action);
    const reason = action === 'protect' || action === 'unprotect' || action === 'restore' || action === 'unhide' ? z.object({ reason: z.string().trim().max(500).default('') }).parse(req.body ?? {}).reason : wikiReasonSchema.parse(req.body).reason;
    return wiki.moderate(deps, requireUser(req), p.ref, p.slug, action, reason, ctxOf(deps, req));
  });
  app.post('/api/v1/wiki/:wiki/pages/:slug/revisions/:revision/:action', write, async (req, reply) => {
    const p = params(req);
    const action = z.enum(['hide', 'show']).parse((req.params as { action: string }).action);
    await wiki.hideRevision(deps, requireUser(req), p.ref, p.slug, p.revision, action === 'hide', wikiReasonSchema.parse(req.body).reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/wiki/:wiki/pages/:slug/report', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = params(req);
    const b = reportBody.parse(req.body);
    return reply.code(201).send(await wiki.reportPage(deps, requireUser(req), p.ref, p.slug, b.category, b.note, ctxOf(deps, req)));
  });
  app.put('/api/v1/rings/:ring/wiki', async (req, reply) => {
    const ring = z.string().min(2).max(31).parse((req.params as { ring: string }).ring);
    await wiki.setRingWiki(deps, requireUser(req), ring, z.object({ enabled: z.boolean() }).parse(req.body).enabled, ctxOf(deps, req));
    return reply.code(204).send();
  });
}

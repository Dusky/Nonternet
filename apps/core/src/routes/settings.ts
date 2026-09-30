import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../http';
import type { AppDeps } from '../deps';
import * as announcements from '../announcements';
import * as settings from '../settings';
import * as backups from '../backups';
import { METRICS, getStatus, series } from '../metrics';

const reason = z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500);
const key = z.object({ key: z.string().max(80) });

export function settingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/admin/settings', async (req) => { requireAdmin(req); return settings.listSettings(deps); });
  app.get('/api/v1/admin/settings/:key/history', async (req) => { requireAdmin(req); return settings.settingHistory(deps, key.parse(req.params).key); });
  // A risky setting answers with a preview first; send confirm: true to make the change.
  app.put('/api/v1/admin/settings/:key', async (req) => {
    const who = requireAdmin(req);
    const b = z.object({ value: z.unknown(), reason, confirm: z.boolean().default(false) }).parse(req.body);
    return settings.changeSetting(deps, who, key.parse(req.params).key, b.value === undefined ? null : b.value, b.reason, b.confirm, ctxOf(deps, req));
  });
  app.post('/api/v1/admin/settings/:key/rollback', async (req) => {
    const who = requireAdmin(req);
    const b = z.object({ version: z.number().int().min(1), reason }).parse(req.body);
    return settings.rollbackSetting(deps, who, key.parse(req.params).key, b.version, b.reason, ctxOf(deps, req));
  });

  // Announcements: everyone reads the live ones; admins write them.
  app.get('/api/v1/announcements', async (_req, reply) => reply.header('cache-control', 'no-cache').send({ announcements: await announcements.liveAnnouncements(deps) }));
  app.get('/api/v1/admin/announcements', async (req) => { requireAdmin(req); return { announcements: await announcements.listAnnouncements(deps) }; });
  app.post('/api/v1/admin/announcements', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({
      title: z.string().trim().min(2).max(120), body: z.string().trim().max(2000).default(''), level: z.enum(['info', 'warning']).default('info'),
      starts_at: z.string().datetime().optional(), ends_at: z.string().datetime().optional(),
    }).parse(req.body);
    return reply.code(201).send(await announcements.createAnnouncement(deps, who, b, ctxOf(deps, req)));
  });
  app.delete('/api/v1/admin/announcements/:id', async (req, reply) => {
    await announcements.archiveAnnouncement(deps, requireAdmin(req), z.object({ id: z.string().regex(/^a_[0-9A-Z]{26}$/) }).parse(req.params).id, ctxOf(deps, req));
    return reply.code(204).send();
  });

  // The status board, its numbers over time, and the record of backups (docs/11, docs/15).
  app.get('/api/v1/admin/status', async (req) => { requireAdmin(req); return getStatus(deps); });
  app.get('/api/v1/admin/metrics', async (req) => {
    requireAdmin(req);
    const q = z.object({ metric: z.enum(METRICS as [string, ...string[]]), hours: z.coerce.number().int().min(1).max(720).default(48) }).parse(req.query);
    return series(deps, q.metric, q.hours);
  });
  app.get('/api/v1/admin/backups', async (req) => { requireAdmin(req); return { summary: await backups.summary(deps), runs: await backups.listRuns(deps) }; });
}

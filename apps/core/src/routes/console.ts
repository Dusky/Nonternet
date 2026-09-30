import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../http';
import type { AppDeps } from '../deps';
import { commandSpecs, runCommand } from '../console';
import { stats, statsCsv } from '../stats';

// Console stats and the command console (docs/11 §9, §11).
export function consoleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const range = z.object({ days: z.coerce.number().int().min(7).max(365).optional(), weeks: z.coerce.number().int().min(2).max(52).optional() });
  app.get('/api/v1/admin/stats', async (req) => { requireAdmin(req); return stats(deps, range.parse(req.query)); });
  app.get('/api/v1/admin/stats.csv', async (req, reply) => {
    requireAdmin(req);
    const q = range.extend({ kind: z.enum(['days', 'cohorts', 'heatmap']) }).parse(req.query);
    const csv = statsCsv(await stats(deps, q), q.kind);
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="stats-${q.kind}.csv"`).header('cache-control', 'no-store').send(csv);
  });
  app.get('/api/v1/admin/console/commands', async (req) => { requireAdmin(req); return { commands: commandSpecs() }; });
  app.post('/api/v1/admin/console', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const who = requireAdmin(req);
    const { command } = z.object({ command: z.string().max(2000) }).parse(req.body);
    return runCommand(deps, who, command, ctxOf(deps, req));
  });
}

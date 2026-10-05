import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import * as feeds from '../feeds';

// Atom feeds (docs/05, 14). Public, cached for five minutes, and answered with 304 when the reader already has it.
export function feedRoutes(app: FastifyInstance, deps: AppDeps): void {
  const send = async (req: FastifyRequest, reply: FastifyReply, make: () => Promise<feeds.Feed>) => {
    const body = feeds.renderAtom(deps, await make());
    const etag = feeds.etagOf(body);
    reply.header('etag', etag).header('cache-control', 'public, max-age=300');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/atom+xml; charset=utf-8').send(body);
  };
  // "lobby.atom" -> "lobby"; anything not ending in .atom is not a feed.
  const name = (file: string) => {
    const m = /^(.+)\.atom$/.exec(file);
    if (!m) throw new ApiError(404, 'not_found', 'There is no feed here.');
    return m[1]!;
  };
  const rate = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.get('/feeds/all.atom', rate, (req, reply) => send(req, reply, () => feeds.allFeed(deps)));
  app.get('/feeds/boards/:file', rate, (req, reply) => send(req, reply, () => feeds.boardFeed(deps, name((req.params as { file: string }).file))));
  app.get('/feeds/boards/:slug/threads/:file', rate, (req, reply) => {
    const p = req.params as { slug: string; file: string };
    return send(req, reply, () => feeds.threadFeed(deps, p.slug, name(p.file)));
  });
  app.get('/feeds/people/:file', rate, (req, reply) => send(req, reply, () => feeds.personFeed(deps, name((req.params as { file: string }).file))));
}

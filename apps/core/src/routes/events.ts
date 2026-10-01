import type { FastifyInstance } from 'fastify';
import { resolveSession } from '../accounts';
import type { AppDeps } from '../deps';
import { COOKIE, requireUser } from '../http';
import { liveStreamsOf, subscribeLive, type LiveEvent } from '../live';

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5; // a person with many tabs open; the oldest is let go

// GET /api/v1/events: a server-sent event stream for the signed-in person (M9, docs/10 "Live").
// The tab keeps one open and refetches what a hint names; if it drops, the tab falls back to polling.
export function eventRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/v1/events', async (req, reply) => {
    const me = requireUser(req);
    const token = req.cookies[COOKIE] ?? '';
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (chunk: string) => { if (!res.writableEnded) res.write(chunk); };
    const send = (e: LiveEvent) => write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

    // Too many tabs open: the oldest stream is closed (that tab polls until it is used again).
    const mine = liveStreamsOf(me.userId);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_USER + 1))) old.close();
    const off = subscribeLive({ userId: me.userId, confirmed: me.role !== 'guest', send, close: () => res.end() });
    write('retry: 5000\n\n');
    write(': connected\n\n');

    // The heartbeat keeps proxies from closing an idle stream, and ends it when the session has.
    const beat = setInterval(() => {
      void (async () => {
        const still = token ? await resolveSession(deps, token).catch(() => null) : null;
        if (!still) { res.end(); return; }
        write(': ping\n\n');
      })();
    }, HEARTBEAT_MS);
    beat.unref();

    const done = () => { clearInterval(beat); off(); };
    req.raw.on('close', done);
    res.on('close', done);
  });
}

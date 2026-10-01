import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import * as w from '../homes/widgets';
import { WIDGET_NAMES, widgetScript } from '../homes/widget-scripts';
import { buttonPng, buttonSvg, parseButton } from '../homes/toys';

const handleParam = z.object({ handle: z.string().trim().min(1).max(40) });
const signBody = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{20,80}$/).optional(), name: z.string().max(100).optional(), url: z.string().max(300).optional(), message: z.string().max(5000), website: z.string().max(200).optional() });
const listQuery = z.object({ before: z.string().regex(/^g_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });

export const WIDGET_API = '/api/v1/widgets/';

// The widget API is public on purpose: it answers any website, with no cookies and no login, and it
// never looks at a session. That is what makes it safe to call from a homepage (docs/07, docs/15).
const cors = (reply: FastifyReply) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-max-age', '86400');
};

export function widgetRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.addHook('onRequest', async (req, reply) => { if (req.url.startsWith(WIDGET_API)) cors(reply); });
  app.options(`${WIDGET_API}*`, async (_req, reply) => reply.code(204).send());

  // The 88x31 button maker: /widgets/button.svg?text=MADE BY|HAND&fg=ffffff&bg=37474f (and .png).
  const buttonQuery = z.object({ text: z.string().max(40).optional(), fg: z.string().max(7).optional(), bg: z.string().max(7).optional() });
  app.get('/widgets/button.svg', async (req, reply) =>
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400').header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(buttonSvg(parseButton(buttonQuery.parse(req.query)))));
  app.get('/widgets/button.png', async (req, reply) =>
    reply.type('image/png').header('cache-control', 'public, max-age=86400').header('x-content-type-options', 'nosniff').send(await buttonPng(parseButton(buttonQuery.parse(req.query)))));

  app.get('/widgets/:file', async (req, reply) => {
    const file = z.object({ file: z.string().max(40) }).parse(req.params).file;
    const name = file.replace(/\.js$/, '');
    const src = WIDGET_NAMES.includes(name) ? widgetScript(name) : null;
    if (!src) throw new ApiError(404, 'not_found', 'No such widget.');
    return reply.type('text/javascript; charset=utf-8').header('cache-control', 'public, max-age=3600').header('x-content-type-options', 'nosniff').send(src);
  });

  app.get(`${WIDGET_API}:handle/guestbook`, async (req) => w.listGuestbook(deps, handleParam.parse(req.params).handle, listQuery.parse(req.query)));
  app.post(`${WIDGET_API}:handle/guestbook`, { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await w.sign(deps, handleParam.parse(req.params).handle, signBody.parse(req.body), null, ctxOf(deps, req))));
  app.get(`${WIDGET_API}:handle/counter`, async (req) => w.count(deps, handleParam.parse(req.params).handle));
  app.post(`${WIDGET_API}:handle/hit`, { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req) => w.hit(deps, handleParam.parse(req.params).handle, ctxOf(deps, req)));
  app.get(`${WIDGET_API}:handle/status`, async (req) => w.status(deps, handleParam.parse(req.params).handle));

  // A pass for signing a homepage's guestbook as yourself, from that homepage's widget (docs/07).
  app.post('/api/v1/homes/:handle/guestbook-ticket', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) =>
    w.guestbookTicket(deps, requireUser(req), handleParam.parse(req.params).handle, z.object({ return_to: z.string().max(500) }).parse(req.body).return_to));

  // Signing from the site itself, signed in: the name is the account's and cannot be faked.
  app.post('/api/v1/homes/:handle/guestbook', async (req, reply) =>
    reply.code(201).send(await w.sign(deps, handleParam.parse(req.params).handle, signBody.parse(req.body), requireUser(req), ctxOf(deps, req))));

  // The owner's own guestbook.
  app.get('/api/v1/homes/me/guestbook', async (req) =>
    w.listMine(deps, requireUser(req), z.object({ status: z.enum(['visible', 'pending', 'hidden']).optional() }).parse(req.query).status));
  app.patch('/api/v1/homes/me/guestbook/:id', async (req, reply) => {
    await w.moderateEntry(deps, requireUser(req), z.object({ id: z.string().regex(/^g_[0-9A-Z]{26}$/) }).parse(req.params).id, z.object({ status: z.enum(['visible', 'hidden']) }).parse(req.body).status);
    return reply.code(204).send();
  });

  // Snippets to paste, with this site's address filled in.
  app.get('/api/v1/homes/me/snippets', async (req) => {
    const v = requireUser(req);
    const origin = deps.publicUrl;
    return { snippets: WIDGET_NAMES.map((n) => ({ id: n, html: `<script src="${origin}/widgets/${n}.js" data-user="${v.handle}"></script>` })) };
  });
}

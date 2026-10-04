import { promises as fs } from 'node:fs';
import { posix } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import send from 'send';
import { en } from '@app/strings';
import type { AppDeps } from '../deps';
import { extOf, MIME } from './files';

// The homes server (docs/07, docs/15): serves people's homepages on their own subdomains of
// `homes_domain`. It is a separate process on a separate origin from the shell and core, holds no
// cookies and sets none, so a page here cannot act as the visitor on the main site. It only reads.
const HANDLE_LABEL = /^[a-z][a-z0-9_-]{1,19}$/;
const REDIRECT_DAYS = 90;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Owner { id: string; handle: string; status: string; hidden: boolean }

export async function buildHomesApp(deps: AppDeps) {
  const app = Fastify({ trustProxy: deps.trustProxy, logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const home = deps.config.site.homes_domain.toLowerCase();
  const siteOrigin = new URL(deps.publicUrl).origin;

  const protect = (reply: FastifyReply) => {
    reply.header('x-content-type-options', 'nosniff');
    // Only the site itself may put a homepage in a frame (the studio's preview does).
    reply.header('content-security-policy', `frame-ancestors 'self' ${siteOrigin}`);
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  };

  const page = (reply: FastifyReply, status: number, title: string, hint: string) => {
    protect(reply);
    return reply.code(status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>` +
      `<style>body{font:18px/1.5 Georgia,serif;max-width:32rem;margin:4rem auto;padding:0 1rem}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(hint)}</p></body></html>`);
  };

  async function ownerByHandle(handle: string): Promise<Owner | null> {
    const r = await deps.db.query<{ id: string; handle: string; status: string; hidden_at: Date | null }>(
      `SELECT u.id, u.handle, u.status, h.hidden_at FROM users u LEFT JOIN homepages h ON h.user_id = u.id WHERE lower(u.handle) = $1`, [handle]);
    const o = r.rows[0];
    return o ? { id: o.id, handle: o.handle, status: o.status, hidden: o.hidden_at !== null } : null;
  }

  async function ownerByDomain(domain: string): Promise<Owner | null> {
    const r = await deps.db.query<{ id: string; handle: string; status: string; hidden_at: Date | null }>(
      `SELECT u.id, u.handle, u.status, h.hidden_at FROM custom_domains c JOIN users u ON u.id = c.user_id LEFT JOIN homepages h ON h.user_id = u.id
       WHERE c.domain = $1 AND c.status = 'verified'`, [domain]);
    const o = r.rows[0];
    return o ? { id: o.id, handle: o.handle, status: o.status, hidden: o.hidden_at !== null } : null;
  }

  // The address of a person who has since renamed: kept working for 90 days (docs/07).
  async function renamedTo(handle: string): Promise<string | null> {
    const r = await deps.db.query<{ handle: string }>(
      `SELECT u.handle FROM handle_history hh JOIN users u ON u.id = hh.user_id
       WHERE hh.handle = $1 AND hh.changed_at > now() - make_interval(days => $2) AND u.status = 'active' ORDER BY hh.changed_at DESC LIMIT 1`, [handle, REDIRECT_DAYS]);
    return r.rows[0]?.handle ?? null;
  }

  const report = (handle: string) => `${deps.publicUrl}/report/homepage/${encodeURIComponent(handle)}`;
  // A small fixed link on every HTML page, so a visitor can always report it (decided 2026-09-30).
  const footer = (handle: string) =>
    `<div id="site-report-footer" style="position:fixed;right:8px;bottom:8px;z-index:2147483647;font:12px/1.2 sans-serif;background:#fff;color:#000;padding:4px 8px;border:1px solid #000;border-radius:3px">` +
    `<a href="${escapeHtml(report(handle))}" style="color:#00e;text-decoration:underline" rel="nofollow noopener">${escapeHtml(en['homes.report'])}</a></div>`;
  const inject = (html: string, handle: string) => {
    const i = html.toLowerCase().lastIndexOf('</body>');
    return i === -1 ? html + footer(handle) : html.slice(0, i) + footer(handle) + html.slice(i);
  };

  async function fileAt(ownerId: string, segs: string[]): Promise<{ abs: string; size: number } | null> {
    const abs = `${deps.homes.dir(ownerId)}/${segs.join('/')}`;
    try {
      const st = await fs.lstat(abs);
      return st.isFile() && !st.isSymbolicLink() ? { abs, size: st.size } : null;
    } catch { return null; }
  }
  async function isDir(ownerId: string, segs: string[]): Promise<boolean> {
    try { const st = await fs.lstat(`${deps.homes.dir(ownerId)}/${segs.join('/')}`); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
  }

  async function serveFile(req: FastifyRequest, reply: FastifyReply, owner: Owner, segs: string[], status = 200): Promise<FastifyReply | void> {
    const rel = segs.join('/');
    const f = await fileAt(owner.id, segs);
    const mime = MIME[extOf(rel)];
    if (!f || !mime) return null as never;
    protect(reply);
    reply.header('cache-control', 'no-cache');
    if (['html', 'htm'].includes(extOf(rel))) {
      const body = Buffer.from(inject((await fs.readFile(f.abs)).toString('utf8'), owner.handle), 'utf8');
      return reply.code(status).type(mime).header('content-length', body.length).send(req.method === 'HEAD' ? undefined : body);
    }
    // Other files stream with ranges, so audio and video can seek.
    reply.hijack();
    const stream = send(req.raw, encodeURI(rel), { root: deps.homes.dir(owner.id), dotfiles: 'deny', index: false, cacheControl: false, etag: true, lastModified: true });
    stream.on('headers', (res) => {
      res.setHeader('content-type', mime);
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', `frame-ancestors 'self' ${siteOrigin}`);
      res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
      res.setHeader('cache-control', 'no-cache');
    });
    stream.on('error', (err: { status?: number }) => { reply.raw.statusCode = err.status ?? 500; reply.raw.end(); });
    stream.pipe(reply.raw);
  }

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Installable apps (docs/10, docs/15): homes_domain/apps/{id}@{version}/…, from the apps folder, only while the
  // site offers the app. Every response carries a sandbox policy, so an app runs with an opaque origin even if
  // someone opens its address directly, can't fetch anything (it talks only to the shell's bridge), and can only
  // be framed by the site. The address carries the version, so files are cached for good.
  const APP_PATH = /^\/apps\/([a-z][a-z0-9-]{1,30})@(\d+\.\d+\.\d+)(\/.*)?$/;
  const APP_CSP = `sandbox allow-scripts allow-forms; default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${siteOrigin}`;
  async function serveApp(req: FastifyRequest, reply: FastifyReply, id: string, version: string, rest: string): Promise<FastifyReply> {
    const notFound = () => page(reply, 404, en['homes.notFound'], '');
    if (!deps.appsDir) return notFound();
    const row = await deps.db.query<{ version: string }>(`SELECT version FROM app_catalog WHERE app_id = $1 AND offered AND present`, [id]);
    if (row.rows[0]?.version !== version) return notFound();
    const segs = rest.split('/').filter(Boolean);
    if (segs.length === 0 || segs.some((x) => x.startsWith('.') || x === '..')) return notFound();
    const rel = segs.join('/');
    const mime = MIME[extOf(rel)];
    const root = posix.join(deps.appsDir.replace(/\\/g, '/'), id);
    try { const st = await fs.lstat(posix.join(root, rel)); if (!st.isFile() || st.isSymbolicLink()) return notFound(); } catch { return notFound(); }
    if (!mime) return notFound();
    reply.hijack();
    const stream = send(req.raw, encodeURI(rel), { root, dotfiles: 'deny', index: false, cacheControl: false, etag: true, lastModified: false });
    stream.on('headers', (res) => {
      res.setHeader('content-type', mime);
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', APP_CSP);
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
      res.setHeader('cross-origin-resource-policy', 'cross-origin');
      // A sandboxed frame's requests come from an opaque origin; module scripts need this to load.
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    });
    stream.on('error', (err: { status?: number }) => { reply.raw.statusCode = err.status ?? 500; reply.raw.end(); });
    stream.pipe(reply.raw);
    return reply;
  }

  app.route({
    method: ['GET', 'HEAD'], url: '/*',
    handler: async (req, reply) => {
      const host = (req.headers.host ?? '').split(':')[0]!.toLowerCase();
      const url = new URL(req.url, 'http://x');
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { return page(reply, 400, 'Bad request', ''); }
      if (pathname.includes('\0') || pathname.includes('\\')) return page(reply, 400, 'Bad request', '');

      // The stable address: homes_domain/u/{user id}/… goes to whoever has that ID now.
      if (host === home) {
        const app = APP_PATH.exec(pathname);
        if (app) return serveApp(req, reply, app[1]!, app[2]!, app[3] ?? '/');
        const m = /^\/u\/(u_[0-9A-Z]{26})(\/.*)?$/.exec(pathname);
        if (m) {
          const r = await deps.db.query<{ handle: string }>(`SELECT handle FROM users WHERE id = $1 AND status = 'active'`, [m[1]]);
          if (r.rows[0]) return reply.redirect(deps.homesUrl(r.rows[0].handle).replace(/\/$/, '') + (m[2] ?? '/') + url.search, 302);
        }
        return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
      }
      let owner: Owner | null;
      if (host.endsWith(`.${home}`)) {
        const label = host.slice(0, -(home.length + 1));
        if (!HANDLE_LABEL.test(label)) return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
        owner = await ownerByHandle(label);
        if (!owner) {
          const now = await renamedTo(label);
          if (now) return reply.redirect(deps.homesUrl(now).replace(/\/$/, '') + url.pathname + url.search, 301);
          return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
        }
      } else {
        // Any other name is served only if someone has proved it is theirs (docs/07).
        owner = await ownerByDomain(host);
        if (!owner) return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
      }
      if (owner.status !== 'active') return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
      if (owner.hidden) return page(reply, 410, en['homes.hidden'], '');

      // Any dot segment, before any tidying: nothing here needs one, so none is let through.
      if (pathname.split('/').some((s) => s.startsWith('.'))) return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);
      const segs = posix.normalize(pathname).split('/').filter(Boolean);
      if (segs.some((s) => s === '..' || s.startsWith('.'))) return page(reply, 404, en['homes.notFound'], en['homes.notFoundHint']);

      if (await isDir(owner.id, segs) || segs.length === 0) {
        // A folder needs its trailing slash so relative links inside it work.
        if (segs.length > 0 && !pathname.endsWith('/')) return reply.redirect(`${url.pathname}/${url.search}`, 301);
        segs.push('index.html');
      }
      const served = await serveFile(req, reply, owner, segs);
      if (served !== null && served !== undefined) return served;
      if (reply.sent) return reply;
      // A person's own 404.html is used when they have one, as on any old web host.
      if (await fileAt(owner.id, ['404.html'])) return serveFile(req, reply, owner, ['404.html'], 404);
      // The front page of someone who has not put one up yet: say that, so it doesn't look like a broken link.
      if (segs.length === 1 && segs[0] === 'index.html') return page(reply, 404, en['homes.notPublished'].replace('{handle}', owner.handle), en['homes.notPublishedHint']);
      return page(reply, 404, en['homes.notFound'], '');
    },
  });

  return app;
}

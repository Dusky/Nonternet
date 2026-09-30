import { createHash } from 'node:crypto';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import ssh2 from 'ssh2';
import type { WebSocketServer } from 'ws';
import { CoreError, type LoginResult } from './core';
import { Session, type BbsContext, type PreAuth } from './session';
import { OPENING, TelnetParser, escapeOut } from './telnet';
import { Term, encodingFor } from './term';

// The three front doors (docs/04). Each one negotiates its terminal, claims a node and hands a Term to a
// Session; everything after that is shared.

export interface ListenOpts { idleMs: number; negotiateMs?: number }

const refuse = (write: (s: string) => void, end: () => void, msg: string) => { write(`${msg}\r\n`); end(); };

// ---------------------------------------------------------------- telnet

export function telnetServer(ctx: BbsContext, opts: ListenOpts): net.Server {
  return net.createServer((sock) => {
    sock.setNoDelay(true);
    sock.on('error', () => undefined);
    const ip = sock.remoteAddress ?? '?';
    const claim = ctx.nodes.claim(ip);
    if ('error' in claim) return refuse((s) => sock.write(s), () => sock.end(), claim.error);
    const term = new Term({ write: (b) => { if (!sock.destroyed) sock.write(escapeOut(b)); }, end: () => sock.end() }, opts.idleMs);
    let sized = false; let typed = false;
    let go: (() => void) | null = null;
    const parser = new TelnetParser({
      send: (b) => sock.write(b),
      size: (c, r) => { term.resize(c, r); sized = true; if (typed) go?.(); },
      ttype: (name) => { if (!typed) { term.ttype = name; term.encoding = encodingFor(name); typed = true; if (sized) go?.(); } },
    });
    sock.on('data', (chunk) => { const data = parser.feed(chunk); if (data.length) term.input(data); });
    sock.on('close', () => term.close());
    sock.write(OPENING);
    // Negotiation first (docs/04): wait for the terminal's name and size, or a moment, before drawing.
    new Promise<void>((resolve) => { go = resolve; setTimeout(resolve, opts.negotiateMs ?? 1500); }).then(() => {
      go = null;
      void new Session(ctx, term, claim.node, 'telnet', ip).run();
    });
  });
}

// ---------------------------------------------------------------- SSH

export const fingerprintOf = (blob: Buffer) => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;

export function sshServer(ctx: BbsContext, hostKey: Buffer | string, opts: ListenOpts): ssh2.Server {
  return new ssh2.Server({ hostKeys: [hostKey], ident: 'BBS' }, (client, info) => {
    const ip = info.ip;
    let login: LoginResult | null = null;
    let fails = 0;
    let node: number | null = null;
    client.on('error', () => undefined);
    const claim = ctx.nodes.claim(ip);
    if ('error' in claim) { client.end(); return; }
    node = claim.node;
    // Once a shell starts, the Session owns the node and the core session. Before that, they are ours to let go.
    let started = false;
    client.on('close', () => {
      if (started) return;
      ctx.nodes.release(node!, ip);
      if (login) void ctx.core.logout(login.token, login.call_id).catch(() => undefined);
    });

    client.on('authentication', (a) => {
      const handle = a.username.trim().replace(/^@/, '');
      const fail = () => { if (++fails >= 6) client.end(); else a.reject(['publickey', 'password', 'keyboard-interactive']); };
      const tryLogin = (p: Promise<LoginResult>) => p.then((l) => { login = l; a.accept(); }).catch((e) => { if (e instanceof CoreError && e.status === 0) client.end(); else setTimeout(fail, 800); });
      if (a.method === 'publickey') {
        if (!a.signature) return a.accept(); // the client asks whether this key would do; the signed attempt decides
        const key = ssh2.utils.parseKey(a.key.data);
        if (key instanceof Error || !a.blob || !key.verify(a.blob, a.signature, (a as { hashAlgo?: string }).hashAlgo)) return fail();
        return tryLogin(ctx.core.loginKey({ handle, fingerprint: fingerprintOf(a.key.data), node: node!, ip_hash: null }));
      }
      if (a.method === 'password') return tryLogin(ctx.core.login({ method: 'password', handle, secret: a.password, via: 'ssh', node: node!, ip_hash: null }));
      if (a.method === 'keyboard-interactive') {
        return a.prompt([{ prompt: 'Terminal password: ', echo: false }], (answers) => {
          tryLogin(ctx.core.login({ method: 'password', handle, secret: answers[0] ?? '', via: 'ssh', node: node!, ip_hash: null }));
        });
      }
      a.reject(['publickey', 'password', 'keyboard-interactive']);
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        let cols = 80, rows = 24, ttype: string | null = null;
        session.on('pty', (ok, _no, p) => { cols = p.cols || 80; rows = p.rows || 24; ttype = p.term || null; ok?.(); });
        let term: Term | null = null;
        session.on('window-change', (ok, _no, p) => { term?.resize(p.cols, p.rows); ok?.(); });
        session.on('shell', (ok) => {
          if (started) return;
          started = true;
          const stream = ok();
          term = new Term({ write: (b) => stream.write(b), end: () => { stream.exit(0); stream.end(); client.end(); } }, opts.idleMs);
          term.resize(cols, rows);
          term.ttype = ttype;
          term.encoding = encodingFor(ttype);
          stream.on('data', (d: Buffer) => term!.input(d));
          stream.on('close', () => term!.close());
          const s = new Session(ctx, term, node!, 'ssh', ip);
          void s.run({ kind: 'login', login: login! });
        });
      });
    });
    client.on('end', () => undefined);
  });
}

// ---------------------------------------------------------------- WebSocket (the shell's Terminal window)

// Messages from the browser are JSON: first {"t":"hello","handle","ticket","cols","rows"}, then {"t":"in","d":"…"}
// for keystrokes and {"t":"size","cols","rows"} on resize. The BBS sends plain UTF-8 text frames.
export function attachWs(wss: WebSocketServer, ctx: BbsContext, opts: ListenOpts & { trustProxy: (ip: string) => boolean }): void {
  wss.on('connection', (ws, req: IncomingMessage) => {
    const direct = req.socket.remoteAddress ?? '?';
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim();
    const ip = fwd && opts.trustProxy(direct) ? fwd : direct;
    const claim = ctx.nodes.claim(ip);
    if ('error' in claim) { ws.send(`${claim.error}\r\n`); ws.close(); return; }
    const term = new Term({ write: (b) => { if (ws.readyState === ws.OPEN) ws.send(b.toString('utf8')); }, end: () => ws.close() }, opts.idleMs);
    let started = false;
    const helloTimer = setTimeout(() => { if (!started) { ws.close(); ctx.nodes.release(claim.node, ip); } }, 10_000);
    ws.on('message', (raw) => {
      let m: { t?: string; d?: string; handle?: string; ticket?: string; cols?: number; rows?: number };
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'hello' && !started) {
        started = true;
        clearTimeout(helloTimer);
        term.resize(Math.min(Math.max(Number(m.cols) || 80, 20), 500), Math.min(Math.max(Number(m.rows) || 24, 5), 300));
        term.ttype = 'xterm-256color';
        const pre: PreAuth | undefined = m.handle && m.ticket ? { kind: 'ticket', handle: String(m.handle).slice(0, 40), ticket: String(m.ticket).slice(0, 300) } : undefined;
        void new Session(ctx, term, claim.node, 'web', ip).run(pre);
      } else if (m.t === 'in' && typeof m.d === 'string') term.input(Buffer.from(m.d.slice(0, 4096), 'utf8'));
      else if (m.t === 'size') term.resize(Math.min(Math.max(Number(m.cols) || 80, 20), 500), Math.min(Math.max(Number(m.rows) || 24, 5), 300));
    });
    ws.on('close', () => { clearTimeout(helloTimer); term.close(); if (!started) ctx.nodes.release(claim.node, ip); });
    ws.on('error', () => undefined);
  });
}

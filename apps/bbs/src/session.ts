import { createHmac } from 'node:crypto';
import type { ArtPack, Action } from './art';
import type { Door } from './doors';
import { CoreError, type Core, type LoginResult, type UserApi } from './core';
import type { NodeHolder, Nodes } from './nodes';
import type { Term } from './term';
import { SCREENS } from './screens';
import { cut } from './screens/util';
import { newBulletinNote, recentOneliners } from './screens/classics';
import { signUp } from './screens/signup';

export interface BbsContext {
  core: Core;
  art: ArtPack;
  nodes: Nodes;
  secret: string;          // for hashing addresses before they reach core
  siteUrl: string;
  log: (m: string) => void;
  doors: Door[];           // from the site config, operator only (docs/04)
  doorWrapper: string[];
}

export type PreAuth = { kind: 'login'; login: LoginResult } | { kind: 'ticket'; handle: string; ticket: string } | { kind: 'signup' };

// The same hash core sees for a caller's address, wherever it is worked out.
export const hashIp = (secret: string, ip: string): string => createHmac('sha256', secret).update(`ip:${ip}`).digest('base64url').slice(0, 22);

// One caller on one node, from connect to goodbye. The transport (telnet, SSH, WebSocket) has already
// negotiated the terminal; everything here is the same for all three.
export class Session implements NodeHolder {
  since = new Date().toISOString();
  where = 'Logging in';
  token: string | null = null;
  callId: string | undefined;
  user: LoginResult['user'] | null = null;
  lastCall: string | null = null;
  readonly seen = new Set<string>(); // announcements already shown to this caller
  api!: UserApi;
  private ended = false;

  constructor(readonly ctx: BbsContext, readonly term: Term, readonly node: number, readonly via: NodeHolder['via'], readonly ip: string) {
    term.onIdle = () => this.drop('You have been idle for a while, so the BBS let you go. Call again any time.');
  }

  get ipHash(): string { return hashIp(this.ctx.secret, this.ip); }
  at(where: string): void { this.where = where; }

  async run(pre?: PreAuth): Promise<void> {
    this.ctx.nodes.attach(this);
    try {
      const ok = pre?.kind === 'login' ? this.signedIn(pre.login) : pre?.kind === 'ticket' ? await this.redeem(pre.handle, pre.ticket)
        : pre?.kind === 'signup' ? await this.signUp() : await this.loginPrompt();
      if (!ok) return;
      await this.menuLoop();
    } catch (e) {
      if (!this.ended) this.ctx.log(`node ${this.node}: ${e instanceof Error ? e.stack ?? e.message : e}`);
    } finally {
      await this.end();
    }
  }

  private signedIn(l: LoginResult): true {
    this.token = l.token;
    this.callId = l.call_id;
    this.user = l.user;
    this.lastCall = l.last_call_at;
    this.api = this.ctx.core.as(l.token);
    return true;
  }

  private async redeem(handle: string, ticket: string): Promise<boolean> {
    try {
      return this.signedIn(await this.ctx.core.login({ method: 'ticket', handle, secret: ticket, via: this.via, node: this.node, ip_hash: this.ipHash }));
    } catch (e) {
      this.term.line(e instanceof CoreError && e.status !== 0 ? 'That sign-in link has expired or was already used. Open the Terminal again from the web.' : (e as Error).message);
      return false;
    }
  }

  private async signUp(): Promise<boolean> {
    const l = await signUp(this);
    return l ? this.signedIn(l) : false;
  }

  private async loginPrompt(): Promise<boolean> {
    const t = this.term;
    t.clear();
    t.write(this.ctx.art.render('login', { node: this.node }, { cols: this.term.cols - 1 }));
    t.line();
    for (let tries = 0; tries < 3; tries++) {
      t.write('Handle: ');
      const handle = (await t.readLine({ max: 40 }))?.trim().replace(/^@/, '');
      if (handle === undefined || handle === null) return false;
      if (!handle) { tries--; continue; }
      if (handle.toLowerCase() === 'new') return this.signUp();
      t.write('Terminal password: ');
      const password = await t.readLine({ max: 200, mask: true });
      if (password === null) return false;
      try {
        return this.signedIn(await this.ctx.core.login({ method: 'password', handle, secret: password, via: this.via, node: this.node, ip_hash: this.ipHash }));
      } catch (e) {
        if (e instanceof CoreError && e.status === 0) { t.line(e.message); return false; }
        await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
        t.line('That handle and terminal password do not match. Remember: it is your terminal password, not your website password.');
      }
    }
    t.line('Too many tries. Goodbye.');
    return false;
  }

  private async menuLoop(): Promise<void> {
    const t = this.term;
    t.clear();
    t.write(this.ctx.art.render('motd', { handle: this.user!.handle, node: this.node, last_on: this.lastCall ? `${this.lastCall.slice(0, 16).replace('T', ' ')} UTC` : 'this is your first call' }, { cols: this.term.cols - 1 }));
    const motd = (await this.ctx.core.publicGet<{ motd: string }>('/bbs/motd').catch(() => ({ motd: '' }))).motd;
    if (motd.trim()) t.line(`\n${motd.trim()}`);
    const announcements = await this.ctx.core.publicGet<{ announcements: { id: string; title: string; body: string }[] }>('/announcements').catch(() => ({ announcements: [] }));
    for (const a of announcements.announcements) { this.seen.add(a.id); t.line(`\x1b[1;33m${a.title}\x1b[0m ${a.body}`); }
    if (!this.lastCall && this.ctx.art.has('newuser')) t.write(this.ctx.art.render('newuser', { handle: this.user!.handle, node: this.node }, { cols: this.term.cols - 1 }));
    // The newest bulletin if it is new to this caller, then the last few lines on the oneliners wall.
    const note = await newBulletinNote(this);
    if (note) t.line(`\n${note}`);
    const wall = await recentOneliners(this, 5).catch(() => []);
    if (wall.length) {
      t.line('\n\x1b[2mOn the wall:\x1b[0m');
      for (const o of [...wall].reverse()) t.line(`  ${(o.author?.handle ?? '-').padEnd(16)} ${o.body}`);
      t.line('\x1b[2mPress O at the menu to add yours.\x1b[0m');
    }
    let first = true;
    for (;;) {
      if (this.ended) return;
      this.at('Main menu');
      const menu = this.ctx.art.menus.main!;
      // The first menu follows the login notices; after that each menu starts on a clean screen.
      if (first) t.line(); else t.clear();
      first = false;
      t.write(this.ctx.art.render('main', { handle: this.user!.handle, node: this.node }, { cols: this.term.cols - 1 }));
      for (const item of menu.items) t.line(`  \x1b[1m${item.key.toUpperCase()}\x1b[0m  ${cut(item.label, Math.max(10, t.cols - 7))}`); // a narrow screen (a phone) cuts long labels rather than wrapping them
      t.write(`\n${menu.title} [${menu.items.map((i) => i.key.toUpperCase()).join('')}]: `);
      const k = await t.choose(menu.items.map((i) => i.key).join(''));
      if (k === null) return;
      const item = menu.items.find((i) => i.key.toLowerCase() === k)!;
      t.line(item.label);
      if (item.action === 'goodbye') return;
      await this.do(item.action);
    }
  }

  // Runs one screen on a clean page. If it ends with something still to read (a list, a message, an error) rather
  // than with the caller leaving it, wait for a key: otherwise the menu would scroll it away at once.
  async do(action: Action): Promise<void> {
    const screen = SCREENS[action];
    this.term.clear();
    try {
      await screen(this);
    } catch (e) {
      if (e instanceof CoreError) this.term.line(`\x1b[31m${e.message}\x1b[0m`);
      else throw e;
    }
    if (!this.ended && !this.term.closed && this.term.shownSinceKey) {
      this.term.write('\n\x1b[2m-- press a key for the menu --\x1b[0m');
      await this.term.readKey();
    }
  }

  // A "Press a key" pause after a screenful.
  async pause(): Promise<boolean> {
    this.term.write('\x1b[2m-- press a key --\x1b[0m');
    const k = await this.term.readKey();
    this.term.write('\r\x1b[K');
    return k !== null && k.name !== 'escape' && !(k.name === 'char' && k.ch.toLowerCase() === 'q');
  }

  // A new announcement, shown between whatever the caller is doing (docs/04: announcements reach the BBS).
  announce(a: { id: string; title: string; body: string }): void {
    if (this.ended || !this.user || this.seen.has(a.id)) return;
    this.seen.add(a.id);
    this.term.write(`\r\n\x1b[1;33m*** ${a.title}\x1b[0m ${a.body}\r\n`);
  }

  drop(message: string): void {
    if (this.ended) return;
    this.term.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
    void this.end();
  }

  private async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    // A "last call" screen with today's numbers, from the same list the Last callers screen uses.
    if (this.user && !this.term.closed && this.api && this.ctx.art.has('lastcall')) {
      const today = new Date().toISOString().slice(0, 10);
      const list = await this.api.get<{ callers: { at: string }[] }>('/bbs/last-callers').catch(() => ({ callers: [] }));
      this.term.write(this.ctx.art.render('lastcall', { handle: this.user.handle, node: this.node, callers_today: list.callers.filter((c) => c.at.startsWith(today)).length }, { cols: this.term.cols - 1 }));
    }
    if (this.user && !this.term.closed) this.term.write(this.ctx.art.render('goodbye', { handle: this.user.handle, node: this.node }, { cols: this.term.cols - 1 }));
    this.term.close();
    this.ctx.nodes.release(this.node, this.ip);
    if (this.token) await this.ctx.core.logout(this.token, this.callId).catch(() => undefined);
  }
}

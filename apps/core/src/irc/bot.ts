import { Client } from 'irc-framework';
import { randomBytes } from 'node:crypto';
import { ergoApi } from './api';
import { BOT_NICK, type IrcDeps } from './secrets';

interface IrcEvent { nick?: string; target?: string; message?: string; hostname?: string; type?: string; channel?: string; users?: { nick: string; account?: string }[] }

// The site's own connection to Ergo (docs/08). It is an IRC operator, and core uses it to register
// channels, set who is op where, suspend accounts and send announcements. Ergo answers service
// commands synchronously, so each command is followed by a PING; every NOTICE that arrives before
// the matching PONG is that command's answer.
export class IrcBot {
  private client: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private notices: string[] | null = null;
  private waiting = new Map<string, () => void>();
  ready = false;
  onReady: () => void = () => undefined;
  onLost: () => void = () => undefined;

  constructor(private irc: IrcDeps, private log: (m: string) => void = () => undefined) {}

  async start(): Promise<void> {
    // Idempotent: the bot's account lives in Ergo's own database, with a password derived from IRC_SECRET.
    const r = await ergoApi<{ success: boolean; errorCode?: string }>(this.irc, 'ns/saregister', { accountName: BOT_NICK, passphrase: this.irc.secrets.botPassword });
    if (!r.success && r.errorCode !== 'ACCOUNT_EXISTS') throw new Error(`could not create the bot account: ${r.errorCode}`);
    if (!r.success) await ergoApi(this.irc, 'ns/passwd', { accountName: BOT_NICK, passphrase: this.irc.secrets.botPassword });
    const c = new Client();
    this.client = c;
    c.on('registered', () => c.raw('OPER', BOT_NICK, this.irc.secrets.botPassword));
    c.on('unknown command', (e: { command: string }) => {
      if (e.command === 'RPL_NOWOPER' || e.command === '381') { this.ready = true; this.onReady(); }
      if (e.command === 'ERR_NOOPERHOST' || e.command === '491') this.log('irc bot: OPER was refused');
    });
    c.on('notice', (e: IrcEvent) => { if (this.notices && e.target?.toLowerCase() === BOT_NICK) this.notices.push(e.message ?? ''); });
    c.on('pong', (e: { message: string }) => { const done = this.waiting.get(e.message); if (done) { this.waiting.delete(e.message); done(); } });
    c.on('close', () => { if (this.ready) this.log('irc bot: connection lost, reconnecting'); this.ready = false; this.onLost(); for (const d of this.waiting.values()) d(); this.waiting.clear(); });
    // Errors (e.g. no such nick) are part of a command's answer too.
    c.on('irc error', (e: { reason?: string; error?: string }) => { if (this.notices) this.notices.push(`${e.error ?? 'error'}: ${e.reason ?? ''}`); else this.log(`irc bot: ${e.error ?? ''} ${e.reason ?? ''}`); });
    c.connect({
      host: this.irc.host, port: this.irc.port, nick: BOT_NICK, username: BOT_NICK, gecos: 'site bot',
      account: { account: BOT_NICK, password: this.irc.secrets.botPassword },
      auto_reconnect: true, auto_reconnect_max_retries: 1_000_000, auto_reconnect_max_wait: 30_000,
    });
  }

  stop(): void { this.ready = false; this.client?.quit('shutting down'); }

  // Runs one line and returns the notices it caused. Commands run one at a time.
  call(line: string, timeoutMs = 5000): Promise<string[]> {
    const run = async () => {
      if (!this.ready) throw new Error('irc bot is not connected');
      const token = `sync-${++this.seq}`;
      this.notices = [];
      const got = new Promise<void>((ok) => { this.waiting.set(token, ok); setTimeout(ok, timeoutMs); });
      this.client.raw(line);
      this.client.raw('PING', token);
      await got;
      this.waiting.delete(token);
      const out = this.notices ?? [];
      this.notices = null;
      return out;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  // Unregistering asks for a confirmation code; answer it.
  async callConfirmed(line: string): Promise<string[]> {
    const first = await this.call(line);
    const m = first.map((n) => /run this command: \/(\S+ .+)$/.exec(n)).find(Boolean);
    return m ? this.call(m[1]!) : first;
  }

  async joinAsOp(channel: string): Promise<void> {
    await this.call(`JOIN ${channel}`);
    await this.call(`SAMODE ${channel} +o ${BOT_NICK}`); // in case the channel already had people in it
  }

  say(target: string, text: string): Promise<string[]> {
    return this.call(`NOTICE ${target} :${text.replace(/[\r\n]+/g, ' ')}`);
  }

  who(): Promise<{ nick: string; account?: string }[]> {
    if (!this.ready) return Promise.resolve([]);
    return new Promise((ok) => {
      const t = setTimeout(() => ok([]), 5000);
      this.client.who('*', (e: IrcEvent) => { clearTimeout(t); ok(e.users ?? []); });
    });
  }
}

export const randomPassphrase = () => randomBytes(24).toString('base64url');

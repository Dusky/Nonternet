import { StringDecoder } from 'node:string_decoder';
import iconv from 'iconv-lite';

// One caller's terminal, whatever it came in over (telnet, SSH, the web). It turns bytes into keys and
// text into bytes. UTF-8 is the default; classic BBS clients get CP437 (docs/04), and anything CP437 can't
// show becomes "?". Screens never see bytes or escape codes.

export type Encoding = 'utf8' | 'cp437';
export interface Key { name: 'char' | 'enter' | 'backspace' | 'delete' | 'tab' | 'escape' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown' | 'ctrl'; ch: string }

export interface Transport {
  write(bytes: Buffer): void;
  end(): void;
}

// Terminal types that expect CP437 rather than UTF-8. Anything else (xterm, vt100, linux, screen…) gets UTF-8.
const CP437_TYPES = /^(ansi|ansi-bbs|pcansi|scoansi|syncterm|netrunner|qodem|cp437|ibmpc)/i;
export const encodingFor = (ttype: string | null | undefined): Encoding => (ttype && CP437_TYPES.test(ttype) ? 'cp437' : 'utf8');

const SEQ: Record<string, Key['name']> = {
  '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', 'OA': 'up', 'OB': 'down', 'OC': 'right', 'OD': 'left',
  '[H': 'home', '[F': 'end', 'OH': 'home', 'OF': 'end', '[1~': 'home', '[4~': 'end', '[7~': 'home', '[8~': 'end',
  '[3~': 'delete', '[5~': 'pageup', '[6~': 'pagedown',
};

export class Term {
  cols = 80;
  rows = 24;
  ttype: string | null = null;
  encoding: Encoding = 'utf8';
  closed = false;
  private decoder = new StringDecoder('utf8');
  private pending = '';                     // text not yet turned into keys (a partial escape sequence)
  private keys: Key[] = [];
  private waiters: ((k: Key | null) => void)[] = [];
  private escTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  onIdle: (() => void) | null = null;
  onResize: (() => void) | null = null;

  constructor(private readonly t: Transport, private readonly idleMs = 15 * 60_000) { this.touch(); }

  // ---------------------------------------------------------------- output

  // Whether anything but the echo of the caller's own typing was shown since their last key. The menu uses it to
  // know a screen ended with something still to read (a list, an error) rather than with the caller leaving it.
  shownSinceKey = false;

  write(text: string): void {
    if (this.closed) return;
    // A bare line break or cursor move after a prompt isn't something to read.
    if (text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()) this.shownSinceKey = true;
    this.send(text);
  }
  // The echo of what the caller types, which doesn't count as something new to read.
  private echo(text: string): void { if (!this.closed) this.send(text); }
  private send(text: string): void {
    const s = text.replace(/\r?\n/g, '\r\n');
    this.t.write(this.encoding === 'cp437' ? iconv.encode(s.replace(/[\u{10000}-\u{10FFFF}]/gu, '?'), 'cp437') : Buffer.from(s, 'utf8'));
  }
  line(text = ''): void { this.write(`${text}\n`); }
  clear(): void { this.write('\x1b[2J\x1b[H'); }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; this.onResize?.(); }

  // ---------------------------------------------------------------- input

  // While a door runs, the caller's bytes go straight to it and its output straight back (docs/04).
  private raw: ((bytes: Buffer) => void) | null = null;
  passthrough(handler: ((bytes: Buffer) => void) | null): void { this.raw = handler; this.pending = ''; }
  writeRaw(bytes: Buffer): void { if (!this.closed) this.t.write(bytes); }

  input(bytes: Buffer): void {
    this.touch();
    if (this.raw) { this.raw(bytes); return; }
    this.pending += this.encoding === 'cp437' ? iconv.decode(bytes, 'cp437') : this.decoder.write(bytes);
    this.parse(false);
  }

  private parse(flush: boolean): void {
    if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null; }
    let s = this.pending;
    while (s.length) {
      const c = s[0]!;
      if (c === '\x1b') {
        if (s.length === 1 && !flush) break; // wait a moment: it may be the start of an arrow key
        const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(s);
        if (m) {
          const code = m[1]!.replace(/^\[1;\d+([A-D])$/, '[$1');
          const name = SEQ[code];
          if (name) this.push({ name, ch: '' });
          s = s.slice(m[0].length);
          continue;
        }
        if (/^\x1b\[[0-9;]*$/.test(s) && !flush) break; // an incomplete CSI
        this.push({ name: 'escape', ch: '' });
        s = s.slice(1);
        continue;
      }
      s = s.slice(1);
      const code = c.charCodeAt(0);
      if (c === '\r' || c === '\n') this.push({ name: 'enter', ch: '' });
      else if (code === 8 || code === 127) this.push({ name: 'backspace', ch: '' });
      else if (c === '\t') this.push({ name: 'tab', ch: '' });
      else if (code < 32) this.push({ name: 'ctrl', ch: String.fromCharCode(code + 64) });
      else this.push({ name: 'char', ch: c });
    }
    this.pending = s;
    if (s && !flush) this.escTimer = setTimeout(() => this.parse(true), 60);
  }

  private push(k: Key): void {
    const w = this.waiters.shift();
    if (w) w(k); else if (this.keys.length < 256) this.keys.push(k);
  }

  // The next key, or null once the caller has gone.
  readKey(): Promise<Key | null> {
    if (this.closed) return Promise.resolve(null);
    const k = this.keys.shift();
    if (k) { this.shownSinceKey = false; return Promise.resolve(k); }
    return new Promise((resolve) => this.waiters.push((key) => { if (key) this.shownSinceKey = false; resolve(key); }));
  }

  // A line editor: typing, backspace, left/right, home/end. `mask` shows * for passwords. Escape or the
  // caller leaving gives null.
  async readLine(opts: { max?: number; mask?: boolean; initial?: string } = {}): Promise<string | null> {
    const max = opts.max ?? 200;
    let text = [...(opts.initial ?? '')];
    let pos = text.length;
    const shown = (s: string[]) => (opts.mask ? '*'.repeat(s.length) : s.join(''));
    if (text.length) this.echo(shown(text));
    for (;;) {
      const k = await this.readKey();
      if (!k) return null;
      if (k.name === 'enter') { this.echo('\r\n'); return text.join(''); }
      if (k.name === 'escape' || (k.name === 'ctrl' && k.ch === 'C')) { this.echo('\r\n'); return null; }
      if (k.name === 'char' && text.length < max) {
        text.splice(pos, 0, k.ch);
        const rest = shown(text.slice(pos));
        this.echo(rest + (rest.length > 1 ? `\x1b[${rest.length - 1}D` : ''));
        pos++;
      } else if (k.name === 'backspace' && pos > 0) {
        text.splice(pos - 1, 1);
        pos--;
        const rest = shown(text.slice(pos));
        this.echo(`\b${rest} \x1b[${rest.length + 1}D`);
      } else if (k.name === 'delete' && pos < text.length) {
        text.splice(pos, 1);
        const rest = shown(text.slice(pos));
        this.echo(`${rest} \x1b[${rest.length + 1}D`);
      } else if (k.name === 'left' && pos > 0) { pos--; this.echo('\x1b[D'); }
      else if (k.name === 'right' && pos < text.length) { pos++; this.echo('\x1b[C'); }
      else if (k.name === 'home' && pos > 0) { this.echo(`\x1b[${pos}D`); pos = 0; }
      else if (k.name === 'end' && pos < text.length) { this.echo(`\x1b[${text.length - pos}C`); pos = text.length; }
      else if (k.name === 'ctrl' && k.ch === 'U') { if (pos) this.echo(`\x1b[${pos}D`); this.echo('\x1b[K'); text = []; pos = 0; }
    }
  }

  // List prompts ("Number to read, Post, Quit:"): one of the given letters acts at once, as a single key would; a
  // digit starts a number, finished with Enter. Enter alone gives "" (usually: go back); Escape or leaving gives null.
  async pick(letters: string, max = 6): Promise<string | null> {
    for (;;) {
      const k = await this.readKey();
      if (!k) return null;
      if (k.name === 'enter') { this.echo('\r\n'); return ''; }
      if (k.name === 'escape') { this.echo('\r\n'); return null; }
      if (k.name !== 'char') continue;
      if (letters.toLowerCase().includes(k.ch.toLowerCase())) { this.echo(`${k.ch}\r\n`); return k.ch.toLowerCase(); }
      if (/[0-9]/.test(k.ch)) return this.readLine({ max, initial: k.ch });
    }
  }

  // "Press a key" prompts: one of the given letters (case-insensitive), Enter for the default.
  async choose(options: string, dflt?: string): Promise<string | null> {
    for (;;) {
      const k = await this.readKey();
      if (!k) return null;
      if (k.name === 'enter' && dflt) return dflt;
      if (k.name === 'escape') return null;
      if (k.name === 'char' && options.toLowerCase().includes(k.ch.toLowerCase())) return k.ch.toLowerCase();
    }
  }

  // ---------------------------------------------------------------- lifetime

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.onIdle?.(), this.idleMs);
    this.idleTimer.unref?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.escTimer) clearTimeout(this.escTimer);
    for (const w of this.waiters.splice(0)) w(null);
    this.t.end();
  }
}

// Telnet (RFC 854) with the options a BBS needs: ECHO and SUPPRESS-GO-AHEAD so the server draws every
// character (character mode), BINARY for 8-bit text, TTYPE (RFC 1091) to learn the terminal's name and
// NAWS (RFC 1073) for its size. Everything else is refused politely. The parser keeps the caller's
// keystrokes apart from protocol bytes, so the rest of the BBS never sees telnet.

export const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240, NOP = 241, GA = 249;
export const OPT = { BINARY: 0, ECHO: 1, SGA: 3, TTYPE: 24, NAWS: 31, LINEMODE: 34 } as const;
const TTYPE_IS = 0, TTYPE_SEND = 1;

export interface TelnetEvents {
  send(bytes: Buffer): void;                       // bytes to write back to the socket
  size?(cols: number, rows: number): void;         // NAWS
  ttype?(name: string): void;                      // each terminal type the client offers
}

// What the server asks for as soon as someone connects.
export const OPENING = Buffer.from([
  IAC, WILL, OPT.ECHO, IAC, WILL, OPT.SGA, IAC, DO, OPT.SGA,
  IAC, WILL, OPT.BINARY, IAC, DO, OPT.BINARY,
  IAC, DO, OPT.TTYPE, IAC, DO, OPT.NAWS,
]);

// Options we turn on at our end (WILL) and ask the client to turn on (DO).
const OURS = new Set<number>([OPT.ECHO, OPT.SGA, OPT.BINARY]);
const THEIRS = new Set<number>([OPT.SGA, OPT.BINARY, OPT.TTYPE, OPT.NAWS]);

export class TelnetParser {
  private state: 'data' | 'iac' | 'cmd' | 'sb' | 'sb-iac' = 'data';
  private cmd = 0;
  private sb: number[] = [];
  private lastCR = false;
  // What each side has agreed to, so we answer each request once and never loop (RFC 1143, simply).
  private we = new Map<number, boolean>([[OPT.ECHO, true], [OPT.SGA, true], [OPT.BINARY, true]]);
  private they = new Map<number, boolean>();
  private types: string[] = [];

  constructor(private readonly ev: TelnetEvents) {}

  // Returns the caller's typed bytes, with protocol removed and CR LF / CR NUL folded to CR.
  feed(chunk: Buffer): Buffer {
    const out: number[] = [];
    for (const b of chunk) {
      switch (this.state) {
        case 'data':
          if (b === IAC) { this.state = 'iac'; break; }
          if (this.lastCR && (b === 0 || b === 10)) { this.lastCR = false; break; }
          this.lastCR = b === 13;
          out.push(b);
          break;
        case 'iac':
          if (b === IAC) { out.push(IAC); this.state = 'data'; }
          else if (b === DO || b === DONT || b === WILL || b === WONT) { this.cmd = b; this.state = 'cmd'; }
          else if (b === SB) { this.sb = []; this.state = 'sb'; }
          else this.state = 'data'; // NOP, GA, AYT, BRK and the rest: nothing to do
          break;
        case 'cmd':
          this.negotiate(this.cmd, b);
          this.state = 'data';
          break;
        case 'sb':
          if (b === IAC) this.state = 'sb-iac';
          else if (this.sb.length < 512) this.sb.push(b);
          break;
        case 'sb-iac':
          if (b === SE) { this.subnegotiation(); this.state = 'data'; }
          else { if (this.sb.length < 512) this.sb.push(b); this.state = 'sb'; } // IAC IAC inside SB is one 255
          break;
      }
    }
    return Buffer.from(out);
  }

  private negotiate(cmd: number, opt: number): void {
    const reply = (c: number) => this.ev.send(Buffer.from([IAC, c, opt]));
    if (cmd === DO || cmd === DONT) {
      const want = cmd === DO && OURS.has(opt);
      if (this.we.get(opt) === want) return; // already agreed; don't answer again
      this.we.set(opt, want);
      reply(want ? WILL : WONT);
    } else {
      const want = cmd === WILL && THEIRS.has(opt);
      const had = this.they.get(opt);
      this.they.set(opt, want);
      if (had !== want) {
        // We asked with DO in the opening; a WILL is their yes and needs no reply. Anything we didn't ask for gets DONT.
        if (!(want && [OPT.SGA, OPT.BINARY, OPT.TTYPE, OPT.NAWS].includes(opt as 0))) reply(want ? DO : DONT);
      }
      if (want && opt === OPT.TTYPE) this.askType();
    }
  }

  private askType(): void { this.ev.send(Buffer.from([IAC, SB, OPT.TTYPE, TTYPE_SEND, IAC, SE])); }

  private subnegotiation(): void {
    const [opt, ...rest] = this.sb;
    if (opt === OPT.NAWS && rest.length >= 4) {
      const cols = (rest[0]! << 8) | rest[1]!;
      const rows = (rest[2]! << 8) | rest[3]!;
      if (cols > 0 && rows > 0) this.ev.size?.(Math.min(cols, 500), Math.min(rows, 300));
    } else if (opt === OPT.TTYPE && rest[0] === TTYPE_IS) {
      const name = Buffer.from(rest.slice(1)).toString('latin1').replace(/[^\x20-\x7e]/g, '').slice(0, 40);
      // Clients cycle through their names and repeat the last one when done (RFC 1091).
      if (!name || this.types.includes(name) || this.types.length >= 5) return;
      this.types.push(name);
      this.ev.ttype?.(name);
      this.askType();
    }
  }
}

// Bytes going out: a literal 255 must be doubled, and a bare LF becomes CR LF.
export function escapeOut(bytes: Buffer): Buffer {
  let extra = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === IAC || (bytes[i] === 10 && bytes[i - 1] !== 13)) extra++;
  if (!extra) return bytes;
  const out = Buffer.alloc(bytes.length + extra);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === IAC) out[j++] = IAC;
    else if (b === 10 && bytes[i - 1] !== 13) out[j++] = 13;
    out[j++] = b;
  }
  return out;
}

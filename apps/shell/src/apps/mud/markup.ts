// Evennia's colour markup (docs/09), as its WebSocket sends it in raw mode: |r |g |y |b |m |c |w |x
// (bright) and |R |G |Y |B |M |C |W |X (normal), |[r for a background, |555 for xterm-256 colours,
// |n reset, |u underline, |/ new line, |- tab, |_ space, || a literal bar, |=a…|=z greys, |i italic, |* inverse.
// Clickable links (|lc<command>|lt<text>|le) keep their text and carry the command. Nothing becomes HTML.
export interface MudSeg {
  text: string; fg?: string; bright?: boolean; rgb?: [number, number, number]; grey?: number; underline?: boolean;
  bg?: string; bgRgb?: [number, number, number]; italic?: boolean; inverse?: boolean; link?: string;
}

const COLOURS: Record<string, string> = { r: 'red', g: 'green', y: 'yellow', b: 'blue', m: 'magenta', c: 'cyan', w: 'white', x: 'black' };

// Evennia's web output escapes < > & and quotes as HTML entities even in raw mode, so "<text>" would show as "&lt;text&gt;". They are
// turned back into the characters (as text: nothing here ever becomes HTML), once, after the markup is read.
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
export const decodeEntities = (s: string): string => s.replace(/&(?:lt|gt|amp|quot|nbsp|#x27|#39);/g, (e) => ENTITIES[e] ?? e);

export function parseMarkup(input: string): MudSeg[][] {
  const lines: MudSeg[][] = [[]];
  let style: Omit<MudSeg, 'text'> = {};
  let buf = '';
  const flush = () => { if (buf) { lines[lines.length - 1]!.push({ text: decodeEntities(buf), ...style }); buf = ''; } };
  const newline = () => { flush(); lines.push([]); };
  const s = input.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\n') { newline(); continue; }
    if (ch === '\x1b') {
      // Evennia's menus arrive with real ANSI colour codes mixed in, even in raw mode (VERIFIED, 5.0.1).
      const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(s.slice(i));
      if (m) {
        if (m[2] === 'm') { flush(); style = applySgr(style, m[1]!); }
        i += m[0].length - 1;
        continue;
      }
    }
    if (ch !== '|' || i === s.length - 1) { buf += ch; continue; }
    const next = s[i + 1]!;
    if (next === '|') { buf += '|'; i++; continue; }
    if (next === '/') { newline(); i++; continue; }
    if (next === '-') { buf += '    '; i++; continue; }
    if (next === '_') { buf += ' '; i++; continue; }
    if (next === 'n') { flush(); style = {}; i++; continue; }
    if (next === 'u') { flush(); style = { ...style, underline: true }; i++; continue; }
    if (next === 'l') { // |lc<command>|lt<text>|le: the text, carrying the command to send when it is clicked
      const lt = s.indexOf('|lt', i);
      const le = s.indexOf('|le', i);
      if (s[i + 2] === 'c' && lt > i && le > lt) {
        flush();
        const cmd = stripCodes(s.slice(i + 3, lt)).trim();
        style = { ...style, link: cmd || undefined };
        i = lt + 2; continue; // parse the visible text as usual
      }
      if (s[i + 2] === 'e') { flush(); style = { ...style, link: undefined }; i += 2; continue; }
      if (s[i + 2] === 't') { i += 2; continue; }
    }
    const lower = next.toLowerCase();
    if (COLOURS[lower]) { flush(); style = { ...style, fg: COLOURS[lower], bright: next === lower, rgb: undefined, grey: undefined }; i++; continue; }
    if (/^[0-5]{3}$/.test(s.slice(i + 1, i + 4))) {
      flush();
      const [r, g, b] = s.slice(i + 1, i + 4).split('').map(Number) as [number, number, number];
      style = { ...style, rgb: [r, g, b], fg: undefined, grey: undefined };
      i += 3;
      continue;
    }
    if (next === '[') { // a background, drawn faintly toward the theme's own so text stays readable
      const m = /^\[([rgybmcwxRGYBMCWX]|[0-5]{3}|=[a-z])/.exec(s.slice(i + 1));
      if (m) {
        flush();
        const v = m[1]!;
        if (/^[0-5]{3}$/.test(v)) style = { ...style, bgRgb: v.split('').map(Number) as [number, number, number], bg: undefined };
        else if (v.startsWith('=')) style = { ...style, bg: 'grey', bgRgb: undefined };
        else style = { ...style, bg: COLOURS[v.toLowerCase()], bgRgb: undefined };
        i += m[0].length; continue;
      }
    }
    if (next === '=' && /[a-z]/.test(s[i + 2] ?? '')) { flush(); style = { ...style, grey: s.charCodeAt(i + 2) - 97, fg: undefined, rgb: undefined }; i += 2; continue; }
    if (next === 'i') { flush(); style = { ...style, italic: true }; i++; continue; }
    if (next === '*') { flush(); style = { ...style, inverse: true }; i++; continue; }
    if ('hH^'.includes(next)) { i++; continue; } // bold on/off and blink: the colours carry it
    buf += ch;
  }
  flush();
  return lines;
}

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

// An xterm-256 colour number as the 0–5 cube Evennia uses, or a grey (0–23).
function x256(n: number): { rgb?: [number, number, number]; grey?: number; fg?: string; bright?: boolean } {
  if (n < 8) return { fg: ANSI[n] };
  if (n < 16) return { fg: ANSI[n - 8], bright: true };
  if (n < 232) { const c = n - 16; return { rgb: [Math.floor(c / 36), Math.floor(c / 6) % 6, c % 6] }; }
  return { grey: Math.min(25, n - 232) };
}

function applySgr(style: Omit<MudSeg, 'text'>, params: string): Omit<MudSeg, 'text'> {
  let next = { ...style };
  const ps = (params || '0').split(';').map(Number);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p === 0) next = { link: next.link };
    else if (p === 1) next = { ...next, bright: true };
    else if (p === 3) next = { ...next, italic: true };
    else if (p === 4) next = { ...next, underline: true };
    else if (p === 7) next = { ...next, inverse: true };
    else if (p === 23) next = { ...next, italic: false };
    else if (p === 24) next = { ...next, underline: false };
    else if (p === 27) next = { ...next, inverse: false };
    else if (p >= 30 && p <= 37) next = { ...next, fg: ANSI[p - 30], rgb: undefined, grey: undefined };
    else if (p >= 90 && p <= 97) next = { ...next, fg: ANSI[p - 90], bright: true, rgb: undefined, grey: undefined };
    else if (p === 39) next = { ...next, fg: undefined, rgb: undefined, grey: undefined };
    else if (p >= 40 && p <= 47) next = { ...next, bg: ANSI[p - 40], bgRgb: undefined };
    else if (p >= 100 && p <= 107) next = { ...next, bg: ANSI[p - 100], bgRgb: undefined };
    else if (p === 49) next = { ...next, bg: undefined, bgRgb: undefined };
    else if ((p === 38 || p === 48) && ps[i + 1] === 5 && ps[i + 2] !== undefined) {
      const c = x256(ps[i + 2]!);
      if (p === 38) next = { ...next, fg: c.fg, bright: c.bright ?? next.bright, rgb: c.rgb, grey: c.grey };
      else next = { ...next, bg: c.fg ?? (c.grey !== undefined ? 'grey' : undefined), bgRgb: c.rgb };
      i += 2;
    }
  }
  return next;
}

// Colour codes taken out of a link's command, so "|lc|wlook|n|lt" sends "look".
const stripCodes = (t: string) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\|(?:[rgybmcwxnuRGYBMCWXhH*^i\/\-_]|[0-5]{3}|=[a-z]|\[(?:[rgybmcwxRGYBMCWX]|[0-5]{3}|=[a-z]))/g, '');

export const plainText =(input: string) => parseMarkup(input).map((l) => l.map((x) => x.text).join('')).join('\n');

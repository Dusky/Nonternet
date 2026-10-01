// Evennia's colour markup (docs/09), as its WebSocket sends it in raw mode: |r |g |y |b |m |c |w |x
// (bright) and |R |G |Y |B |M |C |W |X (normal), |[r for a background, |555 for xterm-256 colours,
// |n reset, |u underline, |/ new line, |- tab, |_ space, || a literal bar. Clickable links
// (|lc<command>|lt<text>|le) keep their text. Nothing becomes HTML.
export interface MudSeg { text: string; fg?: string; bright?: boolean; rgb?: [number, number, number]; underline?: boolean }

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
    if (next === 'l') { // |lc...|lt...|le: keep the visible text only
      const lt = s.indexOf('|lt', i);
      const le = s.indexOf('|le', i);
      if (s[i + 2] === 'c' && lt > i && le > lt) { i = lt + 2; continue; } // parse the visible text as usual
      if (s[i + 2] === 'e' || s[i + 2] === 't') { i += 2; continue; }
    }
    const lower = next.toLowerCase();
    if (COLOURS[lower]) { flush(); style = { ...style, fg: COLOURS[lower], bright: next === lower, rgb: undefined }; i++; continue; }
    if (/^[0-5]{3}$/.test(s.slice(i + 1, i + 4))) {
      flush();
      const [r, g, b] = s.slice(i + 1, i + 4).split('').map(Number) as [number, number, number];
      style = { ...style, rgb: [r, g, b], fg: undefined };
      i += 3;
      continue;
    }
    if (next === '[' ) { // backgrounds are dropped: the theme keeps the page readable
      const m = /^\[([rgybmcwxRGYBMCWX]|[0-5]{3}|=[a-z])/.exec(s.slice(i + 1));
      if (m) { i += m[0].length; continue; }
    }
    if (next === '=' && /[a-z]/.test(s[i + 2] ?? '')) { flush(); style = { ...style, fg: 'grey', rgb: undefined }; i += 2; continue; }
    if ('hH*^i'.includes(next)) { i++; continue; } // highlight, invert, blink, italic: ignored
    buf += ch;
  }
  flush();
  return lines;
}

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

function applySgr(style: Omit<MudSeg, 'text'>, params: string): Omit<MudSeg, 'text'> {
  let next = { ...style };
  for (const p of (params || '0').split(';').map(Number)) {
    if (p === 0) next = {};
    else if (p === 1) next = { ...next, bright: true };
    else if (p === 4) next = { ...next, underline: true };
    else if (p >= 30 && p <= 37) next = { ...next, fg: ANSI[p - 30], rgb: undefined };
    else if (p >= 90 && p <= 97) next = { ...next, fg: ANSI[p - 90], bright: true, rgb: undefined };
    else if (p === 39) next = { ...next, fg: undefined };
  }
  return next;
}

export const plainText =(input: string) => parseMarkup(input).map((l) => l.map((x) => x.text).join('')).join('\n');

// mIRC formatting codes (docs/08): bold ^B, italic ^], underline ^_, strikethrough ^^, monospace ^Q,
// reverse ^V, colour ^C<fg>[,<bg>], reset ^O. The text is parsed into plain segments; nothing here
// ever becomes HTML, so a message cannot inject markup.
export interface Segment { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; mono?: boolean; fg?: number; bg?: number; link?: string }

interface Style { bold: boolean; italic: boolean; underline: boolean; strike: boolean; mono: boolean; fg?: number; bg?: number }
const plain = (): Style => ({ bold: false, italic: false, underline: false, strike: false, mono: false });

export function parseFormatting(input: string): Segment[] {
  const out: Segment[] = [];
  let s = plain();
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const seg: Segment = { text: buf };
    if (s.bold) seg.bold = true;
    if (s.italic) seg.italic = true;
    if (s.underline) seg.underline = true;
    if (s.strike) seg.strike = true;
    if (s.mono) seg.mono = true;
    if (s.fg !== undefined) seg.fg = s.fg;
    if (s.bg !== undefined) seg.bg = s.bg;
    out.push(seg);
    buf = '';
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    switch (ch) {
      case '\x02': flush(); s = { ...s, bold: !s.bold }; break;
      case '\x1d': flush(); s = { ...s, italic: !s.italic }; break;
      case '\x1f': flush(); s = { ...s, underline: !s.underline }; break;
      case '\x1e': flush(); s = { ...s, strike: !s.strike }; break;
      case '\x11': flush(); s = { ...s, mono: !s.mono }; break;
      case '\x16': flush(); s = { ...s, fg: s.bg ?? 1, bg: s.fg ?? 0 }; break;
      case '\x0f': flush(); s = plain(); break;
      case '\x03': {
        flush();
        const m = /^(\d{1,2})(?:,(\d{1,2}))?/.exec(input.slice(i + 1));
        if (!m) { s = { ...s, fg: undefined, bg: undefined }; break; }
        const fg = Number(m[1]);
        const bg = m[2] !== undefined ? Number(m[2]) : s.bg;
        // Only the 16 classic colours are shown; 99 means "default", and higher codes fall back to it.
        s = { ...s, fg: fg < 16 ? fg : undefined, bg: bg !== undefined && bg < 16 ? bg : undefined };
        i += m[0].length;
        break;
      }
      default:
        buf += ch;
    }
  }
  flush();
  return linkify(out);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;

function linkify(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    let last = 0;
    for (const m of seg.text.matchAll(URL_RE)) {
      if (m.index! > last) out.push({ ...seg, text: seg.text.slice(last, m.index) });
      out.push({ ...seg, text: m[0], link: m[0] });
      last = m.index! + m[0].length;
    }
    if (last < seg.text.length) out.push(last === 0 ? seg : { ...seg, text: seg.text.slice(last) });
  }
  return out;
}

export const stripFormatting = (s: string) => parseFormatting(s).map((x) => x.text).join('');

// Does this message mention the nick, as a whole word?
export function mentions(text: string, nick: string): boolean {
  const esc = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_\\-\\[\\]\\\\^{}|\`])${esc}($|[^A-Za-z0-9_\\-\\[\\]\\\\^{}|\`])`, 'i').test(stripFormatting(text));
}

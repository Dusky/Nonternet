import stringWidth from 'string-width';

// Small text helpers for fixed-width screens. Widths are the columns a terminal draws: most characters take one,
// Chinese, Japanese, Korean and most emoji take two (as xterm with Unicode 11 and SyncTERM draw them), and a character
// built from several code points (a flag, a family emoji) is measured as one.
// Colour codes take no room on screen, so they are skipped when measuring and never cut in half: a code cut short
// swallows the characters after it.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/y;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const visible = (s: string): { text: string; cols: number }[] => {
  const out: { text: string; cols: number }[] = [];
  let run = '';
  const flush = () => { for (const g of graphemes.segment(run)) out.push({ text: g.segment, cols: stringWidth(g.segment) }); run = ''; };
  for (let i = 0; i < s.length;) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) { flush(); out.push({ text: m[0], cols: 0 }); i += m[0].length; continue; }
    run += s[i];
    i += 1;
  }
  flush();
  return out;
};
// As much as fits in `w` columns, keeping every colour code (so a colour that was turned on is turned off again).
// A wide character that would only half fit is left out, so the line never spills over.
const take = (s: string, w: number) => {
  let n = 0;
  return visible(s).filter((p) => { if (p.cols === 0 && p.text.startsWith('\x1b')) return true; if (n + p.cols > w) { n = w + 1; return false; } n += p.cols; return true; }).map((p) => p.text).join('');
};
// Splits plain text (no colour codes) at `w` columns, never inside a character.
const splitAt = (s: string, w: number): [string, string] => {
  let n = 0;
  let i = 0;
  for (const g of graphemes.segment(s)) { const c = stringWidth(g.segment); if (n + c > w) break; n += c; i = g.index + g.segment.length; }
  return [s.slice(0, i), s.slice(i)];
};
export const width = (s: string) => visible(s).reduce((n, p) => n + p.cols, 0);
export const pad = (s: string, w: number) => { const t = width(s) > w ? take(s, w) : s; return t + ' '.repeat(Math.max(0, w - width(t))); };
export const cut = (s: string, w: number) => (width(s) <= w ? s : `${take(s, Math.max(0, w - 1))}…`);
export const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
// The rule after the title fills to about 70 columns, or less on a narrow screen so it never wraps.
export const heading = (s: string, cols = 80) => `\x1b[36m── \x1b[1m${s}\x1b[0m\x1b[36m ${'─'.repeat(Math.max(3, Math.min(70 - width(s), cols - 5 - width(s))))}\x1b[0m`;

// Word-wraps text to a width, keeping blank lines and breaking words longer than a line.
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (let word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) { if (line) line += ' '; continue; }
      while (width(word) > w) {
        const room = w - width(line);
        if (room <= 0) { out.push(line.trimEnd()); line = ''; continue; }
        const [head, rest] = splitAt(word, room);
        // A wide character never fits a one-column gap: start it on the next line.
        if (!head) { out.push(line.trimEnd()); line = ''; if (room === w) { out.push(rest.slice(0, 1)); word = rest.slice(1); } continue; }
        out.push(line + head);
        word = rest;
        line = '';
      }
      if (width(line) + width(word) > w) { out.push(line.trimEnd()); line = word; }
      else line += word;
    }
    out.push(line.trimEnd());
  }
  return out;
}

// A table that fits the screen (docs/04). Wide enough: the usual fixed columns, the last one taking what is left. On a
// narrow screen (a phone is about 33 columns) each row becomes two lines, the `main` cells first and the rest indented and
// dim below, so nothing wraps into the next row's place.
export interface Column { label: string; width: number; main?: boolean; narrowLabel?: string }
export const tableIsWide = (cols: number, columns: Column[]) => columns.slice(0, -1).reduce((n, c) => n + c.width, 0) + 8 <= cols - 1;
export function tableHead(cols: number, columns: Column[]): string {
  if (tableIsWide(cols, columns)) return dim(columns.map((c, i) => (i === columns.length - 1 ? c.label : pad(c.label, c.width))).join(''));
  const main = columns.filter((c) => c.main).map((c) => c.label).join(' ');
  const rest = columns.filter((c) => !c.main).map((c) => c.label).join(' · ');
  return dim(cut(rest ? `${main}, then ${rest}` : main, cols - 1));
}
export function tableRow(cols: number, columns: Column[], cells: string[]): string[] {
  if (tableIsWide(cols, columns)) {
    let used = 0;
    return [cells.map((cell, i) => {
      const c = columns[i]!;
      if (i === columns.length - 1) return cut(cell, Math.max(4, cols - 1 - used));
      used += c.width;
      return width(cell) <= c.width ? pad(cell, c.width) : pad(cut(cell, c.width - 1), c.width);
    }).join('')];
  }
  const main = cells.filter((_, i) => columns[i]!.main).map((x) => x.trim()).filter(Boolean).join(' ');
  const rest = cells.map((x, i) => ({ x: x.trim(), c: columns[i]! })).filter(({ x, c }) => !c.main && x && x !== '-')
    .map(({ x, c }) => (c.narrowLabel ? `${c.narrowLabel} ${x}` : x)).join(' · ');
  return [cut(main, cols - 1), ...(rest ? [`   ${dim(cut(rest, cols - 4))}`] : [])];
}

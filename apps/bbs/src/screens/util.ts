// Small text helpers for fixed-width screens. Widths count characters, not bytes.
// Colour codes take no room on screen, so they are skipped when measuring and never cut in half: a code cut short
// swallows the characters after it.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/y;
const visible = (s: string): { text: string; ansi: boolean }[] => {
  const out: { text: string; ansi: boolean }[] = [];
  for (let i = 0; i < s.length;) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) { out.push({ text: m[0], ansi: true }); i += m[0].length; continue; }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    out.push({ text: ch, ansi: false });
    i += ch.length;
  }
  return out;
};
// The first `w` visible characters, keeping every colour code (so a colour that was turned on is turned off again).
const take = (s: string, w: number) => {
  let n = 0;
  return visible(s).filter((p) => p.ansi || n++ < w).map((p) => p.text).join('');
};
export const width = (s: string) => visible(s).filter((p) => !p.ansi).length;
export const pad = (s: string, w: number) => { const n = width(s); return n >= w ? take(s, w) : s + ' '.repeat(w - n); };
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
        out.push(line + [...word].slice(0, room).join(''));
        word = [...word].slice(room).join('');
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

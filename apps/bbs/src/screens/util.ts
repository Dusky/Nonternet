// Small text helpers for fixed-width screens. Widths count characters, not bytes.
export const width = (s: string) => [...s].length;
export const pad = (s: string, w: number) => { const c = [...s]; return c.length >= w ? c.slice(0, w).join('') : s + ' '.repeat(w - c.length); };
export const cut = (s: string, w: number) => { const c = [...s]; return c.length <= w ? s : `${c.slice(0, Math.max(0, w - 1)).join('')}…`; };
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

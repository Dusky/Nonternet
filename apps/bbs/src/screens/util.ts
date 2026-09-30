// Small text helpers for fixed-width screens. Widths count characters, not bytes.
export const width = (s: string) => [...s].length;
export const pad = (s: string, w: number) => { const c = [...s]; return c.length >= w ? c.slice(0, w).join('') : s + ' '.repeat(w - c.length); };
export const cut = (s: string, w: number) => { const c = [...s]; return c.length <= w ? s : `${c.slice(0, Math.max(0, w - 1)).join('')}…`; };
export const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const heading = (s: string) => `\x1b[36m── \x1b[1m${s}\x1b[0m\x1b[36m ${'─'.repeat(Math.max(3, 70 - width(s)))}\x1b[0m`;

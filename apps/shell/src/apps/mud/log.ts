import { parseMarkup, plainText } from './markup';
import type { Line } from './store';

// Saving the session (docs/09): the log as plain text, or as an HTML page with the colours, to keep or share.
// Nothing from the game becomes markup: every piece of text is escaped.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const HEX: Record<string, string> = { red: '#e05050', green: '#40c040', yellow: '#d8b030', blue: '#6080ff', magenta: '#d060d0', cyan: '#30c0c0', white: '#f0f0f0', black: '#808080', grey: '#a0a0a0' };

type Note = (l: Line) => string;

function lineText(l: Line, note: Note): string[] {
  if (l.kind === 'you') return [`> ${l.text}`];
  if (l.kind === 'note') return [note(l)];
  return plainText(l.text).split('\n').filter((_, i) => !l.gagged?.includes(i));
}

export function logAsText(lines: Line[], note: Note): string {
  return lines.flatMap((l) => lineText(l, note)).join('\n') + '\n';
}

export function logAsHtml(lines: Line[], title: string, note: Note): string {
  const body = lines.map((l) => {
    if (l.kind !== 'game') return `<div class="${l.kind}">${esc(lineText(l, note)[0]!)}</div>`;
    return parseMarkup(l.text).map((segs, i) => (l.gagged?.includes(i) ? '' : `<div>${segs.map((s) => {
      const c = s.fg ? HEX[s.fg] : s.rgb ? `rgb(${s.rgb.map((v) => (v ? 55 + v * 40 : 0)).join(',')})` : undefined;
      const st = [c && `color:${c}`, s.underline && 'text-decoration:underline', s.italic && 'font-style:italic'].filter(Boolean).join(';');
      return st ? `<span style="${st}">${esc(s.text)}</span>` : esc(s.text);
    }).join('') || '&nbsp;'}</div>`)).join('');
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{background:#111;color:#ddd;font:14px/1.45 monospace;white-space:pre-wrap;padding:1rem}.you{color:#999}.note{color:#999;font-style:italic}</style>\n${body}\n`;
}

export function downloadLog(lines: Line[], kind: 'txt' | 'html', note: Note): void {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `mud-log-${stamp}.${kind}`;
  const data = kind === 'txt' ? logAsText(lines, note) : logAsHtml(lines, name, note);
  const url = URL.createObjectURL(new Blob([data], { type: kind === 'txt' ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

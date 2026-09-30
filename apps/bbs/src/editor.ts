import type { Session } from './session';
import { bold, dim, wrap } from './screens/util';

// The message editor (docs/04): a line editor. Type lines; commands start with a slash on a line of their
// own. /s saves, /a abandons, /q quotes the message you are replying to, /l lists what you have, /d deletes
// the last line, /? shows this. Lines are joined with newlines; the site stores exactly that.
export async function editMessage(s: Session, opts: { quote?: { author: string; body: string } } = {}): Promise<string | null> {
  const t = s.term;
  const width = Math.min(79, t.cols - 1);
  const lines: string[] = [];
  const help = () => t.line(dim(`Type your message. On a line of its own: /s save, /a abandon, ${opts.quote ? '/q quote, ' : ''}/l list, /d delete last line, /? help.`));
  help();
  for (;;) {
    t.write(dim(`${String(lines.length + 1).padStart(3)}: `));
    const line = await t.readLine({ max: 500 });
    if (line === null) {
      t.write('Abandon this message? [y/N] ');
      if ((await t.choose('yn', 'n')) === 'y') { t.line('Abandoned.'); return null; }
      t.line('Carry on.');
      continue;
    }
    const cmd = line.trim().toLowerCase();
    if (cmd === '/s') {
      const text = lines.join('\n').replace(/\s+$/, '');
      if (!text.trim()) { t.line('There is nothing to save yet. Type something, or /a to abandon.'); continue; }
      return text;
    }
    if (cmd === '/a') { t.line('Abandoned.'); return null; }
    if (cmd === '/?') { help(); continue; }
    if (cmd === '/l') { lines.forEach((l, i) => t.line(`${dim(String(i + 1).padStart(3))}: ${l}`)); continue; }
    if (cmd === '/d') { if (lines.pop() !== undefined) t.line('Deleted the last line.'); continue; }
    if (cmd === '/q' && opts.quote) {
      const quoted = wrap(opts.quote.body, width - 2).filter((l, i, a) => l || (i > 0 && i < a.length - 1)).slice(0, 40).map((l) => `> ${l}`);
      lines.push(`${opts.quote.author} wrote:`, ...quoted, '');
      t.line(bold(`Quoted ${quoted.length} lines. /l to see them.`));
      continue;
    }
    lines.push(line);
  }
}

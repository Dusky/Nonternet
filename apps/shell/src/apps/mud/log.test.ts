import { describe, expect, it } from 'vitest';
import { logAsHtml, logAsText } from './log';
import type { Line } from './store';

const lines: Line[] = [
  { id: 1, time: 0, kind: 'you', text: 'look' },
  { id: 2, time: 0, kind: 'game', text: '|cTown square|n\n<script>x</script>\nhidden line', gagged: [2] },
  { id: 3, time: 0, kind: 'note', text: '', key: 'mud.note.closed' },
];
const note = () => 'Disconnected.';

describe('saving the log', () => {
  it('as text: what you typed, what the game said (without hidden lines), notes in words', () => {
    expect(logAsText(lines, note)).toBe('> look\nTown square\n<script>x</script>\nDisconnected.\n');
  });
  it('as HTML: coloured, and nothing from the game becomes markup', () => {
    const html = logAsHtml(lines, 'log <1>', note);
    expect(html).toContain('<span style="color:#30c0c0">Town square</span>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('hidden line');
    expect(html).toContain('<title>log &lt;1&gt;</title>');
  });
});

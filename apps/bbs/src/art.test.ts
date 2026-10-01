import { describe, expect, it } from 'vitest';
import { clipLine } from './art';
import { heading } from './screens/util';

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

describe('fitting art to a narrow screen', () => {
  it('cuts a line at the screen width, counting only what is drawn, and closes the colour', () => {
    const line = '\x1b[36m' + '─'.repeat(70) + '\x1b[0m';
    const cut = clipLine(line, 30);
    expect([...visible(cut)].length).toBe(30);
    expect(cut.endsWith('\x1b[0m')).toBe(true);
    expect(clipLine('short', 30)).toBe('short');
    expect(clipLine('\x1b[1mbold\x1b[0m', 4)).toBe('\x1b[1mbold\x1b[0m'); // fits exactly: nothing lost
  });
  it('keeps a heading on one line on a phone-sized terminal and full length on a wide one', () => {
    expect([...visible(heading('Voting booth', 35))].length).toBeLessThanOrEqual(35);
    expect([...visible(heading('Voting booth', 100))].length).toBeGreaterThan(60);
  });
});

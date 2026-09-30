import { describe, expect, it } from 'vitest';
import { Term, encodingFor } from './term';

function term() {
  const out: Buffer[] = [];
  const t = new Term({ write: (b) => out.push(b), end: () => undefined });
  return { t, out, text: () => Buffer.concat(out).toString('utf8'), bytes: () => Buffer.concat(out) };
}

describe('the terminal', () => {
  it('turns bytes into keys, arrows included, even when a sequence is split', async () => {
    const { t } = term();
    t.input(Buffer.from('a\x1b['));
    t.input(Buffer.from('A\x1b[3~\x7f\r'));
    const names = [];
    for (let i = 0; i < 5; i++) names.push((await t.readKey())!.name);
    expect(names).toEqual(['char', 'up', 'delete', 'backspace', 'enter']);
  });

  it('treats a lone Escape as Escape after a moment', async () => {
    const { t } = term();
    t.input(Buffer.from('\x1b'));
    expect((await t.readKey())!.name).toBe('escape');
  });

  it('edits a line with backspace and arrows, and masks passwords', async () => {
    const { t, text } = term();
    const line = t.readLine();
    t.input(Buffer.from('helo\x1b[D\x1b[Dl\x7f'));
    t.input(Buffer.from('l\r'));
    expect(await line).toBe('hello');
    const pw = t.readLine({ mask: true });
    t.input(Buffer.from('s3cret\r'));
    expect(await pw).toBe('s3cret');
    expect(text()).not.toContain('s3cret');
  });

  it('keeps multi-byte UTF-8 whole across packets', async () => {
    const { t } = term();
    const line = t.readLine();
    const e = Buffer.from('café\r');
    t.input(e.subarray(0, 4));
    t.input(e.subarray(4));
    expect(await line).toBe('café');
  });

  it('speaks CP437 to classic clients, both ways, and shows ? for what it cannot draw', async () => {
    const { t, bytes } = term();
    t.encoding = 'cp437';
    t.write('café ░ 🙂\n');
    expect([...bytes()]).toEqual([0x63, 0x61, 0x66, 0x82, 0x20, 0xb0, 0x20, 0x3f, 0x0d, 0x0a]); // é = 0x82, ░ = 0xB0, one ? for the emoji
    const line = t.readLine();
    t.input(Buffer.from([0x63, 0x61, 0x66, 0x82, 0x0d]));
    expect(await line).toBe('café');
  });

  it('picks CP437 for classic terminal types and UTF-8 for the rest', () => {
    expect(encodingFor('ANSI')).toBe('cp437');
    expect(encodingFor('syncterm')).toBe('cp437');
    expect(encodingFor('xterm-256color')).toBe('utf8');
    expect(encodingFor(null)).toBe('utf8');
  });

  it('gives null to anyone waiting once the caller leaves', async () => {
    const { t } = term();
    const k = t.readKey();
    t.close();
    expect(await k).toBeNull();
    expect(await t.readLine()).toBeNull();
  });
});

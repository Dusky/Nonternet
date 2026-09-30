import { describe, expect, it } from 'vitest';
import { DO, DONT, IAC, OPT, SB, SE, TelnetParser, WILL, WONT, escapeOut } from './telnet';

function setup() {
  const sent: number[][] = [];
  const sizes: [number, number][] = [];
  const types: string[] = [];
  const p = new TelnetParser({ send: (b) => sent.push([...b]), size: (c, r) => sizes.push([c, r]), ttype: (t) => types.push(t) });
  return { p, sent, sizes, types };
}

describe('telnet', () => {
  it('passes typed bytes through and folds CR LF and CR NUL into CR', () => {
    const { p } = setup();
    expect([...p.feed(Buffer.from('hi\r\nyo\r\0!\r'))]).toEqual([...Buffer.from('hi\ryo\r!\r')]);
    expect([...p.feed(Buffer.from('\nz'))]).toEqual([...Buffer.from('z')]); // the LF of a CR split across packets
  });

  it('turns IAC IAC into one 255 and drops commands', () => {
    const { p } = setup();
    expect([...p.feed(Buffer.from([65, IAC, IAC, 66, IAC, 241, 67]))]).toEqual([65, 255, 66, 67]);
  });

  it('reads the window size, even split across packets and with an escaped 255', () => {
    const { p, sizes } = setup();
    p.feed(Buffer.from([IAC, SB, OPT.NAWS, 0, 80]));
    p.feed(Buffer.from([0, 24, IAC, SE]));
    p.feed(Buffer.from([IAC, SB, OPT.NAWS, 0, IAC, IAC, 0, 50, IAC, SE]));
    expect(sizes).toEqual([[80, 24], [255, 50]]);
  });

  it('asks for the terminal type when the client agrees, and follows the cycle to the end', () => {
    const { p, sent, types } = setup();
    p.feed(Buffer.from([IAC, WILL, OPT.TTYPE]));
    expect(sent).toEqual([[IAC, SB, OPT.TTYPE, 1, IAC, SE]]);
    const is = (name: string) => Buffer.from([IAC, SB, OPT.TTYPE, 0, ...Buffer.from(name), IAC, SE]);
    p.feed(is('XTERM-256COLOR'));
    p.feed(is('ANSI'));
    p.feed(is('ANSI')); // repeated: the list is over
    expect(types).toEqual(['XTERM-256COLOR', 'ANSI']);
    expect(sent).toHaveLength(3);
  });

  it('refuses options it does not know, once, and never loops', () => {
    const { p, sent } = setup();
    p.feed(Buffer.from([IAC, DO, OPT.LINEMODE, IAC, DO, OPT.LINEMODE, IAC, WILL, 99, IAC, WILL, 99]));
    expect(sent).toEqual([[IAC, WONT, OPT.LINEMODE], [IAC, DONT, 99]]);
    p.feed(Buffer.from([IAC, DO, OPT.ECHO])); // we already offered ECHO: no answer needed
    expect(sent).toHaveLength(2);
    p.feed(Buffer.from([IAC, DONT, OPT.ECHO]));
    expect(sent.at(-1)).toEqual([IAC, WONT, OPT.ECHO]);
  });

  it('doubles 255 and turns bare LF into CR LF on the way out', () => {
    expect([...escapeOut(Buffer.from([65, 255, 10, 13, 10]))]).toEqual([65, 255, 255, 13, 10, 13, 10]);
  });
});

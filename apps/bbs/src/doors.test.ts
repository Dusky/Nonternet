import { describe, expect, it } from 'vitest';
import { door32, doorSys } from './doors';

const info = { node: 3, handle: 'zerocool', name: 'Dade', role: 'trusted', minutes: 30, rows: 24, lastCall: '2026-09-01T10:20:00.000Z' };

describe('drop files', () => {
  it('writes DOOR32.SYS in its eleven lines', () => {
    const l = door32(info).split('\r\n');
    expect(l).toHaveLength(12); // eleven and the final line break
    expect(l.slice(0, 11)).toEqual(['0', '0', '38400', 'BBS 1.0', '1', 'Dade', 'zerocool', '50', '30', '1', '3']);
  });
  it('writes DOOR.SYS in the 52-line GAP layout', () => {
    const l = doorSys(info, new Date('2026-09-30T21:05:00Z')).split('\r\n');
    expect(l).toHaveLength(53);
    expect(l[3]).toBe('3');            // node
    expect(l[9]).toBe('Dade');         // user's name
    expect(l[14]).toBe('50');          // security level
    expect(l[16]).toBe('09/01/26');    // last call
    expect(l[18]).toBe('30');          // minutes left
    expect(l[20]).toBe('24');          // page length
    expect(l[35]).toBe('zerocool');    // alias
    expect(l[43]).toBe('21:05');       // time of this call
  });
});

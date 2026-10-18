import { describe, expect, it } from 'vitest';
import { decodeCp437, encodeCp437 } from './cp437';

describe('CP437 symbols in the control range', () => {
  it('reads the PC symbols a door draws, and keeps the codes a terminal acts on', () => {
    expect(decodeCp437(Buffer.from([0x01, 0x03, 0x10, 0x18, 0x1a, 0x7f, 0x82]))).toBe('☺♥►↑→⌂é');
    expect(decodeCp437(Buffer.from([0x1b, 0x5b, 0x31, 0x6d, 0x0d, 0x0a, 0x07]))).toBe('\x1b[1m\r\n\x07');
  });
  it('sends them back as the same bytes, and anything else as CP437 always did', () => {
    expect([...encodeCp437('☺♥ hi ►⌂ Café')]).toEqual([0x01, 0x03, 0x20, 0x68, 0x69, 0x20, 0x10, 0x7f, 0x20, 0x43, 0x61, 0x66, 0x82]);
    expect([...encodeCp437('\x1b[0m\r\n')]).toEqual([0x1b, 0x5b, 0x30, 0x6d, 0x0d, 0x0a]);
  });
});

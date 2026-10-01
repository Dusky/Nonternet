import { describe, expect, it } from 'vitest';
import { backoffMs, wasDropped } from './reconnect';

describe('reconnecting', () => {
  it('waits 1 s, 2 s, 4 s … and never more than about 30 s', () => {
    const none = () => 0;
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => backoffMs(n, none))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  it('adds a little jitter, under half a second', () => {
    expect(backoffMs(0, () => 0.99)).toBeLessThan(1500);
  });
  it('comes back after a lost connection, not after a goodbye', () => {
    expect([1006, 1001, 1012, 1013].every(wasDropped)).toBe(true);
    expect([1000, 1005, 1008].some(wasDropped)).toBe(false);
  });
});

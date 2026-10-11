import { describe, expect, it } from 'vitest';
import { MODES, resolveMode } from './theme';

describe('light or dark', () => {
  it('has the three choices, following the device by default', () => {
    expect([...MODES]).toEqual(['system', 'light', 'dark']);
  });
  it('follows the device only when asked to', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});

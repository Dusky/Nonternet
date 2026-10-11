import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForUpdate } from './chunkError';

describe('a failed import after an update', () => {
  it('is told apart from other errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/HomepagesApp-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError('nothing')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloading for an update', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('reloads once, and not again within a minute', () => {
    const reload = vi.fn();
    const store = memory();
    expect(reloadForUpdate(1_000_000, reload, store)).toBe(true);
    expect(reloadForUpdate(1_030_000, reload, store)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForUpdate(1_061_000, reload, store)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

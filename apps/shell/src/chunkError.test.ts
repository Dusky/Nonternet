import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForUpdate, resetServiceWorker } from './chunkError';

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

describe('starting fresh', () => {
  it('removes the service worker and everything it kept', async () => {
    const unregister = vi.fn(async () => true);
    const del = vi.fn(async (_key: string) => true);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } });
    vi.stubGlobal('caches', { keys: async () => ['workbox-precache-v2', 'shell-assets'], delete: del });
    await resetServiceWorker();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del.mock.calls.map((c) => c[0])).toEqual(['workbox-precache-v2', 'shell-assets']);
    vi.unstubAllGlobals();
  });
  it('still finishes in a browser with neither', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('caches', undefined);
    await expect(resetServiceWorker()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});

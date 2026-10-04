// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogApp } from '@app/shared';
import { bridgeFor } from './AppHost';

// The bridge (docs/15) is the only way an added app reaches anything: it does only what the manifest asked for,
// checks what it is given, and keeps the app inside its own data.
const app = (permissions: CatalogApp['permissions']): CatalogApp => ({
  id: 'todo', name: 'Todo', version: '1.0.0', description: 'x', icon: 'M0 0h1v1z', sticker: 1, permissions, url: 'https://h/apps/todo@1.0.0/index.html', installed: true, offered: true,
});
const deps = () => ({
  me: () => ({ id: 'u_1', handle: 'alice', display_name: 'Alice' }),
  setTitle: vi.fn(),
  toast: vi.fn(async () => true),
  refused: 'This app did not ask to do that.',
});
const calls: { url: string; method: string; body?: string }[] = [];
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
function stubFetch(reply: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

describe('the app bridge', () => {
  it('keeps data only for an app that asked for storage, under its own id', async () => {
    stubFetch({ docs: [{ id: 'a', data: 1, updated_at: 'now' }], doc: { id: 'a', data: 1, updated_at: 'now' } });
    const b = bridgeFor(app(['storage']), deps());
    expect(await b.storageList('items')).toEqual([{ id: 'a', data: 1, updated_at: 'now' }]);
    await b.storagePut('items', 'a', { text: 'hi' });
    await b.storageDelete('items', 'a');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/me/apps/todo/data/items', 'PUT /api/v1/me/apps/todo/data/items/a', 'DELETE /api/v1/me/apps/todo/data/items/a',
    ]);
    // A path trick in a name is sent escaped, so it can't climb out of the app's own data.
    await b.storagePut('items', '../../avatar', 1);
    expect(calls.at(-1)!.url).toBe('/api/v1/me/apps/todo/data/items/..%2F..%2Favatar');
  });

  it('refuses what the manifest did not ask for, and odd arguments, in plain words', async () => {
    stubFetch({});
    const b = bridgeFor(app([]), deps());
    await expect(b.storageList('items')).rejects.toThrow('This app did not ask to do that.');
    await expect(b.profileGet()).rejects.toThrow('This app did not ask to do that.');
    const s = bridgeFor(app(['storage']), deps());
    await expect(s.storagePut({ evil: true } as unknown as string, 'a', 1)).rejects.toThrow('This app did not ask to do that.');
    await expect(s.uiSetTitle('x'.repeat(500))).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('gives the profile only with profile:read, and passes notes to the shell', async () => {
    const d = deps();
    const b = bridgeFor(app(['profile:read']), d);
    expect(await b.profileGet()).toEqual({ id: 'u_1', handle: 'alice', display_name: 'Alice' });
    expect(await b.uiToast('Task deleted.', { undo: true, evil: 1 })).toBe(true);
    expect(d.toast).toHaveBeenCalledWith('Task deleted.', { undo: true, error: false });
    await b.uiSetTitle('  2 left ');
    expect(d.setTitle).toHaveBeenCalledWith('2 left');
  });
});

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HomeStore } from './files';

describe('the homepage store', () => {
  const user = 'u_01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const limits = { maxFile: 1 << 20, quota: 1 << 24 };

  it('counts space while uploads are being written, without tripping over their temporary files', async () => {
    const store = new HomeStore(mkdtempSync(join(tmpdir(), 'homes-unit-')));
    const writes = Array.from({ length: 60 }, (_, i) => store.write(user, `f${i}.txt`, Buffer.alloc(1000, 1), limits));
    const looks = Array.from({ length: 60 }, () => store.usage(user));
    await Promise.all([...writes, ...looks]);
    expect(await store.usage(user)).toEqual({ bytes: 60_000, files: 60, hasIndex: false });
  });

  it('never counts a leftover temporary file', async () => {
    const store = new HomeStore(mkdtempSync(join(tmpdir(), 'homes-unit-')));
    mkdirSync(store.dir(user), { recursive: true });
    writeFileSync(join(store.dir(user), 'index.html.1a2b3c4d.part'), 'half a file');
    expect(await store.usage(user)).toEqual({ bytes: 0, files: 0, hasIndex: false });
  });
});

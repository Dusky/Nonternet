// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { loadMe } from './lastUser';

const me = { id: 'u1', handle: 'ada' } as never;

describe('loadMe', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps the last known user when the network fails', async () => {
    expect(await loadMe(async () => me)).toEqual(me);
    expect(await loadMe(async () => { throw new TypeError('Failed to fetch'); })).toEqual(me);
  });
  it('keeps the user through a server error too', async () => {
    await loadMe(async () => me);
    expect(await loadMe(async () => { throw new ApiError(503, 'unavailable', 'down'); })).toEqual(me);
  });
  it('a 401 means signed out, and forgets the user', async () => {
    await loadMe(async () => me);
    expect(await loadMe(async () => { throw new ApiError(401, 'unauthorized', 'no'); })).toBeNull();
    await expect(loadMe(async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('Failed to fetch');
  });
  it('with no user remembered, a network failure is still an error, not "signed out"', async () => {
    await expect(loadMe(async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow();
  });
  it('a clean "nobody" answer forgets the user', async () => {
    await loadMe(async () => me);
    expect(await loadMe(async () => null)).toBeNull();
    await expect(loadMe(async () => { throw new TypeError('x'); })).rejects.toThrow();
  });
});

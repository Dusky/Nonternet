import { afterEach, describe, expect, it, vi } from 'vitest';

const put = vi.fn(() => Promise.resolve({}));
vi.mock('../../api', () => ({
  api: { get: vi.fn(() => Promise.reject(new Error('down'))), put, post: vi.fn(() => Promise.reject(new Error('no'))) },
  ApiError: class extends Error {},
}));

describe('saving client settings', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('never saves the defaults over the account when the saved rules failed to load', async () => {
    vi.useFakeTimers();
    const { useMud } = await import('./store');
    useMud.setState({ loaded: false });
    useMud.getState().remember('look');
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).not.toHaveBeenCalled();
    expect(useMud.getState().saveError).toBe(true);
  });
});

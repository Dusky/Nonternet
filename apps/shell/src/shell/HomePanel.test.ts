import { describe, expect, it } from 'vitest';
import type { Me } from '@app/shared';
import { gettingStarted } from './HomePanel';

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u_1', handle: 'ada', display_name: null, bio: null, theme: null, role: 'user', email: 'a@x.test', email_verified: true,
  totp_enabled: false, recovery_codes_remaining: 0, role_rev: 0, ops: [], limited: false, ...over,
});

describe('getting started', () => {
  it('lists the first steps for someone new, none of them done', () => {
    const steps = gettingStarted({ me: me(), homepageUpdated: false, watchesABoard: false });
    expect(steps.map((s) => s.key)).toEqual(['bio', 'homepage', 'watch', 'twofa']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('asks a guest to confirm their email first', () => {
    expect(gettingStarted({ me: me({ role: 'guest' }), homepageUpdated: false, watchesABoard: false })[0]).toEqual({ key: 'verify', done: false });
  });

  it('ticks off what is already done, from what the person has', () => {
    const steps = gettingStarted({ me: me({ bio: 'Hi.', totp_enabled: true }), homepageUpdated: true, watchesABoard: true });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('does not count a bio of only spaces', () => {
    expect(gettingStarted({ me: me({ bio: '   ' }), homepageUpdated: false, watchesABoard: false }).find((s) => s.key === 'bio')!.done).toBe(false);
  });
});

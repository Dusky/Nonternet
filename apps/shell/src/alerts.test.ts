import { describe, expect, it } from 'vitest';
import { decide, MIN_GAP_MS } from './alerts';

const base = { prefs: { desktop: true, sound: true }, permission: 'granted' as const, looking: false, sinceLastMs: MIN_GAP_MS };

describe('when an alert goes out', () => {
  it('chimes and notifies when the tab is not being looked at', () => {
    expect(decide(base)).toEqual({ chime: true, notify: true });
  });
  it('only chimes when the tab is in front: the badge already says it', () => {
    expect(decide({ ...base, looking: true })).toEqual({ chime: true, notify: false });
  });
  it('does nothing that is switched off, and nothing without permission', () => {
    expect(decide({ ...base, prefs: { desktop: false, sound: false } })).toEqual({ chime: false, notify: false });
    expect(decide({ ...base, permission: 'denied' }).notify).toBe(false);
    expect(decide({ ...base, permission: 'default' }).notify).toBe(false);
    expect(decide({ ...base, permission: 'unsupported' }).notify).toBe(false);
  });
  it('makes a burst one nudge', () => {
    expect(decide({ ...base, sinceLastMs: 500 })).toEqual({ chime: false, notify: false });
  });
});

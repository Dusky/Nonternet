import { describe, expect, it } from 'vitest';
import { diffFields, replayState } from './diff';

describe('audit diffs', () => {
  it('lists what was added, removed and changed, and leaves reasons out', () => {
    expect(diffFields({ role: 'user', handle: 'a' }, { role: 'trusted', reason: 'earned it', ops: ['board:x'] })).toEqual([
      { field: 'handle', before: 'a', after: null, kind: 'removed' },
      { field: 'ops', before: null, after: '["board:x"]', kind: 'added' },
      { field: 'role', before: 'user', after: 'trusted', kind: 'changed' },
    ]);
    expect(diffFields(null, null)).toEqual([]);
  });

  it('builds the state step by step, filling in what came before from the first step that knew it', () => {
    const steps = [
      { before: null, after: { handle: 'a', role: 'user' } },
      { before: { role: 'user' }, after: { role: 'trusted', reason: 'x' } },
      { before: { status: 'active' }, after: { status: 'suspended' } },
    ];
    expect(replayState(steps, 0)).toEqual({ handle: 'a', role: 'user' });
    expect(replayState(steps, 1)).toEqual({ handle: 'a', role: 'trusted' });
    expect(replayState(steps, 2)).toEqual({ handle: 'a', role: 'trusted', status: 'suspended' });
  });
});

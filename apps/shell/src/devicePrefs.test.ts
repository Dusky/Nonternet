// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, parsePrefs, readPrefs, savePrefs } from './devicePrefs';

beforeEach(() => window.localStorage.clear());

describe('device preferences', () => {
  it('start at the defaults, and keep what was saved', () => {
    expect(readPrefs('chat')).toEqual(DEFAULTS.chat);
    savePrefs('chat', { timestamps: false, joinPart: true });
    expect(readPrefs('chat')).toEqual({ timestamps: false, joinPart: true });
    expect(readPrefs('chat')).toBe(readPrefs('chat')); // stable between reads
  });
  it('check every field and ignore junk', () => {
    expect(parsePrefs('boards', '{"view":"sideways","reactions":"yes"}')).toEqual(DEFAULTS.boards);
    expect(parsePrefs('boards', '{"view":"threaded"}')).toEqual({ view: 'threaded', reactions: true });
    expect(parsePrefs('terminal', '{"fontSize":99,"reader":true}')).toEqual({ fontSize: 16, reader: true });
    expect(parsePrefs('terminal', '{"fontSize":20}').fontSize).toBe(20);
    expect(parsePrefs('chat', 'not json')).toEqual(DEFAULTS.chat);
    expect(parsePrefs('chat', 'null')).toEqual(DEFAULTS.chat);
  });
});

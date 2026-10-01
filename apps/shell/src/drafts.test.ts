// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllDrafts, clearDraft, completeMention, loadDraft, mentionAt, saveDraft } from './drafts';

beforeEach(() => window.localStorage.clear());

describe('drafts', () => {
  it('keeps what was typed for that person and place, and gives it back', () => {
    saveDraft('u_1', 'thread:p_1', 'Half a thought');
    expect(loadDraft('u_1', 'thread:p_1')).toBe('Half a thought');
    expect(loadDraft('u_2', 'thread:p_1')).toBe(''); // someone else at this browser sees nothing
    expect(loadDraft('u_1', 'thread:p_2')).toBe('');
  });
  it('forgets an empty draft, a sent one, and everything at logout', () => {
    saveDraft('u_1', 'a', 'words');
    saveDraft('u_1', 'a', '   ');
    expect(loadDraft('u_1', 'a')).toBe('');
    saveDraft('u_1', 'b', 'words');
    clearDraft('u_1', 'b');
    expect(loadDraft('u_1', 'b')).toBe('');
    saveDraft('u_1', 'c', 'words');
    saveDraft('u_2', 'd', 'words');
    clearAllDrafts();
    expect(loadDraft('u_1', 'c')).toBe('');
    expect(loadDraft('u_2', 'd')).toBe('');
  });
  it('lets old drafts go after 30 days, and keeps only the newest 40', () => {
    const day = 86_400_000;
    saveDraft('u_1', 'old', 'x', 1000);
    expect(loadDraft('u_1', 'old', 1000 + 31 * day)).toBe('');
    for (let i = 0; i < 45; i++) saveDraft('u_1', `p${i}`, `t${i}`, 1_000_000 + i);
    expect(loadDraft('u_1', 'p0', 1_000_100)).toBe('');
    expect(loadDraft('u_1', 'p44', 1_000_100)).toBe('t44');
  });
  it('survives junk in storage', () => {
    window.localStorage.setItem('ui:draft:u_1:x', '{nope');
    expect(loadDraft('u_1', 'x')).toBe('');
    window.localStorage.setItem('ui:draft:u_1:y', JSON.stringify({ text: 5, at: 'now' }));
    expect(loadDraft('u_1', 'y')).toBe('');
  });
});

describe('mentions', () => {
  it('finds the @name being typed at the caret', () => {
    expect(mentionAt('hello @li', 9)).toEqual({ start: 6, prefix: 'li' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, prefix: '' });
    expect(mentionAt('(@zed', 5)).toEqual({ start: 1, prefix: 'zed' });
  });
  it('ignores an @ inside a word (an email address) and a caret after a space', () => {
    expect(mentionAt('mail me@example', 15)).toBeNull();
    expect(mentionAt('hello @lin ', 11)).toBeNull();
    expect(mentionAt('no at sign', 5)).toBeNull();
  });
  it('puts the chosen handle in place and moves the caret after it', () => {
    expect(completeMention('hi @li there', 6, 'linnea')).toEqual({ text: 'hi @linnea  there', caret: 11 });
    expect(completeMention('plain', 3, 'x')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { plainPreview } from './MemosApp';

describe('plainPreview', () => {
  it('drops markup characters so button names read as plain words', () => {
    expect(plainPreview('Wired the **new** filter `today`')).toBe('Wired the new filter today');
    expect(plainPreview('See [the notes](https://example.org) and [[Wiki page|that page]]')).toBe('See the notes and that page');
  });
});

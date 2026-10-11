import { describe, expect, it } from 'vitest';
import { en } from '@app/strings';
import { IMPORT_PARTS } from './imports';

// The import screen names each part before and after; a part without its words shows a raw key.
describe('import wording', () => {
  it('has a line for every part, in the preview and in the result', () => {
    const words = en as Record<string, string>;
    for (const p of IMPORT_PARTS) {
      expect(words[`data.import.part.${p}`], `data.import.part.${p}`).toBeTruthy();
      expect(words[`data.import.restored.${p}`], `data.import.restored.${p}`).toBeTruthy();
    }
  });
});

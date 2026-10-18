import { describe, expect, it } from 'vitest';
import { compareRows } from './diffView';

describe('the wiki compare view', () => {
  const page = (n: number, change?: [number, string]) => Array.from({ length: n }, (_, i) => (change && change[0] === i ? change[1] : `Line ${i + 1} of the page.`)).join('\n');
  it('shows a changed line with three lines around it and folds the rest', () => {
    const { rows, added, removed } = compareRows(page(40), page(40, [20, 'Line 21 of the whole page.']));
    expect(added).toBe(1); expect(removed).toBe(1);
    expect(rows[0]).toEqual({ kind: 'gap', lines: 17 });
    expect(rows.filter((r) => r.kind === 'same')).toHaveLength(6);
    expect(rows.at(-1)).toEqual({ kind: 'gap', lines: 16 });
  });
  it('marks only the words that changed in a changed line', () => {
    const { rows } = compareRows('The cat sat on the mat.', 'The dog sat on the mat.');
    const add = rows.find((r) => r.kind === 'added')!;
    expect(add.kind === 'added' && add.pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(['dog']);
  });
  it('lists whole new lines as added', () => {
    const { rows, added } = compareRows('a\nb', 'a\nb\nc\nd');
    expect(added).toBe(2);
    expect(rows.filter((r) => r.kind === 'added').map((r) => r.kind === 'added' && r.text)).toEqual(['c', 'd']);
  });
});

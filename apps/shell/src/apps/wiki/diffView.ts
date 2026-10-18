import { diffLines, diffWordsWithSpace } from 'diff';

// The wiki's compare view (docs/20): changed lines with a few lines of context around them, long unchanged stretches
// folded into one "n unchanged lines" row, and within a changed line the words that changed marked.
export type Piece = { text: string; changed: boolean };
export type DiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'added' | 'removed'; text: string; pieces: Piece[] }
  | { kind: 'gap'; lines: number };

const lines = (v: string) => v.replace(/\n$/, '').split('\n');

export function compareRows(a: string, b: string, context = 3): { rows: DiffRow[]; added: number; removed: number } {
  // Every line ends in a newline, so a last line that gained one isn't shown as changed.
  const end = (s: string) => (s.endsWith('\n') ? s : `${s}\n`);
  const parts = diffLines(end(a), end(b));
  const flat: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p.added && !p.removed) { for (const text of lines(p.value)) flat.push({ kind: 'same', text }); continue; }
    const next = parts[i + 1];
    // A removed block followed by an added one of the same length: line i became line i, so mark the words.
    if (p.removed && next?.added && lines(p.value).length === lines(next.value).length) {
      const old = lines(p.value);
      const neu = lines(next.value);
      const pairs = old.map((o, k) => diffWordsWithSpace(o, neu[k]!));
      pairs.forEach((d) => flat.push({ kind: 'removed', text: d.filter((x) => !x.added).map((x) => x.value).join(''), pieces: d.filter((x) => !x.added).map((x) => ({ text: x.value, changed: !!x.removed })) }));
      pairs.forEach((d) => flat.push({ kind: 'added', text: d.filter((x) => !x.removed).map((x) => x.value).join(''), pieces: d.filter((x) => !x.removed).map((x) => ({ text: x.value, changed: !!x.added })) }));
      removed += old.length; added += neu.length; i++;
      continue;
    }
    for (const text of lines(p.value)) flat.push({ kind: p.added ? 'added' : 'removed', text, pieces: [{ text, changed: true }] });
    if (p.added) added += lines(p.value).length; else removed += lines(p.value).length;
  }
  // Keep `context` unchanged lines around each change; fold the rest.
  const near = flat.map(() => false);
  flat.forEach((r, i) => { if (r.kind !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(flat.length - 1, i + context); k++) near[k] = true; });
  const rows: DiffRow[] = [];
  let run = 0;
  flat.forEach((r, i) => {
    if (near[i]) { if (run) rows.push({ kind: 'gap', lines: run }); run = 0; rows.push(r); } else run++;
  });
  if (run) rows.push({ kind: 'gap', lines: run });
  return { rows, added, removed };
}

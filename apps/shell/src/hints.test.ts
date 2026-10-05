import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@app/strings';

// The interface writing rule (docs/10): a line under a field or heading is for what a person would otherwise get
// wrong, in one plain sentence. Anything longer goes behind a "?" (components/HelpTip) or is cut. This finds every
// string shown as a hint (className="hint" paragraphs and hint={…} on a field) and holds it to a length.
const MAX = 150;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
const shown = new Map<string, string>(); // string key -> where
for (const f of files(__dirname)) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/className="hint[^"]*"[^>]*>\s*\{t\('([\w.]+)'/g)) shown.set(m[1]!, f.slice(__dirname.length + 1));
  for (const m of src.matchAll(/hint=\{t\('([\w.]+)'/g)) shown.set(m[1]!, f.slice(__dirname.length + 1));
}

describe('hints stay short', () => {
  it('finds the hints', () => { expect(shown.size).toBeGreaterThan(60); });

  it(`no hint is longer than ${MAX} characters (longer help goes behind a "?")`, () => {
    const long = [...shown].flatMap(([key, where]) => {
      const text = (en as Record<string, string>)[key] ?? '';
      return text.split('|').filter((v) => v.length > MAX).map((v) => `${key} (${where}): ${v.length} characters`);
    });
    expect(long).toEqual([]);
  });

  it('no hint starts with a restatement like "Keys:" or "Note:"', () => {
    const bad = [...shown.keys()].filter((k) => /^(keys|note|tip)\b[:\s]/i.test((en as Record<string, string>)[k] ?? ''));
    expect(bad).toEqual([]);
  });
});

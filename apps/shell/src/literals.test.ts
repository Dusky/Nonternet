import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Words a person reads belong in packages/strings so the interface can be translated and its voice reviewed in one
// place. This finds English written straight into aria-label, placeholder and title attributes. Syntax examples
// (#channel, key names) are not words and are allowed.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : [];
  });
}
const ALLOWED = new Set(['#channel', '#my-channel', 'https://']);
describe('no English in attributes', () => {
  it('aria-label, placeholder and title use the strings pack', () => {
    const found: string[] = [];
    for (const f of files(__dirname)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(aria-label|placeholder|title)="([^"{}]*[A-Za-z]{3,}[^"{}]*)"/g)) {
        if (!ALLOWED.has(m[2]!)) found.push(`${f.slice(__dirname.length + 1)}: ${m[1]}="${m[2]}"`);
      }
    }
    expect(found).toEqual([]);
  });
});

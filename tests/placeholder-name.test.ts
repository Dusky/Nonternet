import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// CLAUDE.md: the product name and domain are placeholders and must never be hard-coded outside
// config and fixtures. This test learns the current placeholder from the example config, so it
// keeps working after the name changes, and greps our source and built output for it.

const root = join(__dirname, '..');
const EXAMPLE_CONFIG = join(root, 'deploy', 'site.example.yaml');
const config = parse(readFileSync(EXAMPLE_CONFIG, 'utf8')) as { site: { name: string; short_name: string } };
const needles = [...new Set([config.site.name, config.site.short_name].map((n) => n.toLowerCase()))];

// Where the literal name is allowed: the config it lives in, this test, docs and prose.
const ALLOWED = [
  'deploy/site.example.yaml',
  'tests/',
  'docs/',
  'README.md',
  'CLAUDE.md',
  'pnpm-lock.yaml',
];
// What we scan: our own source, deploy files, CI, and any built output.
const SCAN_DIRS = ['apps', 'packages', 'deploy', '.github'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage']);
const TEXT = /\.(ts|tsx|js|cjs|mjs|json|html|css|yaml|yml|md|txt|svg|conf|tmpl|env|example|sh)$|Dockerfile|Caddyfile|compose/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (TEXT.test(name)) yield full;
  }
}

const rel = (p: string) => relative(root, p).split(sep).join('/');
const allowed = (p: string) => ALLOWED.some((a) => (a.endsWith('/') ? rel(p).startsWith(a) : rel(p) === a));

function offenders(files: Iterable<string>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (allowed(file)) continue;
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const needle of needles) if (text.includes(needle)) hits.push(`${rel(file)} contains "${needle}"`);
  }
  return hits;
}

describe('placeholder name', () => {
  it('learns a real placeholder from the example config', () => {
    expect(needles.length).toBeGreaterThan(0);
    expect(needles.every((n) => n.length >= 3)).toBe(true);
  });

  it('does not appear in source, deploy files or CI outside config and fixtures', () => {
    const files = SCAN_DIRS.filter((d) => existsSync(join(root, d))).flatMap((d) => [...walk(join(root, d))]);
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files)).toEqual([]);
  }, 30_000); // reads every source and built file: a cold disk cache can take longer than vitest's 5 seconds

  it('does not appear in built output', () => {
    const builds = ['apps/shell/dist', 'apps/core/dist'].map((d) => join(root, d)).filter(existsSync);
    // CI builds first and sets REQUIRE_BUILD so a missing build can't pass silently.
    if (process.env.REQUIRE_BUILD) expect(builds.length).toBe(2);
    expect(offenders(builds.flatMap((d) => [...walk(d)]))).toEqual([]);
  }, 30_000);

  it('the scanner catches a literal name (self-check)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'placeholder-check-'));
    try {
      const leak = join(dir, 'leak.ts');
      writeFileSync(leak, `export const title = '${config.site.name}';\n`);
      expect(offenders([leak])).toHaveLength(1);
      const clean = join(dir, 'clean.ts');
      writeFileSync(clean, `export const title = 'from config';\n`);
      expect(offenders([clean])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(allowed(EXAMPLE_CONFIG)).toBe(true);
    expect(allowed(join(root, 'apps/core/src/x.ts'))).toBe(false);
  });
});

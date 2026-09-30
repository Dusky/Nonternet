import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The shell's Content-Security-Policy lives in the Caddyfiles (production) and in the Vite config (so the
// end-to-end tests run under it). They must say the same thing, apart from where the preview frame may point.
const root = join(__dirname, '..');
const policyIn = (file: string) => {
  const m = /Content-Security-Policy "([^"]+)"/.exec(readFileSync(join(root, file), 'utf8'));
  return m![1]!.replace(/; frame-src .*$/, '');
};

describe('security headers', () => {
  it('uses one Content-Security-Policy everywhere the shell is served', () => {
    const vite = /export const CSP_BASE = "([^"]+)"/.exec(readFileSync(join(root, 'apps/shell/vite.config.ts'), 'utf8'))![1];
    expect(policyIn('deploy/caddy/Caddyfile.prod')).toBe(vite);
    expect(policyIn('deploy/caddy/Caddyfile')).toBe(vite);
    expect(vite).toContain("script-src 'self'");
    expect(vite).toContain("frame-ancestors 'none'");
    expect(vite).not.toContain('unsafe-eval');
  });

  it('turns on HSTS in production only', () => {
    expect(readFileSync(join(root, 'deploy/caddy/Caddyfile.prod'), 'utf8')).toContain('Strict-Transport-Security');
    expect(readFileSync(join(root, 'deploy/caddy/Caddyfile'), 'utf8')).not.toContain('Strict-Transport-Security');
  });
});

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// `sitectl install` (docs/19) with stand-ins for docker, docker compose and crontab that write down what they were asked.
// The installer container itself is tested in apps/installer; this checks what sitectl does around it.
const root = join(__dirname, '..');
let dir: string, deploy: string, bin: string, calls: string;

function run(...args: string[]) {
  return spawnSync('bash', [join(deploy, 'sitectl'), 'install', ...args], {
    cwd: deploy, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SITECTL_COMPOSE: `bash ${join(bin, 'fake-compose')}`, FAKE_DIR: dir },
  });
}
const log = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []);

describe('sitectl install', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sitectl-install-'));
    deploy = join(dir, 'deploy');
    bin = join(dir, 'bin');
    calls = join(dir, 'calls');
    mkdirSync(deploy); mkdirSync(bin);
    copyFileSync(join(root, 'deploy/sitectl'), join(deploy, 'sitectl'));
    // docker: `run` plays the installer by writing the steps it was told to; everything else just logs.
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/calls"
if [ "$1" = run ] && [ -f "$FAKE_DIR/steps" ] && [[ " $* " != *" --dry-run "* ]]; then mkdir -p install; cp "$FAKE_DIR/steps" install/steps; echo "https://example.test/setup#t" > install/setup-url; echo "0 3 * * * ./sitectl backup" > install/crontab; fi
exit 0
`, { mode: 0o755 });
    writeFileSync(join(bin, 'fake-compose'), `echo "compose $*" >> "$FAKE_DIR/calls"; [ "$*" = "exec -T core node cli.cjs has-admin" ] && exit 1; exit 0\n`);
    writeFileSync(join(bin, 'crontab'), `#!/usr/bin/env bash
if [ "$1" = -l ]; then cat "$FAKE_DIR/crontab" 2>/dev/null || exit 1; else cat > "$FAKE_DIR/crontab"; fi
`, { mode: 0o755 });
  });

  it('a dry run builds and runs the installer as this user with this folder, then stops', () => {
    writeFileSync(join(dir, 'steps'), 'up\n');
    const r = run('--dry-run');
    expect(r.status).toBe(0);
    const runLine = log().find((l) => l.startsWith('docker run'))!;
    expect(runLine).toContain('--network host');
    expect(runLine).toContain(`--user ${process.getuid!()}:${process.getgid!()}`);
    expect(runLine).toContain(`-v ${deploy}:/deploy`);
    expect(runLine).toContain(`HOST_DEPLOY_DIR=${deploy}`);
    expect(runLine).toMatch(/site-installer --dry-run$/);
    expect(log().some((l) => l.startsWith('compose up'))).toBe(false);
  });

  it('runs the steps in order, keeps one cron block across runs, and prints the setup link', () => {
    writeFileSync(join(dir, 'crontab'), '0 1 * * * echo mine\n');
    writeFileSync(join(dir, 'steps'), 'cron\nup\nwiki-starter\ndemo\n');
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    const compose = log().filter((l) => l.startsWith('compose') && !l.includes('has-admin'));
    expect(compose).toEqual(['compose up -d --build --wait', 'compose exec -T core node cli.cjs seed-demo']);
    expect(r.stdout).toContain('https://example.test/setup#t');
    run();
    const tab = readFileSync(join(dir, 'crontab'), 'utf8');
    expect(tab.match(/>>> site install/g)).toHaveLength(1);
    expect(tab).toContain('echo mine');
    expect(tab).toContain('./sitectl backup');
  });

  it('passes an answers file in the folder by its path inside the container, and refuses one outside', () => {
    writeFileSync(join(deploy, 'answers.yaml'), 'profile: small\n');
    run('--answers', 'answers.yaml', '--dry-run');
    expect(log().find((l) => l.startsWith('docker run'))).toContain('--answers /deploy/answers.yaml');
    writeFileSync(join(dir, 'outside.yaml'), 'profile: small\n');
    const r = run('--answers', join(dir, 'outside.yaml'));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('can only see this folder');
  });

  it('backup-copy says plainly when no off-site copy is set up', () => {
    writeFileSync(join(deploy, '.env'), 'SITE_DOMAIN=example.test\n');
    const r = spawnSync('bash', [join(deploy, 'sitectl'), 'backup-copy'], { cwd: deploy, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('No off-site copy');
  });
});

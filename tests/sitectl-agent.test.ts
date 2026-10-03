import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// `sitectl agent` (docs/19), run for real against a throwaway git repository, with a stand-in for `docker compose` that only
// writes down what it was asked to do. The point: only the fixed actions run, and nothing in a request becomes a command.
const root = join(__dirname, '..');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

let dir: string, deploy: string, ops: string, calls: string;
const id = (n: number) => `op_01J00000000000000000000${String(n).padStart(3, '0')}`;
const request = (n: number, body: string) => { mkdirSync(join(ops, 'requests'), { recursive: true }); writeFileSync(join(ops, 'requests', `${id(n)}.req`), body); };
const kv = (file: string) => Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const runAgent = () => execFileSync('bash', [join(deploy, 'sitectl'), 'agent', '--once'], {
  cwd: deploy, encoding: 'utf8',
  env: { ...process.env, SITECTL_OPS_DIR: ops, SITECTL_COMPOSE: `bash ${join(dir, 'fake-compose')}` },
});

describe('sitectl agent', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sitectl-'));
    // An "origin" with one commit the server doesn't have yet.
    const origin = join(dir, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    writeFileSync(join(origin, 'a.txt'), 'one');
    git(origin, 'add', '.');
    git(origin, 'commit', '-q', '-m', 'First version');
    const repo = join(dir, 'repo');
    git(dir, 'clone', '-q', origin, repo);
    writeFileSync(join(origin, 'a.txt'), 'two');
    git(origin, 'commit', '-q', '-am', 'Fix the thing; and more');
    deploy = join(repo, 'deploy');
    mkdirSync(deploy);
    copyFileSync(join(root, 'deploy/sitectl'), join(deploy, 'sitectl'));
    ops = join(deploy, 'ops');
    calls = join(dir, 'calls');
    writeFileSync(join(dir, 'fake-compose'), `echo "$*" >> ${calls}\n`);
  });

  it('beats, and looks for updates: the commits waiting on origin', () => {
    runAgent();
    expect(Number(kv(join(ops, 'agent')).at)).toBeGreaterThan(0);
    const v = kv(join(ops, 'version'));
    expect(v).toMatchObject({ branch: 'main', behind: '1', subject: 'First version' });
    expect(v.pending_1).toMatch(/^[0-9a-f]{12} Fix the thing; and more$/);
  });

  it('restarts a known service, keeps its state and log, and refuses anything else without running it', () => {
    request(1, 'action=restart\nservice=bbs\nby=ada\nrequested_at=1700000000\n');
    request(2, 'action=restart\nservice=bbs; touch /tmp/pwned\nby=ada\nrequested_at=1700000001\n');
    request(3, 'action=rm -rf\nservice=\nby=ada\n');
    request(4, 'action=restart\nservice=postgres\nby=ada\n'); // not on the list: the database is never restarted from the web
    runAgent();
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['restart bbs', 'up -d --wait bbs']);
    expect(kv(join(ops, 'jobs', `${id(1)}.state`))).toMatchObject({ action: 'restart', service: 'bbs', by: 'ada', state: 'done', requested_at: '1700000000' });
    expect(readFileSync(join(ops, 'jobs', `${id(1)}.log`), 'utf8')).toContain('== done');
    for (const n of [2, 3, 4]) {
      expect(kv(join(ops, 'jobs', `${id(n)}.state`)).state).toBe('failed');
      expect(readFileSync(join(ops, 'jobs', `${id(n)}.log`), 'utf8')).toContain('Refused');
    }
    expect(existsSync('/tmp/pwned')).toBe(false);
    expect(existsSync(join(ops, 'requests', `${id(1)}.req`))).toBe(false); // taken
  });

  it('marks a job failed when its command fails', () => {
    writeFileSync(join(dir, 'fake-compose'), 'exit 3\n');
    request(5, 'action=restart\nservice=all\nby=ada\n');
    runAgent();
    expect(kv(join(ops, 'jobs', `${id(5)}.state`)).state).toBe('failed');
  });
});

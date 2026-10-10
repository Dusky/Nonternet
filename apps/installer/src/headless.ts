import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { answersSchema, PROFILE_TEXT, servicesFor, type Answers } from './answers';
import { changes, readExisting, writePlan } from './apply';
import { runChecks, worst, type Probes } from './checks';
import { plan as makePlan, type Plan } from './generate';
import type { Random } from './secrets';

// `./sitectl install --answers answers.yaml [--dry-run] [--force]`: the same install as the wizard, with no questions.
export interface HeadlessOpts { answersFile: string; deployDir: string; hostDeployDir: string; dryRun: boolean; force: boolean; skipChecks: boolean }
type Out = (line: string) => void;

export async function loadAnswers(file: string): Promise<Answers> {
  const raw = parse(await fs.readFile(file, 'utf8')) as unknown;
  const r = answersSchema.safeParse(raw);
  if (!r.success) throw new Error(`The answers file has problems:\n${r.error.issues.map((i) => `  ${i.path.join('.') || '(top)'}: ${i.message}`).join('\n')}`);
  return r.data;
}

export async function headless(o: HeadlessOpts, probes: Probes, rand: Random, out: Out): Promise<number> {
  let answers: Answers;
  try { answers = await loadAnswers(o.answersFile); } catch (e) { out((e as Error).message); return 2; }
  const existing = await readExisting(o.deployDir);
  const reinstall = existing.env !== undefined;
  out(`${reinstall ? 'Changing the settings of' : 'Installing'} ${answers.site.name} (${PROFILE_TEXT[answers.profile].title})`);
  out(`Services: ${Object.entries(servicesFor(answers)).filter(([, on]) => on).map(([k]) => k).join(', ') || 'web only'}`);
  if (!o.skipChecks) {
    const checks = await runChecks(answers, probes, { reinstall });
    for (const c of checks) out(`  ${c.level === 'ok' ? 'ok  ' : c.level === 'warn' ? 'warn' : 'FAIL'}  ${c.text}`);
    if (worst(checks) === 'fail' && !o.force) { out('Some checks failed. Fix them, or run again with --force to install anyway.'); return 1; }
  }
  let p: Plan;
  try { p = makePlan(answers, existing, rand, o.hostDeployDir); } catch (e) { out((e as Error).message); return 2; }
  const ch = await changes(o.deployDir, p);
  for (const c of ch) out(`${c.kind === 'same' ? '  unchanged' : c.kind === 'new' ? '  new      ' : '  changed  '}  ${c.path}  (${c.why})`);
  if (o.dryRun) {
    for (const c of ch) if (c.patch) out(c.patch);
    out(`Then sitectl would: ${p.steps.join(', ')}.`);
    out('Dry run: nothing was written.');
    return 0;
  }
  await writePlan(o.deployDir, p);
  await fs.writeFile(join(o.deployDir, 'install', 'answers.used.yaml'), await fs.readFile(o.answersFile, 'utf8'), { mode: 0o600 });
  summary(p, out);
  return 0;
}

export function summary(p: Plan, out: Out): void {
  if (p.made.length) out(`Made these secrets: ${p.made.join(', ')}. They are in .env. Keep a copy of APP_SECRET_KEY and BACKUP_KEY somewhere other than this server.`);
  out('DNS records the site needs:');
  for (const r of p.dns) out(`  ${r.name}  ${r.type}  ${r.value}`);
  out(`Ports to open: ${p.ports.map((x) => `${x.port} (${x.what})`).join(', ')}`);
  for (const w of p.warnings) out(`Note: ${w}`);
  if (p.setupUrl) out(`When the site is up, make the first admin here (works once): ${p.setupUrl}`);
}

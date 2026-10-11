import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { stringify } from 'yaml';
import { answersSchema, PROFILE_TEXT, PROFILES, SERVICE_NAMES, portsFor, servicesFor, type Answers, type AnswersInput, type Profile, type ServiceName } from '../answers';
import { changes, writePlan, type Change } from '../apply';
import { runChecks, worst, type Check, type Probes } from '../checks';
import { plan as makePlan, type Existing, type Plan } from '../generate';
import { envGet } from '../envfile';
import type { Random } from '../secrets';
import { ACCENT, Banner, Choice, Frame, TextField, Toggles } from './ui';

// The full-screen install wizard (docs/19). Each step fills part of the answers; nothing is written until the review step,
// and the same engine as the headless mode does the work, so what the wizard shows is exactly what gets written.

export interface WizardProps {
  deployDir: string; hostDeployDir: string; probes: Probes; rand: Random; existing: Existing;
  previous?: unknown;               // the answers of the last install, for a re-run (checked before use)
  dryRun?: boolean;
  onDone: (code: number) => void;
}

type StepId = 'welcome' | 'profile' | 'services' | 'site' | 'people' | 'mail' | 'admin' | 'backups' | 'extras' | 'checks' | 'review' | 'secrets' | 'done';
interface Draft {
  profile: Profile; services: Record<ServiceName, boolean>;
  name: string; short_name: string; domain: string; homes_domain: string;
  signup: 'open' | 'invite' | 'application'; minimum_age: string; homepage_quota_mb: string; file_quota_mb: string;
  smtp_url: string; from: string; admin: 'web' | 'cli';
  backups: 'local' | 'rsync' | 's3'; rsync_target: string; s3_endpoint: string; s3_bucket: string; keep_days: string;
  extras: Record<'agent' | 'wiki_starter' | 'demo' | 'firewall' | 'unattended_upgrades' | 'fail2ban', boolean>;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20);

function fromPrevious(p?: unknown): Draft {
  const a = p ? answersSchema.safeParse(p) : null;
  const v: Answers | null = a?.success ? a.data : null;
  return {
    profile: v?.profile ?? 'web-chat',
    services: v ? servicesFor(v) : { irc: true, bbs: false, mud: false, gopher: false, finger: false, gemini: false },
    name: v?.site.name ?? '', short_name: v?.site.short_name ?? '', domain: v?.site.domain ?? '', homes_domain: v?.site.homes_domain ?? '',
    signup: v?.signup.mode ?? 'invite', minimum_age: String(v?.signup.minimum_age ?? 16),
    homepage_quota_mb: String(v?.limits.homepage_quota_mb ?? 50), file_quota_mb: String(v?.limits.file_quota_mb ?? 250),
    smtp_url: v?.mail.smtp_url ?? '', from: v?.mail.from ?? '', admin: v?.admin.via ?? 'web',
    backups: v?.backups.to ?? 'local', rsync_target: v?.backups.rsync_target ?? '', s3_endpoint: v?.backups.s3?.endpoint ?? '', s3_bucket: v?.backups.s3?.bucket ?? '',
    keep_days: String(v?.backups.keep_days ?? 30),
    extras: { agent: v?.extras.agent ?? true, wiki_starter: v?.extras.wiki_starter ?? true, demo: v?.extras.demo ?? false, firewall: v?.extras.firewall ?? false, unattended_upgrades: v?.extras.unattended_upgrades ?? false, fail2ban: v?.extras.fail2ban ?? false },
  };
}

export function toAnswers(d: Draft): AnswersInput {
  return {
    profile: d.profile, services: d.profile === 'custom' ? d.services : {},
    site: { name: d.name, short_name: d.short_name || slug(d.name), domain: d.domain, homes_domain: d.homes_domain },
    signup: { mode: d.signup, minimum_age: Number(d.minimum_age) },
    limits: { homepage_quota_mb: Number(d.homepage_quota_mb), file_quota_mb: Number(d.file_quota_mb) },
    mail: { smtp_url: d.smtp_url, from: d.from }, admin: { via: d.admin },
    backups: { to: d.backups, ...(d.backups === 'rsync' ? { rsync_target: d.rsync_target } : {}), ...(d.backups === 's3' ? { s3: { endpoint: d.s3_endpoint, bucket: d.s3_bucket } } : {}), keep_days: Number(d.keep_days) },
    extras: d.extras,
  };
}

// The errors that belong to one step, by field name.
function stepErrors(step: StepId, d: Draft): Record<string, string> {
  const r = answersSchema.safeParse(toAnswers(d));
  if (r.success) return {};
  const prefix: Partial<Record<StepId, string[]>> = { site: ['site'], people: ['signup', 'limits'], mail: ['mail'], backups: ['backups'] };
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    if (!prefix[step]?.includes(String(i.path[0]))) continue;
    const field = String(i.path[i.path.length - 1] ?? i.path[0]);
    out[field] ??= i.message;
  }
  return out;
}

const SERVICE_TEXT: Record<ServiceName, string> = { irc: 'Chat (IRC)', bbs: 'BBS (telnet, SSH)', mud: 'MUD', gopher: 'Gopher mirror', finger: 'finger', gemini: 'Gemini mirror' };
const EXTRA_TEXT = {
  agent: ['Updates from the console', 'update and restart from the admin console'],
  wiki_starter: ['Wiki starter pages', 'a few help pages to edit'],
  demo: ['Demo content', 'made-up people and posts: staging only'],
  firewall: ['Firewall (ufw)', 'only this site’s ports, plus SSH'],
  unattended_upgrades: ['Automatic security updates', 'unattended-upgrades'],
  fail2ban: ['fail2ban', 'slows down password guessing on SSH'],
} as const;

export function Wizard(p: WizardProps) {
  const { exit } = useApp();
  const [d, setD] = useState<Draft>(() => fromPrevious(p.previous));
  const [step, setStep] = useState<StepId>('welcome');
  const [focus, setFocus] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [planned, setPlanned] = useState<{ plan: Plan; changes: Change[] } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [saved, setSaved] = useState('');
  const [writing, setWriting] = useState(false);
  const reinstall = p.existing.env !== undefined;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const steps = useMemo<StepId[]>(() => ['welcome', 'profile', ...(d.profile === 'custom' ? ['services' as const] : []), 'site', 'people', 'mail', 'admin', 'backups', 'extras', 'checks', 'review', 'secrets', 'done'], [d.profile]);
  const index = steps.indexOf(step);
  const finish = (code: number) => { p.onDone(code); exit(); };
  const go = (to: StepId) => { setStep(to); setFocus(0); setErrors({}); };
  const next = () => {
    const e = stepErrors(step, d);
    if (Object.keys(e).length) { setErrors(e); return; }
    go(steps[index + 1]!);
  };
  const back = () => { if (index > 0 && step !== 'secrets' && step !== 'done') go(steps[index - 1]!); };

  // The checks run when their step opens; the plan is made when the review opens.
  useEffect(() => {
    if (step === 'checks') { setChecks(null); void runChecks(answersSchema.parse(toAnswers(d)), p.probes, { reinstall }).then(setChecks); }
    if (step === 'review') {
      setPlanned(null); setPlanError(null);
      try {
        const pl = makePlan(answersSchema.parse(toAnswers(d)), p.existing, p.rand, p.hostDeployDir);
        void changes(p.deployDir, pl).then((c) => setPlanned({ plan: pl, changes: c }));
      } catch (e) { setPlanError((e as Error).message); }
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldsOn: Partial<Record<StepId, number>> = { site: 4, people: 4, mail: 2, backups: d.backups === 'rsync' ? 2 : d.backups === 's3' ? 3 : 1 };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') return finish(130);
    if (step === 'secrets') {
      if (key.return && saved.trim().toLowerCase() === 'saved') go('done');
      return;
    }
    if (step === 'done') { if (key.return) finish(0); return; }
    if (key.escape) return back();
    const n = fieldsOn[step];
    if (n && (key.tab || key.downArrow) && !(step === 'backups' && focus === 0 && key.downArrow)) { setFocus((f) => (f + 1) % n); return; }
    if (n && key.upArrow && !(step === 'backups' && focus === 0)) { setFocus((f) => (f - 1 + n) % n); return; }
    if (step === 'checks' && checks && worst(checks) === 'fail' && (input === 'f' || input === 'F')) return go('review');
    if (step === 'review' && (input === 'd' || input === 'D')) { setShowDiff((s) => !s); return; }
    if (key.return) {
      if (step === 'checks') { if (checks && worst(checks) !== 'fail') next(); return; }
      if (step === 'review') {
        if (!planned || writing) return;
        if (p.dryRun) return finish(0);
        setWriting(true);
        void (async () => {
          await writePlan(p.deployDir, planned.plan);
          const { mkdir, writeFile } = await import('node:fs/promises');
          await mkdir(`${p.deployDir}/install`, { recursive: true });
          await writeFile(`${p.deployDir}/install/answers.used.yaml`, stringify(toAnswers(d)), { mode: 0o600 });
          setWriting(false);
          go(planned.plan.made.some((k) => k === 'APP_SECRET_KEY' || k === 'BACKUP_KEY') ? 'secrets' : 'done');
        })();
        return;
      }
      next();
    }
  });

  const total = steps.length;
  const frame = (title: string, keys: string, body: ReactElement) => <Frame step={index + 1} total={total} title={title} keys={keys}>{body}</Frame>;
  const formKeys = 'Tab or ↑↓ move · type to fill in · Enter next · Esc back';
  const env = planned ? planned.plan.files.find((f) => f.path === '.env')?.content ?? '' : '';

  switch (step) {
    case 'welcome': return frame(reinstall ? 'Change this site’s settings' : 'Install', 'Enter start · Ctrl+C leave', (
      <Box flexDirection="column">
        <Banner text={d.name || 'hello'} />
        <Text> </Text>
        <Text>{reinstall ? 'This site is already installed. You can change its settings here: secrets stay as they are, and every file that changes is saved first.' : 'This sets up the site on this server: its config, its secrets, backups, and the first admin.'}</Text>
        <Text dimColor>Nothing is written until the review step. Every choice can be changed later by running the installer again.</Text>
        {p.dryRun && <Text color="yellow">Dry run: you can go through every step, but nothing will be written.</Text>}
      </Box>
    ));
    case 'profile': return frame('What should this site run?', '↑↓ choose · Enter next · Esc back', (
      <Choice options={PROFILES.map((v) => ({ value: v, title: PROFILE_TEXT[v].title, about: PROFILE_TEXT[v].about }))} value={d.profile} onChange={(v) => set('profile', v)} focus />
    ));
    case 'services': return frame('Choose the services', '↑↓ move · Space turn on or off · Enter next · Esc back', (
      <Box flexDirection="column">
        <Text dimColor>The web is always on. Each of these adds a port and a little memory.</Text>
        <Toggles items={SERVICE_NAMES.map((k) => ({ key: k, title: SERVICE_TEXT[k] }))} values={d.services} onChange={(k, on) => set('services', { ...d.services, [k]: on })} focus />
      </Box>
    ));
    case 'site': return frame('Name and addresses', formKeys, (
      <Box flexDirection="column">
        <TextField label="Site name" value={d.name} onChange={(v) => setD((x) => ({ ...x, name: v, short_name: x.short_name && x.short_name !== slug(x.name) ? x.short_name : slug(v) }))} focus={focus === 0} error={errors.name} />
        <TextField label="Short name" value={d.short_name} onChange={(v) => set('short_name', v)} focus={focus === 1} placeholder="for addresses and mail" error={errors.short_name} />
        <TextField label="Domain" value={d.domain} onChange={(v) => set('domain', v.trim().toLowerCase())} focus={focus === 2} placeholder="example.net" error={errors.domain} />
        <TextField label="Homepage domain" value={d.homes_domain} onChange={(v) => set('homes_domain', v.trim().toLowerCase())} focus={focus === 3} placeholder="a separate domain" error={errors.homes_domain} />
        <Text dimColor>People's homepages live at handle.homepage-domain. It must be a domain of its own, so their pages can't reach the site.</Text>
      </Box>
    ));
    case 'people': return frame('Who can join, and how much room', formKeys, (
      <Box flexDirection="column">
        <TextField label="Sign-up (open/invite/application)" value={d.signup} onChange={(v) => { const m = (['open', 'invite', 'application'] as const).find((x) => x.startsWith(v.trim().toLowerCase().slice(0, 1))) ?? d.signup; set('signup', v ? m : d.signup); }} focus={focus === 0} error={errors.mode} />
        <TextField label="Minimum age (0: don't ask)" value={d.minimum_age} onChange={(v) => set('minimum_age', v.replace(/\D/g, '').slice(0, 3))} focus={focus === 1} error={errors.minimum_age} />
        <TextField label="Homepage space (MB)" value={d.homepage_quota_mb} onChange={(v) => set('homepage_quota_mb', v.replace(/\D/g, '').slice(0, 6))} focus={focus === 2} error={errors.homepage_quota_mb} />
        <TextField label="File space each (MB)" value={d.file_quota_mb} onChange={(v) => set('file_quota_mb', v.replace(/\D/g, '').slice(0, 7))} focus={focus === 3} error={errors.file_quota_mb} />
        <Text dimColor>{`Sign-up is ${d.signup}: type o, i or a to switch. Trusted people get twice the homepage space.`}</Text>
      </Box>
    ));
    case 'mail': return frame('Outgoing mail', formKeys, (
      <Box flexDirection="column">
        <TextField label="SMTP address" value={d.smtp_url} onChange={(v) => set('smtp_url', v.trim())} focus={focus === 0} secret={d.smtp_url.includes('@') && focus !== 0} placeholder="smtp://user:pass@host:587" error={errors.smtp_url} />
        <TextField label="Send as" value={d.from} onChange={(v) => set('from', v.trim())} focus={focus === 1} placeholder="no-reply@example.net" error={errors.from} />
        <Text dimColor>Sign-up confirmations and password resets go out this way. Many hosts block port 25, so a mail service on 587 or 465 is safest.</Text>
      </Box>
    ));
    case 'admin': return frame('The first admin', '↑↓ choose · Enter next · Esc back', (
      <Choice options={[
        { value: 'web' as const, title: 'In the browser', about: 'The installer prints a one-off link. Open it, make the admin account, and you are signed in. It works once.' },
        { value: 'cli' as const, title: 'Here in the terminal', about: 'sitectl asks for a handle, email and password at the end.' },
      ]} value={d.admin} onChange={(v) => set('admin', v)} focus />
    ));
    case 'backups': return frame('Backups', 'Tab move · ↑↓ choose where · Enter next · Esc back', (
      <Box flexDirection="column">
        <Choice options={[
          { value: 'local' as const, title: 'On this server only', about: 'Fine to start, but a dead disk takes the backups with it.' },
          { value: 'rsync' as const, title: 'Copied to another machine (rsync over SSH)' },
          { value: 's3' as const, title: 'Copied to object storage (S3-compatible)' },
        ]} value={d.backups} onChange={(v) => set('backups', v)} focus={focus === 0} />
        {d.backups === 'rsync' && <TextField label="Copy to" value={d.rsync_target} onChange={(v) => set('rsync_target', v.trim())} focus={focus === 1} placeholder="backup@other-host:/srv/backups" error={errors.rsync_target} />}
        {d.backups === 's3' && <>
          <TextField label="Endpoint" value={d.s3_endpoint} onChange={(v) => set('s3_endpoint', v.trim())} focus={focus === 1} placeholder="https://s3.example.net" error={errors.endpoint ?? errors.s3} />
          <TextField label="Bucket" value={d.s3_bucket} onChange={(v) => set('s3_bucket', v.trim())} focus={focus === 2} error={errors.bucket} />
          <Text dimColor>Put the storage keys in .env afterwards (BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY).</Text>
        </>}
        <Text dimColor>{`Backups are encrypted and kept for ${d.keep_days} days. A restore test runs every month.`}</Text>
      </Box>
    ));
    case 'extras': return frame('Extras', '↑↓ move · Space turn on or off · Enter next · Esc back', (
      <Toggles items={(Object.keys(EXTRA_TEXT) as (keyof typeof EXTRA_TEXT)[]).map((k) => ({ key: k, title: EXTRA_TEXT[k][0], about: EXTRA_TEXT[k][1] }))} values={d.extras} onChange={(k, on) => set('extras', { ...d.extras, [k]: on })} focus />
    ));
    case 'checks': return frame('Checking this server', checks && worst(checks) === 'fail' ? 'F install anyway · Esc back and fix' : 'Enter next · Esc back', (
      <Box flexDirection="column">
        {!checks && <Text>Looking at the machine, the ports, DNS and mail…</Text>}
        {checks?.map((c) => <Text key={c.id} color={c.level === 'ok' ? 'green' : c.level === 'warn' ? 'yellow' : 'red'}>{`${c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'} ${c.text}`}</Text>)}
        {checks && worst(checks) === 'warn' && <Text dimColor>Warnings don't stop the install. DNS can be fixed later; certificates arrive once it points here.</Text>}
      </Box>
    ));
    case 'review': return frame(p.dryRun ? 'What would change (dry run)' : 'Ready to write', `${p.dryRun ? 'Enter leave' : writing ? 'Writing…' : 'Enter write it'} · D ${showDiff ? 'hide' : 'show'} the changes · Esc back`, (
      <Box flexDirection="column">
        {planError && <Text color="red">{planError}</Text>}
        {!planned && !planError && <Text>Working it out…</Text>}
        {planned && <>
          {planned.changes.map((c) => <Text key={c.path}>{`${c.kind === 'new' ? '+ new     ' : c.kind === 'changed' ? '~ changed ' : '  same    '} ${c.path}`}<Text dimColor>{`  ${c.why}`}</Text></Text>)}
          <Text> </Text>
          <Text>{`Then: ${planned.plan.steps.join(' → ')}`}</Text>
          <Text>{`Ports: ${portsFor(servicesFor(answersSchema.parse(toAnswers(d))), 2222).map((x) => x.port).join(', ')}`}</Text>
          {planned.plan.warnings.map((w) => <Text key={w} color="yellow">{`! ${w}`}</Text>)}
          {showDiff && planned.changes.filter((c) => c.patch).map((c) => <Text key={`d${c.path}`} dimColor>{c.patch.split('\n').slice(0, 40).join('\n')}</Text>)}
        </>}
      </Box>
    ));
    case 'secrets': return frame('Keep a copy of these', 'type saved, then Enter', (
      <Box flexDirection="column">
        <Text>These two keys can't be made again. Without them, backups can't be read and admins lose two-factor. Copy them somewhere other than this server (a password manager is ideal).</Text>
        <Text> </Text>
        <Text color={ACCENT}>{`APP_SECRET_KEY=${envGet(env, 'APP_SECRET_KEY') ?? ''}`}</Text>
        <Text color={ACCENT}>{`BACKUP_KEY=${envGet(env, 'BACKUP_KEY') ?? ''}`}</Text>
        <Text> </Text>
        <TextField label="Type saved" value={saved} onChange={setSaved} focus />
      </Box>
    ));
    case 'done': {
      const pl = planned!.plan;
      return frame('Written', 'Enter finish', (
        <Box flexDirection="column">
          <Banner text={d.name} />
          <Text> </Text>
          <Text>{`The files are in place. sitectl now carries on: ${pl.steps.join(', ')}.`}</Text>
          <Text bold>DNS records</Text>
          {pl.dns.map((r) => <Text key={r.name}>{`  ${r.name}  ${r.type}  ${r.value}`}</Text>)}
          <Text bold>Ports</Text>
          <Text>{`  ${pl.ports.map((x) => `${x.port} ${x.what}`).join(' · ')}`}</Text>
          {pl.setupUrl && <><Text bold>The first admin</Text><Text>  Once the site is up, open the link printed below when you press Enter. It works once.</Text></>}
        </Box>
      ));
    }
  }
}

import { z } from 'zod';
import { APPLICATION_MAX, APPLICATION_MIN, handleSchema, passwordSchema } from '@app/shared';
import { CoreError, type LoginResult } from '../core';
import type { Session } from '../session';
import { page } from './pager';

// Signing up from the terminal (docs/04). The same rules as the website: sign-up mode, invite, age, handle,
// email and password. The terminal password is set at the same time and must differ from the website one,
// because telnet sends what you type in the clear. The email's code confirms the account, and the caller is
// signed in straight away. Leaving at any prompt (Escape) stops without creating anything not yet sent.
interface Site { signup_mode: 'open' | 'invite' | 'application'; minimum_age: number }
const emailSchema = z.string().trim().email().max(254);
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export async function signUp(s: Session): Promise<LoginResult | null> {
  const t = s.term;
  s.at('Signing up');
  const site = await s.ctx.core.publicGet<Site>('/site');
  t.line('\n\x1b[1mNew account\x1b[0m');
  if (s.via === 'telnet') t.line(dim('What you type over telnet is not encrypted. If that matters to you, sign up over SSH or on the website instead.'));
  t.line(dim('Press Escape at any prompt to stop.'));

  const ask = async (label: string, opts: { mask?: boolean; max?: number } = {}): Promise<string | null> => {
    t.write(`${label}: `);
    const v = await t.readLine({ max: opts.max ?? 200, mask: opts.mask });
    return v === null ? null : opts.mask ? v : v.trim();
  };
  const yesNo = async (q: string): Promise<boolean | null> => {
    t.write(`${q} [Y/N] `);
    const k = await t.choose('yn');
    if (k === null) return null;
    t.line(k === 'y' ? 'Yes' : 'No');
    return k === 'y';
  };

  // The terms, as plain text.
  const show = await yesNo('Read the terms of service first?');
  if (show === null) return null;
  if (show) {
    const terms = await s.ctx.core.publicGet<{ title: string; body: string }>('/legal/terms').catch(() => null);
    if (terms) await page(s, [`\x1b[1m${terms.title}\x1b[0m`, ...terms.body.replace(/^#+\s*/gm, '').split('\n')]);
  }
  const agree = await yesNo('Do you agree to the terms of service and the privacy policy?');
  if (!agree) { if (agree === false) t.line(`You need to agree to them to have an account. They are at ${s.ctx.siteUrl}/legal/terms.`); return null; }
  if (site.minimum_age > 0) {
    const old = await yesNo(`Are you at least ${site.minimum_age} years old?`);
    if (!old) { if (old === false) t.line(`Sorry, you need to be at least ${site.minimum_age} to have an account here.`); return null; }
  }

  const f = { invite: '', handle: '', email: '', password: '', terminal: '', application: '' };
  const askInvite = async () => { for (;;) { const v = await ask('Invite code'); if (v === null) return false; if (v) { f.invite = v; return true; } t.line('This site is invite only. Ask someone who is already here for a code.'); } };
  const askHandle = async () => {
    for (;;) {
      const v = await ask('Handle (your name here)', { max: 40 });
      if (v === null) return false;
      const ok = handleSchema.safeParse(v.replace(/^@/, ''));
      if (ok.success) { f.handle = ok.data; return true; }
      t.line(red('A handle is 2 to 20 letters, digits, _ or -, starting with a letter.'));
    }
  };
  // Sign-up by application (docs/02): a few sentences for the admins, on one line.
  const askApplication = async () => {
    t.line(dim('The admins read every application. Tell them in a few sentences what you would like to do here.'));
    for (;;) {
      const v = await ask('Why do you want to join?', { max: APPLICATION_MAX });
      if (v === null) return false;
      if (v.length >= APPLICATION_MIN) { f.application = v; return true; }
      t.line(red(`Say a little more: at least ${APPLICATION_MIN} characters.`));
    }
  };
  const askEmail = async () => {
    for (;;) {
      const v = await ask('Email address');
      if (v === null) return false;
      if (emailSchema.safeParse(v).success) { f.email = v; return true; }
      t.line(red('That does not look like an email address.'));
    }
  };
  const askPassword = async (label: string, key: 'password' | 'terminal') => {
    for (;;) {
      const a = await ask(label, { mask: true });
      if (a === null) return false;
      if (!passwordSchema.safeParse(a).success) { t.line(red('Use at least 10 characters.')); continue; }
      if (key === 'terminal' && a === f.password) { t.line(red('Use a different password from your website one.')); continue; }
      const b = await ask('Type it again', { mask: true });
      if (b === null) return false;
      if (a !== b) { t.line(red('Those did not match. Try again.')); continue; }
      f[key] = a;
      return true;
    }
  };

  if (site.signup_mode === 'invite' && !(await askInvite())) return null;
  if (!(await askHandle()) || !(await askEmail())) return null;
  if (site.signup_mode === 'application' && !(await askApplication())) return null;
  t.line(dim('Your website password is for the website. Your terminal password is for here, IRC and the MUD.'));
  if (!(await askPassword('Website password', 'password')) || !(await askPassword('Terminal password', 'terminal'))) return null;

  let created: { id: string; handle: string } | null = null;
  for (let tries = 0; tries < 5 && !created; tries++) {
    try {
      created = await s.ctx.core.signup({
        handle: f.handle, email: f.email, password: f.password, terminal_password: f.terminal, age_confirmed: site.minimum_age > 0 ? true : undefined,
        invite: site.signup_mode === 'invite' ? f.invite : undefined, application: site.signup_mode === 'application' ? f.application : undefined, ip_hash: s.ipHash,
      });
    } catch (e) {
      if (!(e instanceof CoreError) || e.status === 0 || e.status === 429) { t.line(red((e as Error).message)); return null; }
      t.line(red(e.message));
      const again = e.code === 'handle_unavailable' ? await askHandle()
        : e.code === 'email_taken' ? await askEmail()
        : e.code === 'invite_invalid' ? await askInvite()
        : e.code === 'same_password' ? await askPassword('Terminal password', 'terminal')
        : false;
      if (!again) return null;
    }
  }
  if (!created) return null;

  t.line(`\nWelcome, ${created.handle}. We sent an email to ${f.email} with a six-digit code.`);
  t.line(dim('Type the code here, or R to send a new one. The link in the email works too.'));
  for (let tries = 0; tries < 6; tries++) {
    const v = await ask('Code', { max: 10 });
    if (v === null) { t.line(`Your account is waiting. Confirm it with the link in the email, then call back with handle ${created.handle} and your terminal password.`); return null; }
    if (v.toLowerCase() === 'r') {
      try { await s.ctx.core.resendCode(created.id); t.line('Sent. Check your email again.'); } catch (e) { t.line(red((e as Error).message)); }
      continue;
    }
    if (!/^\d{6}$/.test(v)) { t.line(red('The code is six digits.')); continue; }
    try {
      const done = await s.ctx.core.verifyCode({ user_id: created.id, code: v, via: s.via, node: s.node, ip_hash: s.ipHash });
      if (site.signup_mode === 'application') t.line('Your email is confirmed. Your application is waiting for an admin to read it; we will email you when they have. Until then you can look around, but not post.');
      return done;
    } catch (e) {
      t.line(red((e as Error).message));
      if (e instanceof CoreError && e.status === 0) return null;
    }
  }
  t.line(`Too many tries. Confirm your account with the link in the email, then call back as ${created.handle}.`);
  return null;
}

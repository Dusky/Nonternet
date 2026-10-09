import type { MailThreadSummary, MailThreadView } from '@app/shared';
import { editMessage } from '../editor';
import type { Session } from '../session';
import { page } from './pager';
import { bold, cut, dim, heading, pad, when, wrap } from './util';

// Private mail in the terminal (docs/10; owners 2026-09-30): the same conversations as the web Mail app.
export async function mail(s: Session): Promise<void> {
  const t = s.term;
  for (;;) {
    s.at('Mail');
    const r = await s.api.get<{ threads: MailThreadSummary[]; unread: number }>('/mail');
    t.line(heading(`Mail${r.unread ? ` (${r.unread} new)` : ''}`, t.cols));
    t.line(dim(`${pad('#', 4)}${pad('Subject', 36)}${pad('With', 24)}Last`));
    const shown = r.threads.slice(0, Math.max(5, t.rows - 7));
    shown.forEach((th, i) => {
      const who = th.people.map((p) => p.handle ?? 'deleted').join(', ') || 'nobody else';
      t.line(`${pad(String(i + 1), 3)}${th.unread ? bold('*') : ' '}${pad(cut(th.subject + (th.left ? ' (left)' : ''), 35), 36)}${pad(cut(who, 23), 24)}${th.last_message_at.slice(0, 10)}`);
    });
    if (!r.threads.length) t.line('No mail yet.');
    t.write(`\nNumber to read, ${bold('W')}rite a new message, or ${bold('Q')} to go back: `);
    const a = (await t.pick('wq'))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    if (a === 'w') { await write(s); continue; }
    const th = shown[Number(a) - 1];
    if (!th) { t.line('There is no conversation with that number.'); continue; }
    await conversation(s, th.id);
  }
}

async function conversation(s: Session, id: string): Promise<void> {
  const t = s.term;
  for (;;) {
    const th = await s.api.get<MailThreadView>(`/mail/${id}`);
    s.at('Reading mail');
    const w = Math.min(79, t.cols - 1);
    const lines = [heading(cut(th.subject, 60), t.cols), dim(`With ${th.people.map((p) => p.handle ?? 'a deleted account').join(', ') || 'nobody else'}`), ''];
    for (const m of th.messages) {
      const name = m.author.handle ?? 'a deleted account';
      if (m.kind !== 'message') { lines.push(dim(m.kind === 'renamed' ? `${name} renamed this conversation to ${m.body} · ${when(m.at)}` : `${name} ${m.kind === 'joined' ? 'joined' : 'left'} · ${when(m.at)}`), ''); continue; }
      lines.push(`${bold(name)} ${dim(when(m.at))}`, ...(m.deleted ? [dim('Message deleted.')] : wrap(m.body, w)), '');
    }
    if (th.left) lines.push(dim('You left this conversation.'));
    await page(s, lines);
    if (th.left) { await s.pause(); return; }
    t.write(`${bold('R')}eply, ${bold('A')}dd someone, ${bold('Q')}uit: `);
    const k = await t.choose('raq');
    t.line();
    if (k === null || k === 'q') return;
    if (k === 'r') {
      const body = await editMessage(s);
      if (body !== null) { await s.api.post(`/mail/${id}/messages`, { body }); t.line(bold('Sent.')); }
    }
    if (k === 'a') {
      t.write('Their handle: ');
      const h = (await t.readLine({ max: 40 }))?.trim().replace(/^@/, '');
      if (h) { await s.api.post(`/mail/${id}/people`, { handle: h }); t.line(`${h} can read from now on.`); }
    }
  }
}

async function write(s: Session): Promise<void> {
  const t = s.term;
  s.at('Writing mail');
  t.write('To (handles, separated by spaces): ');
  const to = (await t.readLine({ max: 400 }))?.split(/[\s,;]+/).map((h) => h.replace(/^@/, '')).filter(Boolean);
  if (!to?.length) return;
  t.write('Subject: ');
  const subject = (await t.readLine({ max: 120 }))?.trim();
  if (!subject) { t.line('No subject, so nothing was sent.'); return; }
  const body = await editMessage(s);
  if (body === null) return;
  await s.api.post('/mail', { to, subject, body });
  t.line(bold('Sent.'));
}

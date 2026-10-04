import { ONELINER_MAX, type BulletinSummary, type BulletinView, type OnelinerView, type PollSummary, type PollView } from '@app/shared';
import type { FileAreaView, FileView } from '@app/shared';
import type { Session } from '../session';
import { page } from './pager';
import { bold, cut, dim, heading, pad, when, wrap } from './util';

// The BBS classics (M9-E, docs/04): the oneliners wall, bulletins, the voting booth and the file areas. The rows
// live in core, so the web shows the same ones.

const art = (s: Session, name: string) => { if (s.ctx.art.has(name)) s.term.write(s.ctx.art.render(name, { handle: s.user!.handle, node: s.node }, { cols: s.term.cols - 1 })); };
const mark = (n: string | number, w: number) => pad(String(n), w);

// ---------------------------------------------------------------- oneliners

export async function recentOneliners(s: Session, limit = 10): Promise<OnelinerView[]> {
  return (await s.api.get<{ oneliners: OnelinerView[] }>(`/oneliners?limit=${limit}`)).oneliners;
}

export async function oneliners(s: Session): Promise<void> {
  const t = s.term;
  s.at('Oneliners');
  art(s, 'oneliners');
  for (;;) {
    t.line(heading('Oneliners', t.cols));
    const lines = await recentOneliners(s, Math.max(5, Math.min(20, t.rows - 8)));
    if (!lines.length) t.line('The wall is empty. Be the first.');
    for (const o of [...lines].reverse()) t.line(`${dim(when(o.at))} ${pad(o.author?.handle ?? '-', 16)} ${o.body}`);
    t.write(`\n${bold('A')}dd a line, or ${bold('Q')} to go back: `);
    const k = await t.choose('aq', 'q');
    if (k !== 'a') return;
    t.line('Add');
    t.write(`Your line (up to ${ONELINER_MAX} characters, Enter to cancel): `);
    const text = (await t.readLine({ max: ONELINER_MAX }))?.trim();
    if (!text) continue;
    try { await s.api.post('/oneliners', { body: text }); t.line('Up on the wall.'); }
    catch (e) { t.line(e instanceof Error ? e.message : 'That did not work.'); }
  }
}

// ---------------------------------------------------------------- bulletins

export async function bulletins(s: Session): Promise<void> {
  const t = s.term;
  s.at('Bulletins');
  art(s, 'bulletins');
  for (;;) {
    const r = await s.api.get<{ bulletins: BulletinSummary[]; unread: number }>('/bulletins');
    t.line(heading('Bulletins', t.cols));
    if (!r.bulletins.length) { t.line('There are no bulletins.'); return; }
    t.line(dim(`${pad('#', 5)}${pad('Posted', 18)}Title`));
    await page(s, r.bulletins.map((b) => `${mark(b.number, 4)}${b.unread ? bold('*') : ' '}${pad(when(b.at), 18)}${cut(b.title, 50)}`));
    t.write(`\nBulletin number to read, or ${bold('Q')} to go back: `);
    const a = (await t.pick('q', 8))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    const n = Number(a);
    if (!Number.isInteger(n)) { t.line('Type a bulletin number.'); continue; }
    try {
      const b = await s.api.get<BulletinView>(`/bulletins/${n}`);
      t.line(heading(`#${b.number} ${cut(b.title, 50)}`, t.cols));
      t.line(dim(`${when(b.at)} UTC${b.updated_at ? ` (updated ${when(b.updated_at)})` : ''}`));
      t.line();
      await page(s, wrap(b.body, Math.min(79, t.cols - 1)));
      t.line();
    } catch { t.line('There is no bulletin with that number.'); }
  }
}

// A line for the login screen: the newest bulletin, if this caller has not read it yet.
export async function newBulletinNote(s: Session): Promise<string | null> {
  const r = await s.api.get<{ bulletins: BulletinSummary[]; unread: number }>('/bulletins').catch(() => null);
  const top = r?.bulletins[0];
  if (!r || !top || !top.unread) return null;
  return `\x1b[1;33mBulletin #${top.number}:\x1b[0m ${cut(top.title, 60)}${r.unread > 1 ? ` (and ${r.unread - 1} more)` : ''}. Press I at the menu to read.`;
}

// ---------------------------------------------------------------- the voting booth

const bar = (votes: number, total: number, w = 20) => '#'.repeat(total ? Math.round((votes / total) * w) : 0).padEnd(w, '.');

function showPoll(s: Session, p: PollView): void {
  const t = s.term;
  t.line(heading(cut(p.question, 60), t.cols));
  t.line(dim(`${p.by ? `Asked by ${p.by}. ` : ''}${p.closed ? 'Closed.' : p.closes_at ? `Open until ${when(p.closes_at)} UTC.` : 'Open.'}`));
  p.options.forEach((o, i) => {
    const extra = p.can_see_results && o.votes !== null && p.total !== null ? `  ${bar(o.votes, p.total)} ${o.votes}` : '';
    t.line(`  ${bold(String(i + 1))}  ${cut(o.label, 40)}${p.my_vote === o.id ? bold(' <- your vote') : ''}${extra}`);
  });
  if (p.can_see_results && p.total !== null) t.line(dim(`${p.total} vote${p.total === 1 ? '' : 's'}`));
}

export async function polls(s: Session): Promise<void> {
  const t = s.term;
  s.at('Voting booth');
  art(s, 'polls');
  for (;;) {
    const r = await s.api.get<{ polls: PollSummary[] }>('/polls');
    t.line(heading('Voting booth', t.cols));
    if (!r.polls.length) { t.line('Nothing to vote on. Admins and trusted people can ask a question on the web.'); return; }
    t.line(dim(`${pad('#', 4)}${pad('Question', 52)}You`));
    r.polls.forEach((p, i) => t.line(`${mark(i + 1, 4)}${pad(cut(p.question, 50), 52)}${p.voted ? 'voted' : p.closed ? 'closed' : bold('open')}`));
    t.write(`\nPoll number, or ${bold('Q')} to go back: `);
    const a = (await t.pick('q'))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    const pick = r.polls[Number(a) - 1];
    if (!pick) { t.line('There is no poll with that number.'); continue; }
    let p = await s.api.get<PollView>(`/polls/${pick.id}`);
    showPoll(s, p);
    if (p.voted || p.closed) { t.line(); continue; }
    t.write(`\nYour choice (1-${p.options.length}, Enter to leave without voting): `);
    const c = (await t.pick('', 3))?.trim();
    if (!c) continue;
    const opt = p.options[Number(c) - 1];
    if (!opt) { t.line('That is not one of the choices.'); continue; }
    try { p = await s.api.post<PollView>(`/polls/${p.id}/vote`, { option_id: opt.id }); t.line('Vote counted. Here is how it stands:'); showPoll(s, p); t.line(); }
    catch (e) { t.line(e instanceof Error ? e.message : 'That did not work.'); }
  }
}

// ---------------------------------------------------------------- file areas

// Listing and describing only: the download itself happens on the web (there is no ZMODEM here).
export async function files(s: Session): Promise<void> {
  const t = s.term;
  s.at('File areas');
  art(s, 'files');
  for (;;) {
    const r = await s.api.get<{ areas: FileAreaView[] }>('/files');
    t.line(heading('File areas', t.cols));
    if (!r.areas.length) { t.line('There are no file areas yet.'); return; }
    r.areas.forEach((a, i) => t.line(`${mark(i + 1, 4)}${pad(cut(a.name, 30), 32)}${a.file_count} file${a.file_count === 1 ? '' : 's'}`));
    t.write(`\nArea number, or ${bold('Q')} to go back: `);
    const a = (await t.pick('q'))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    const area = r.areas[Number(a) - 1];
    if (!area) { t.line('There is no area with that number.'); continue; }
    const detail = await s.api.get<{ area: FileAreaView; files: FileView[] }>(`/files/areas/${encodeURIComponent(area.slug)}`);
    t.line(heading(detail.area.name, t.cols));
    if (detail.area.description) t.line(dim(cut(detail.area.description, t.cols - 1)));
    if (!detail.files.length) { t.line('Nothing here yet.'); continue; }
    const lines: string[] = [];
    detail.files.forEach((f, i) => {
      lines.push(`${mark(i + 1, 4)}${pad(cut(f.name, 28), 30)}${pad(`${Math.max(1, Math.round(f.size_bytes / 1024))} KB`, 9)}${f.uploader?.handle ?? ''}`);
      if (f.title) lines.push(`    ${cut(f.title, 70)}`);
    });
    await page(s, lines);
    t.write(`\nFile number for its download address, or ${bold('Q')}: `);
    const n = (await t.pick('q'))?.trim().toLowerCase();
    const f = detail.files[Number(n) - 1];
    if (f) {
      if (f.description) await page(s, wrap(f.description, Math.min(79, t.cols - 1)));
      t.line(`Download it on the web (there is no file transfer here):\n  ${s.ctx.siteUrl}${f.download_url}`);
      t.line(dim(`sha256 ${f.sha256}`));
    }
  }
}

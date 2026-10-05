import type { BoardSummary, RingDetail, RingSummary, WikiInfo } from '@app/shared';
import type { Session } from '../session';
import { board } from './boards';
import { page } from './pager';
import { wiki } from './wiki';
import { bold, cut, dim, heading, pad, wrap } from './util';

// Rings in the terminal (docs/06): browse, read about one, join or leave, and go to its board.
export async function rings(s: Session): Promise<void> {
  const t = s.term;
  let offset = 0;
  for (;;) {
    s.at('Rings');
    const per = Math.max(5, Math.min(20, t.rows - 6));
    const r = await s.api.get<{ rings: RingSummary[]; next: number | null }>(`/rings?sort=active&limit=${per}&offset=${offset}`);
    t.line(heading('Rings', t.cols));
    t.line(dim(`${pad('#', 4)}${pad('Ring', 30)}${pad('Members', 9)}You`));
    r.rings.forEach((g, i) => t.line(`${pad(String(i + 1), 4)}${pad(cut(g.name, 29), 30)}${pad(String(g.member_count), 9)}${g.me?.status === 'member' ? (g.me.is_op ? 'op' : 'member') : g.me?.status ?? ''}`));
    if (!r.rings.length) t.line('There are no rings yet. Start one on the web.');
    t.write(`\nRing number, ${r.next !== null ? `${bold('M')}ore, ` : ''}${offset ? `${bold('B')}ack a page, ` : ''}or ${bold('Q')} to go back: `);
    const a = (await t.pick('mbq'))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    if (a === 'm' && r.next !== null) { offset = r.next; continue; }
    if (a === 'b' && offset) { offset = Math.max(0, offset - per); continue; }
    const g = r.rings[Number(a) - 1];
    if (!g) { t.line('There is no ring with that number.'); continue; }
    await ring(s, g.slug);
  }
}

async function ring(s: Session, slug: string): Promise<void> {
  const t = s.term;
  for (;;) {
    const g = await s.api.get<RingDetail>(`/rings/${slug}`);
    const wk = await s.api.get<WikiInfo>(`/wiki/${encodeURIComponent(`ring:${slug}`)}`).catch(() => null);
    const hasWiki = Boolean(wk?.enabled);
    s.at(`Ring: ${g.name}`);
    const w = Math.min(79, t.cols - 1);
    const lines = [heading(g.name, t.cols), dim(`Founded by ${g.founder.handle} · ${g.member_count} members${g.tags.length ? ` · ${g.tags.join(', ')}` : ''}`), ''];
    lines.push(...wrap(g.about || g.description || 'No description yet.', w), '');
    if (g.latest_posts.length) {
      lines.push(bold('Latest on its board:'));
      for (const p of g.latest_posts.slice(0, 5)) lines.push(`  ${cut(p.subject, w - 20)} ${dim(`- ${p.author ?? 'deleted'}`)}`);
    }
    await page(s, lines);
    const member = g.me?.status === 'member';
    const pending = g.me?.status === 'pending' || g.me?.status === 'invited' || g.me?.status === 'banned';
    const opts = [g.board ? `${bold('R')}ead its board` : '', hasWiki ? `its ${bold('W')}iki` : '', !member && !pending && !g.archived ? `${bold('J')}oin` : '', member && !g.me?.is_founder ? `${bold('L')}eave` : '', `${bold('Q')}uit`].filter(Boolean);
    t.write(`${opts.join(', ')}: `);
    const k = await t.choose('rwjlq');
    t.line();
    if (k === null || k === 'q') return;
    if (k === 'w' && hasWiki) await wiki(s, `ring:${slug}`, `${g.name} wiki`);
    if (k === 'r' && g.board) await board(s, await s.api.get<BoardSummary>(`/boards/${g.board.slug}`));
    if (k === 'j' && !member && !pending) {
      const r = await s.api.post<{ status: string }>(`/rings/${slug}/join`);
      t.line(r.status === 'member' ? `You joined ${g.name}.` : 'The ring ops will look at your request.');
    }
    if (k === 'l' && member && !g.me?.is_founder) {
      t.write(`Leave ${g.name}? [y/N] `);
      if ((await t.choose('yn', 'n')) === 'y') { await s.api.post(`/rings/${slug}/leave`); t.line('You left.'); } else t.line('Staying.');
    }
  }
}

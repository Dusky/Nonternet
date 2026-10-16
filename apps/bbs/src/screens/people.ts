import type { Session } from '../session';
import { page } from './pager';
import { bold, dim, heading, tableHead, tableRow, when, type Column } from './util';

interface OnlinePerson { handle: string; display_name: string | null; web: boolean; chat: boolean; bbs: { node: number; where: string; via: string } | null }

// Who's online across the site: the BBS's own nodes, the web and chat (docs/04, 10).
export async function who(s: Session): Promise<void> {
  s.at("Who's online");
  const t = s.term;
  const { people } = await s.api.get<{ people: OnlinePerson[] }>('/online');
  t.line(heading("Who's online", t.cols));
  const cols: Column[] = [{ label: 'Node', width: 6, narrowLabel: 'node' }, { label: 'Handle', width: 20, main: true }, { label: 'Where', width: 50 }];
  t.line(tableHead(t.cols, cols));
  // Our own nodes come straight from the BBS (always current); the web and chat from core.
  const local = s.ctx.nodes.list().filter((n) => n.user);
  const here = new Set(local.map((n) => n.user!.handle.toLowerCase()));
  const elsewhere = people.filter((p) => !here.has(p.handle.toLowerCase()) && (p.web || p.chat));
  // A screenful at a time, so a busy evening doesn't scroll the BBS's own callers off the top.
  await page(s, [
    ...local.flatMap((n) => tableRow(t.cols, cols, [String(n.node), n.user!.handle, `${n.where} (${n.via})`])),
    ...elsewhere.flatMap((p) => tableRow(t.cols, cols, ['-', p.handle, [p.web && 'on the web', p.chat && 'in chat'].filter(Boolean).join(', ')])),
    dim(`${local.length + elsewhere.length} online`),
  ]);
}

export async function lastCallers(s: Session): Promise<void> {
  s.at('Last callers');
  const t = s.term;
  const { callers } = await s.api.get<{ callers: { handle: string; node: number; via: string; at: string; left_at: string | null }[] }>('/bbs/last-callers');
  t.line(heading('Last callers', t.cols));
  const cols: Column[] = [{ label: 'When (UTC)', width: 18 }, { label: 'Handle', width: 20, main: true }, { label: 'Node', width: 6, narrowLabel: 'node' }, { label: 'Via', width: 12 }];
  t.line(tableHead(t.cols, cols));
  await page(s, callers.flatMap((c) => tableRow(t.cols, cols, [when(c.at), c.handle, String(c.node), `${c.via}${c.left_at ? '' : bold(' on now')}`])));
  if (!callers.length) t.line('Nobody has called yet.');
}

// Settings live on the web; the BBS says where.
export async function settings(s: Session): Promise<void> {
  s.at('Settings');
  const t = s.term;
  t.line(heading('Settings', t.cols));
  t.line(`Your profile, passwords, SSH keys and everything else are on the web:`);
  t.line(`  ${s.ctx.siteUrl}/settings`);
  t.line(`This terminal: ${t.cols}x${t.rows}, ${t.encoding === 'cp437' ? 'CP437 (classic)' : 'UTF-8'}${t.ttype ? `, ${t.ttype}` : ''}.`);
  t.write('Switch character set? [U]TF-8, [C]P437, Enter to keep: ');
  const k = await t.choose('uc', 'k');
  if (k === 'u') t.encoding = 'utf8';
  if (k === 'c') t.encoding = 'cp437';
  t.line(t.encoding === 'cp437' ? 'CP437' : 'UTF-8');
}

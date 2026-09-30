import type { Session } from '../session';
import { bold, cut, dim, heading, pad, when } from './util';

interface OnlinePerson { handle: string; display_name: string | null; web: boolean; chat: boolean; bbs: { node: number; where: string; via: string } | null }

// Who's online across the site: the BBS's own nodes, the web and chat (docs/04, 10).
export async function who(s: Session): Promise<void> {
  s.at("Who's online");
  const t = s.term;
  const { people } = await s.api.get<{ people: OnlinePerson[] }>('/online');
  t.line(heading("Who's online"));
  t.line(dim(`${pad('Node', 6)}${pad('Handle', 20)}Where`));
  // Our own nodes come straight from the BBS (always current); the web and chat from core.
  const local = s.ctx.nodes.list().filter((n) => n.user);
  for (const n of local) t.line(`${pad(String(n.node), 6)}${pad(n.user!.handle, 20)}${cut(`${n.where} (${n.via})`, 50)}`);
  const here = new Set(local.map((n) => n.user!.handle.toLowerCase()));
  const elsewhere = people.filter((p) => !here.has(p.handle.toLowerCase()) && (p.web || p.chat));
  for (const p of elsewhere) t.line(`${pad('-', 6)}${pad(p.handle, 20)}${[p.web && 'on the web', p.chat && 'in chat'].filter(Boolean).join(', ')}`);
  t.line(dim(`${local.length + elsewhere.length} online`));
}

export async function lastCallers(s: Session): Promise<void> {
  s.at('Last callers');
  const t = s.term;
  const { callers } = await s.api.get<{ callers: { handle: string; node: number; via: string; at: string; left_at: string | null }[] }>('/bbs/last-callers');
  t.line(heading('Last callers'));
  t.line(dim(`${pad('When (UTC)', 18)}${pad('Handle', 20)}${pad('Node', 6)}Via`));
  for (const c of callers) t.line(`${pad(when(c.at), 18)}${pad(c.handle, 20)}${pad(String(c.node), 6)}${c.via}${c.left_at ? '' : bold(' on now')}`);
  if (!callers.length) t.line('Nobody has called yet.');
}

// Settings live on the web; the BBS says where.
export async function settings(s: Session): Promise<void> {
  s.at('Settings');
  const t = s.term;
  t.line(heading('Settings'));
  t.line(`Your profile, passwords, SSH keys and everything else are on the web:`);
  t.line(`  ${s.ctx.siteUrl}/settings`);
  t.line(`This terminal: ${t.cols}x${t.rows}, ${t.encoding === 'cp437' ? 'CP437 (classic)' : 'UTF-8'}${t.ttype ? `, ${t.ttype}` : ''}.`);
  t.write('Switch character set? [U]TF-8, [C]P437, Enter to keep: ');
  const k = await t.choose('uc', 'k');
  if (k === 'u') t.encoding = 'utf8';
  if (k === 'c') t.encoding = 'cp437';
  t.line(t.encoding === 'cp437' ? 'CP437' : 'UTF-8');
}

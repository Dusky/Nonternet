import type { Session } from '../session';
import { bold, heading } from './util';

// QWK offline mail from the terminal (docs/04). Packets move over the web for now; ZMODEM in the terminal
// is not built yet.
export async function qwk(s: Session): Promise<void> {
  const t = s.term;
  s.at('QWK offline mail');
  const info = await s.api.get<{ packet: string; reply: string; conferences: { conf: number; name: string }[] }>('/me/qwk');
  t.line(heading('QWK offline mail', t.cols));
  t.line('Take new messages from your boards to read offline, and send your replies back.');
  t.line(`Your packet (${bold(info.packet)}) has: ${info.conferences.map((c) => `${c.conf} ${c.name}`).join(', ') || 'no boards yet'}.`);
  t.line('Watch boards on the web to choose which ones.');
  t.line();
  t.line(`Download your packet and upload your ${info.reply} on the web:`);
  t.line(`  ${s.ctx.siteUrl}/settings/terminal`);
  t.line('Transfers by ZMODEM from here are not available yet.');
}

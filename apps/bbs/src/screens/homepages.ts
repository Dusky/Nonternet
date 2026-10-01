import type { Session } from '../session';
import { bold, cut, dim, heading, pad } from './util';

interface Entry { handle: string; display_name: string | null; title: string; description: string; url: string; updated: string | null }

// The homepage directory (docs/07). Homepages are web pages, so the terminal lists them with their addresses.
export async function homepages(s: Session): Promise<void> {
  const t = s.term;
  let offset = 0;
  for (;;) {
    s.at('Homepages');
    const per = Math.max(5, Math.min(15, Math.floor((t.rows - 6) / 2)));
    const r = await s.api.get<{ homepages: Entry[]; next: number | null }>(`/homepages?sort=recent&limit=${per}&offset=${offset}`);
    t.line(heading('Homepages', t.cols));
    for (const h of r.homepages) {
      t.line(`${bold(pad(cut(h.title || h.handle, 40), 42))}${dim(h.handle)}`);
      t.line(`  ${h.url}${h.updated ? dim(`  updated ${h.updated.slice(0, 10)}`) : ''}`);
    }
    if (!r.homepages.length) t.line('No homepages yet. Make yours on the web, in the Homepage studio.');
    t.write(`\n${r.next !== null ? `${bold('M')}ore, ` : ''}${offset ? `${bold('B')}ack a page, ` : ''}${bold('Q')} to go back: `);
    const k = await t.choose('mbq');
    t.line();
    if (k === null || k === 'q') return;
    if (k === 'm' && r.next !== null) offset = r.next;
    if (k === 'b' && offset) offset = Math.max(0, offset - per);
  }
}

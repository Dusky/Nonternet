import { inUse, mayUse, runDoor } from '../doors';
import type { Session } from '../session';
import { bold, cut, dim, heading, pad } from './util';

// The door games menu (docs/04).
export async function doors(s: Session): Promise<void> {
  const t = s.term;
  for (;;) {
    s.at('Door games');
    const list = s.ctx.doors.filter((d) => mayUse(d, s.user!.role));
    t.line(heading('Door games'));
    if (!list.length) { t.line('There are no door games on this BBS yet.'); return; }
    list.forEach((d, i) => t.line(`${pad(String(i + 1), 4)}${pad(cut(d.name, 28), 30)}${dim(cut(d.description, 30))}${inUse(d.id) >= d.max_nodes ? bold(' (full)') : ''}`));
    t.write(`\nDoor number, or ${bold('Q')} to go back: `);
    const a = (await t.readLine({ max: 4 }))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    const d = list[Number(a) - 1];
    if (!d) { t.line('There is no door with that number.'); continue; }
    if (inUse(d.id) >= d.max_nodes) { t.line(`${d.name} is full right now. Try again soon.`); continue; }
    t.line(dim(`Opening ${d.name}. You have ${d.time_limit_minutes} minutes.`));
    s.at(`Playing ${d.name}`);
    const how = await runDoor(s, d, s.ctx.doorWrapper);
    if (how === 'gone') return;
    t.line(how === 'time' ? `\r\nYour time in ${d.name} is up.` : `\r\nBack from ${d.name}.`);
  }
}

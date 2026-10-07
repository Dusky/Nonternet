import sharp from 'sharp';
import { wikiSlug } from '@app/shared';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { hashPassword } from './passwords';
import { starterPages } from './wiki-starter';

// A believable small community, for looking at the site (docs/19). People are made directly (so they are confirmed and have a known
// password); everything else goes through the real API of a running core, so the demo uses the same paths a visitor would.
// Refused in production. Safe to run twice: people who exist are not made again and their content is not repeated.
export const DEMO_PASSWORD = 'demo walkthrough 1';

interface Person { handle: string; name: string; role: 'user' | 'trusted'; bio: string; status: string; hue: string }
const PEOPLE: Person[] = [
  { handle: 'ada', name: 'Ada', role: 'trusted', bio: 'Keeps the synth board tidy. Ask me about modular patches.', status: 'Patching a Eurorack rig', hue: '#d9622b' },
  { handle: 'lin', name: 'Lin', role: 'trusted', bio: 'Hand-made web pages since 1998. Rings, buttons and guestbooks.', status: 'Drawing a new 88×31', hue: '#2b7bd9' },
  { handle: 'tansy', name: 'Tansy', role: 'user', bio: 'New here. Mostly lurking, sometimes wandering the old road.', status: 'Looking for a group for the mine', hue: '#3a9a5b' },
  { handle: 'ozzy', name: 'Ozzy', role: 'user', bio: 'Tracker music and terminal things.', status: 'Away until Friday', hue: '#8a4bd1' },
  { handle: 'moss', name: 'Moss', role: 'user', bio: 'I read more than I write.', status: '', hue: '#6b7b3a' },
];

const initialPng = (letter: string, colour: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${colour}"/><text x="128" y="170" font-size="140" font-family="Verdana, sans-serif" font-weight="bold" text-anchor="middle" fill="#fff">${letter}</text></svg>`)).png().toBuffer();

const bannerPng = (w: number, h: number, a: string, b: string, text: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="${w / 2}" y="${h * 0.62}" font-size="${h * 0.38}" font-family="Verdana, sans-serif" font-weight="bold" text-anchor="middle" fill="#fff">${text}</text></svg>`)).png().toBuffer();

export async function seedDemo(deps: AppDeps, base: string): Promise<{ created: string[]; password: string }> {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo seed is for looking at the site; it will not run in production.');
  const origin = new URL(process.env.PUBLIC_URL ?? base).origin; // core only accepts changes from the site's own address
  const created: string[] = [];
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const fresh = new Set<string>();
  for (const p of PEOPLE) {
    const has = await deps.db.query(`SELECT 1 FROM users WHERE lower(handle) = $1`, [p.handle]);
    if (has.rowCount) continue;
    await deps.db.query(`INSERT INTO users (id, handle, email, email_verified_at, password_hash, role, role_rev) VALUES ($1, $2, $3, now(), $4, $5, 1)`,
      [newId('u'), p.handle, `${p.handle}@demo.invalid`, passwordHash, p.role]);
    fresh.add(p.handle);
    created.push(p.handle);
  }

  // One signed-in client per person.
  const sessions = new Map<string, string>();
  async function api(handle: string, method: string, path: string, body?: unknown, raw?: Buffer): Promise<{ status: number; json: any }> {
    if (!sessions.has(handle)) {
      const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ identifier: handle, password: DEMO_PASSWORD }) });
      const sid = /sid=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
      if (!r.ok || !sid) throw new Error(`could not sign in as ${handle}: ${r.status}`);
      sessions.set(handle, sid);
    }
    const r = await fetch(`${base}/api/v1${path}`, {
      method, headers: { cookie: `sid=${sessions.get(handle)}`, origin, 'content-type': raw ? 'application/octet-stream' : 'application/json' },
      body: raw ? new Uint8Array(raw) : (body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body)),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  }
  const must = async (what: string, p: Promise<{ status: number; json: any }>) => { const r = await p; if (r.status >= 400) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

  for (const p of PEOPLE.filter((x) => fresh.has(x.handle))) {
    await must('profile', api(p.handle, 'PATCH', '/me', { display_name: p.name, bio: p.bio, ...(p.status ? { status_line: p.status } : {}), ...(p.handle === 'ozzy' ? { away: true } : {}) }));
    await must('avatar', api(p.handle, 'PUT', '/me/avatar', undefined, await initialPng(p.name[0]!, p.hue)));
  }
  if (!fresh.has('ada')) return { created, password: DEMO_PASSWORD }; // content goes in once, with the first run

  // Boards, threads, replies, reactions, one edit and one pin.
  await must('board', api('ada', 'POST', '/boards', { slug: 'synths', name: 'Synths and modular', visibility: 'public', description: 'Patches, gear, and help with both.' }));
  await must('board', api('ada', 'POST', '/boards', { slug: 'homepages', name: 'Make a page', visibility: 'public', description: 'Hand-made pages: tips, templates and show-and-tell.' }));
  await must('board', api('lin', 'POST', '/boards', { slug: 'lounge', name: 'The lounge', visibility: 'public', description: 'Everything else. Be kind.' }));
  const first = await must('thread', api('ada', 'POST', '/boards/synths/posts', { subject: 'What was your first synth?', body: 'Mine was a battered Juno-106 from a pawn shop.\nThe voice chips died a year later, but I learned everything on it.' }));
  const r1 = await must('reply', api('lin', 'POST', '/boards/synths/posts', { body: 'A Volca Keys. Small, cheap, and it taught me what a filter does.', reply_to: first.id }));
  await must('reply', api('tansy', 'POST', '/boards/synths/posts', { body: 'A toy keyboard with a pitch wheel I broke in a week. Does that count?', reply_to: first.id }));
  await must('reply', api('moss', 'POST', '/boards/synths/posts', { body: `@ada did the chips ever get replaced?`, reply_to: r1.id }));
  await must('edit', api('ada', 'PATCH', `/posts/${first.id}`, { body: 'Mine was a battered Juno-106 from a pawn shop.\nThe voice chips died a year later, but I learned everything on it.\nEdit: it was the 106, not the 60.' }));
  for (const [who, what] of [['lin', 'thanks'], ['tansy', 'thanks'], ['moss', 'interesting'], ['ozzy', 'funny']] as const) await api(who, 'PUT', `/posts/${first.id}/reactions/${what}`, {});
  await must('pin', api('ada', 'PUT', `/boards/synths/threads/${first.id}/pin`, {}));
  await must('thread', api('ada', 'POST', '/boards/synths/posts', { subject: 'Patch notes thread', body: 'Post your favourite patches here, with a photo of the cables if you can.' }));
  const tips = await must('thread', api('lin', 'POST', '/boards/homepages/posts', { subject: 'Your first page in ten minutes', body: 'Open the Studio, pick a template, and change the title. That is a page. Everything after is decoration.\nThe asset library has dividers, buttons and blinkies you can add with one click.' }));
  await must('reply', api('tansy', 'POST', '/boards/homepages/posts', { body: 'Just did it. Is the hit counter supposed to say 000001?', reply_to: tips.id }));
  await must('thread', api('lin', 'POST', '/boards/lounge/posts', { subject: 'Say hello', body: 'New people: tell us one thing you are making this month.' }));
  await api('tansy', 'PUT', '/boards/synths/watch', {});

  // Rings, banners, two homepages.
  await must('ring', api('lin', 'POST', '/rings', { slug: 'handmade', name: 'Hand-made pages', description: 'Pages made by hand, with no trackers.', tags: ['handmade', 'web'] }));
  await must('banner', api('lin', 'PUT', '/rings/handmade/banner/468x60', undefined, await bannerPng(468, 60, '#2b7bd9', '#8a4bd1', 'HAND-MADE PAGES')));
  await must('banner', api('lin', 'PUT', '/rings/handmade/banner/88x31', undefined, await bannerPng(88, 31, '#2b7bd9', '#8a4bd1', 'HAND-MADE')));
  for (const who of ['ada', 'tansy']) await api(who, 'POST', '/rings/handmade/join', {});
  const snippets = (await must('snippets', api('lin', 'GET', '/homes/me/snippets'))).snippets as { id: string; html: string }[];
  const page = (title: string, intro: string, ids: string[]) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Georgia,serif;max-width:40rem;margin:2rem auto;padding:0 1rem"><h1>${title}</h1><p>${intro}</p><hr>${snippets.filter((s) => ids.includes(s.id)).map((s) => `<p>${s.html}</p>`).join('')}</body>`;
  await must('page', api('lin', 'PUT', '/homes/me/file?path=index.html', undefined, Buffer.from(page('Lin’s corner', 'Welcome. I make buttons and keep a guestbook; please sign it.', ['counter', 'guestbook']))));
  await must('page', api('ada', 'PUT', '/homes/me/file?path=index.html', undefined, Buffer.from(page('Ada’s patch bay', 'Notes on modular, with photos when I remember.', ['counter', 'updated']))));
  await api('lin', 'PATCH', '/homes/me', { title: 'Lin’s corner', description: 'Buttons, rings and a guestbook.' });
  await api('ada', 'PATCH', '/homes/me', { title: 'Ada’s patch bay', description: 'Notes on modular synths.' });

  // The classics: a bulletin (written straight into the table: admins sign in with two-factor), a poll, wall lines, mail.
  await deps.db.query(`INSERT INTO bulletins (id, title, body) VALUES ($1, $2, $3)`, [newId('bl'), 'Welcome, and how this place works', 'This is a small, friendly site run by people, not by an algorithm.\n\nBoards are for talking, rings are for finding pages you will like, and your homepage is yours to decorate.\nBe kind, and say hello on the wall.']);
  await must('poll', api('ada', 'POST', '/polls', { question: 'Best first synth?', options: ['Juno-106', 'Volca Keys', 'A toy keyboard', 'Something else'], closes_in_days: 30 }));
  const poll = (await must('polls', api('lin', 'GET', '/polls'))).polls[0];
  const options = (await must('poll', api('lin', 'GET', `/polls/${poll.id}`))).options as { id: string }[];
  for (const [who, i] of [['lin', 1], ['tansy', 2], ['moss', 0]] as const) await api(who, 'POST', `/polls/${poll.id}/vote`, { option_id: options[i]!.id });
  for (const [who, line] of [['ada', 'Patch cables everywhere, send help'], ['lin', 'New 88×31 coming tonight'], ['tansy', 'Just found the synth board. Hello!'], ['ozzy', 'Tracker night on Friday']] as const) await api(who, 'POST', '/oneliners', { body: line });
  await must('mail', api('ada', 'POST', '/mail', { to: ['tansy'], subject: 'Welcome aboard', body: 'Glad you made it. The synth board is the busy one; the lounge is the friendly one.' }));
  await api('tansy', 'POST', '/mail', { to: ['ada'], subject: 'A question about patches', body: 'Where would you start if you had one oscillator and one filter?' });
  // The wiki's starter help pages (docs/20), written by Ada through the same route an editor uses.
  for (const sp of starterPages(deps.config)) await api('ada', 'PUT', `/wiki/site/pages/${wikiSlug(sp.title)}`, { title: sp.title, body: sp.body, base_revision: 0, summary: 'Starter page' });
  return { created, password: DEMO_PASSWORD };
}

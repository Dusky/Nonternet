import { toPublicSite, wikiSlug, type PublicSite, type SiteConfig } from '@app/shared';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { getPage, savePage } from './wiki';

// The wiki's starter pages (docs/20, decided 2026-10-07): a few plain help pages an admin can choose to add to the site
// wiki. Never added by themselves. Each is written by hand from what the site really does, with the name, hosts and
// ports filled in from the site config, and becomes an ordinary page credited to the admin who added it.

export interface StarterPage { title: string; body: string }

export function starterPages(cfg: SiteConfig): StarterPage[] {
  const s = toPublicSite(cfg);
  return [
    { title: 'Home', body: home(s) },
    { title: 'Getting started', body: gettingStarted(s) },
    { title: 'Connecting', body: connecting(s) },
    { title: 'Rings', body: rings() },
    { title: 'Your stuff', body: yourStuff(s) },
    { title: 'Privacy and safety', body: privacy(s) },
  ];
}

const home = (s: PublicSite) => `# Welcome to ${s.name}

This is the site's wiki. Anyone can read it; trusted people and admins can edit it.

- [[Getting started]]: your account, the desktop, and where things are.
- [[Connecting]]: the other ways in, from a terminal, an IRC client or a MUD client.
- [[Rings]]: groups with their own board, chat channel and homepage nav bar.
- [[Your stuff]]: getting everything you made out, and bringing it back.
- [[Privacy and safety]]: who sees what, and what to do when something is wrong.

These pages are a starting point. If something is out of date or missing, fix it.`;

const gettingStarted = (s: PublicSite) => `## Your account
${s.signup_mode === 'open' ? 'Anyone can sign up.' : s.signup_mode === 'invite' ? 'Signing up needs an invite code from someone already here.' : 'Signing up starts with a short application that an admin reads.'} One account works everywhere: the web, the BBS, chat and the MUD.

New accounts start as **users**. Admins can make someone **trusted**, which lets them start boards, found rings and edit this wiki. Two trusted people can also vouch for someone, and an admin confirms it.

## The desktop
Apps open as windows. Drag them by the title bar, snap them to the sides, and find anything with **Ctrl+K**. On a phone the apps are full screen instead.

The ones you'll use most:
- **Boards**: threaded discussion. Watch a board to hear about new threads.
- **Chat**: the IRC channels, in a window.
- **Mail**: private messages and small group conversations.
- **Homepages** and **Homepage studio**: your own little website.
- **MUD**: the tower. Climb it.
- **Terminal**: the BBS, without leaving the browser.

## Make it yours
Settings has your profile, a picture, a status line and your .plan. Under Appearance you can pick a theme and a wallpaper, including a picture of your own.

Next: [[Connecting]].`;

function connecting(s: PublicSite): string {
  const lines: string[] = [`Everything works in the browser at ${s.domain}. These are the other ways in.`];
  const terminal = s.services.bbs || s.services.irc || s.services.mud;
  if (terminal) lines.push('', '## Your terminal password', 'Clients outside the browser can\'t use passkeys or two-factor, so they use a separate **terminal password**. Set one in Settings, under Terminal password. It is not your main password, and you can change it any time.');
  if (s.services.bbs) lines.push('', '## The BBS', `- Telnet: \`telnet ${s.bbs.host} ${s.bbs.telnet_port}\`. Telnet is not encrypted, so prefer SSH.`, `- SSH: \`ssh -p ${s.bbs.ssh_port} yourhandle@${s.bbs.host}\`. You can add SSH keys in Settings and skip the password.`, '- Or open the Terminal app here.', '', 'The BBS has the boards, mail, oneliners, bulletins, polls, door games and QWK offline mail.');
  if (s.services.irc) lines.push('', '## Chat (IRC)', `Point any IRC client at \`${s.irc.host}\`, port ${s.irc.port}, with TLS. Sign in with SASL using your handle and terminal password. Everyone starts in ${s.irc.lobby}.`);
  if (s.services.mud) lines.push('', '## The MUD', `Any MUD client works: \`telnet ${s.mud.host} ${s.mud.port}\`, then type \`connect yourhandle yourterminalpassword\`. In the browser, open the MUD app and you're signed in already.`);
  const mirrors: string[] = [];
  if (s.services.gopher) mirrors.push(`- Gopher: \`gopher://${s.gopher.host}${s.gopher.port === 70 ? '' : `:${s.gopher.port}`}/\``);
  if (s.services.gemini) mirrors.push(`- Gemini: \`gemini://${s.gemini.host}${s.gemini.port === 1965 ? '' : `:${s.gemini.port}`}/\``);
  if (s.services.finger) mirrors.push(`- finger: \`finger yourhandle@${s.finger.host}\` shows a profile and .plan.`);
  if (mirrors.length) lines.push('', '## Read-only mirrors', 'The public boards, homepages and this wiki can also be read here, without an account:', ...mirrors);
  lines.push('', 'Public boards, threads and wiki changes also have Atom feeds: look for the Feed link.');
  return lines.join('\n');
}

const rings = () => `A ring is a group of people around a shared interest, named after the webrings of the old web. Each ring has:
- its own **board**;
- its own **chat channel**;
- a **nav bar** that members put on their homepages, linking them all together;
- optionally, its own **wiki**.

## Joining and leaving
Open the Rings app, find one you like and press **Join this ring**. Some rings let anyone in, some ask the ring's ops to approve you, and some are by invitation only. You can leave any time.

## Starting one
Trusted people can found a ring. The founder becomes its first **op**: ops look after the ring's board and channel, approve members if the ring asks for that, and can switch on the ring's wiki.

## Etiquette
Rings set their own tone, but the site's rules apply everywhere. Report a problem rather than arguing about it.`;

const yourStuff = (s: PublicSite) => `Everything you make here is yours.

## Getting it out
Settings, **Your data**, makes an export: one zip with your posts, mail, homepage files, chat messages, MUD characters, wiki edits, settings and more, in plain open formats (JSON, text and the original files). It is ready to download a few minutes after you ask.

## Bringing it back
Under the same tab you can upload an export, here or on another site like this one. You see what would come back before anything changes. Only what is yours alone comes back: your profile, settings, picture, homepage, files and SSH keys. Posts and conversations other people took part in stay where they were.

## Leaving
You can delete your account from Your data. You choose whether your public posts stay (credited to "deleted account") or are removed. Make an export first if you want a copy.

Questions about your data go to the admins of ${s.name}.`;

const privacy = (s: PublicSite) => `## Who sees what
- **Public boards, homepages, profiles and this wiki** can be read by anyone, including people who aren't signed in and the read-only mirrors.
- **Boards that aren't public**, including most ring boards, are only for the people allowed in.
- **Mail** is between the people in the conversation. Admins only see a message if someone reports it.
- **Your own wallpaper picture** and your settings are only shown to you.

The people who run ${s.name} look after the server, and could technically read anything stored on it. They only look at private things when there's a report or a legal reason.

## Keeping your account safe
- Use a long password, and add a **passkey** or **two-factor** in Settings.
- Your terminal password is separate from your main one. If you think it leaked, change it.
- Changing your password signs out every other session, so do that if you think someone else got in.

## When something is wrong
Every post, profile, homepage and wiki page has a **Report** option. Reports go to the admins (or a ring's ops, for ring content), and moderation actions are written to an audit log. You can also block someone so you stop seeing them.`;

// Adds the starter pages that don't exist yet; pages already there are left alone. Returns the titles it added.
export async function addStarterPages(deps: AppDeps, admin: SessionUser, origin: 'web' | 'cli'): Promise<string[]> {
  if (admin.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can add the starter pages.');
  const added: string[] = [];
  for (const p of starterPages(deps.config)) {
    const slug = wikiSlug(p.title);
    const exists = await getPage(deps, admin, 'site', slug).then(() => true, (e: unknown) => (e instanceof ApiError && e.status === 404 ? false : Promise.reject(e)));
    if (exists) continue;
    await savePage(deps, admin, 'site', slug, { title: p.title, body: p.body, base_revision: 0, summary: 'Starter page' });
    added.push(p.title);
  }
  if (added.length) await audit(deps.db, { actorId: admin.userId, actorKind: origin === 'cli' ? 'cli' : 'user', action: 'wiki.starter_added', targetType: 'wiki', targetId: 'site', after: { pages: added }, origin });
  return added;
}

// For the CLI: act as an existing admin, by handle.
export async function adminByHandle(deps: AppDeps, handle: string): Promise<SessionUser> {
  const r = await deps.db.query<{ id: string; handle: string; display_name: string | null; email: string; role: SessionUser['role'] }>(
    `SELECT id, handle, display_name, email, role FROM users WHERE lower(handle) = lower($1) AND status = 'active'`, [handle]);
  const u = r.rows[0];
  if (!u) throw new Error(`No active account called ${handle}.`);
  if (u.role !== 'admin') throw new Error(`${u.handle} is not an admin.`);
  return { sessionId: 'cli', userId: u.id, handle: u.handle, displayName: u.display_name, bio: null, theme: null, theme_variant: null, email: u.email, role: u.role,
    emailVerified: true, totpEnabled: true, limited: false, recoveryRemaining: 0, roleRev: 0, ops: [] };
}

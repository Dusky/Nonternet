# 10 — Web Shell & UI

The shell makes the services feel like one site.

## Concept
Desktop-style windows on large screens; a launcher home screen with full-screen apps on phones.
Every app also has a normal full-page URL (links, bookmarks, sharing).

## Apps
| App | v1? |
|---|---|
| **Boards** (`05`) | yes |
| **Terminal** — BBS in xterm.js (`04`) | yes (M8), shown when `services.bbs` is on |
| **Rings** — directory, ring pages, my rings, ring op tools (`06`) | yes |
| **Homepage studio** — files, editor, preview, widgets (`07`) | yes |
| **Homepages** — directory, random page | yes |
| **Who's online** — presence across services, user profile cards | yes |
| **Settings** — profile, passwords, theme, notifications, export, custom domain; terminal password and SSH keys arrive with the first service that needs them (IRC) | yes |
| **Admin console** (`11`) | yes (admins) |
| **Chat** — IRC (`08`) | yes (M5), shown when `services.irc` is on |
| **People** — public profiles: bio, homepage, rings, MUD characters (`09`) | yes (M6), public |
| **MUD** — a text log and command line into the world (`09`) | yes (M6), shown when `services.mud` is on |
| **Files** — file areas: browse, download, upload (trusted), report (`05`) | yes (M7), public |
| **Mail** — private conversations between two people or a group of up to 10 (Q11) | yes (M7), confirmed users |

## Desktop layout
Taskbar (launcher, open windows, online count, mail with unread count, notifications, clock); draggable/resizable
windows with remembered positions; desktop icons; keyboard window cycling. All built; see "As built
(design pass)" below.

## Mobile
Launcher grid; apps full-screen with back navigation; terminal key bar (Esc, Ctrl, Tab,
arrows); Boards designed mobile-first.

## Themes (PROPOSED)
Amber CRT, green screen, Win95-style, System 7-style, and a clean modern light/dark.
Themes are token sets in `packages/ui-themes`. Effects (scanlines, glow, sounds) individually
toggleable; flicker off by default; respect `prefers-reduced-motion`. Admin sets the default.

Note: themes style the chrome; **all copy follows the plain voice** in `00`.

## Landing page (logged out)
Site name and banner, online count, recent public posts, featured rings and homepages,
how to connect (web now; telnet, SSH and IRC as they ship), sign up / log in.

## Accessibility (required)
Keyboard-operable; proper ARIA roles for windows; modern theme meets WCAG AA; retro themes
offer high contrast; terminal windows offer a screen-reader mode or transcript (VERIFY
xterm.js support). The Boards app is the accessible path to BBS content.

## As built (M1)
- **Navigation has no nested routers.** The address bar belongs to the page router only. Apps use
  `nav.tsx`: `PageNav` (a full page on a phone, tied to the URL) and `WindowNav` (a window on the
  desktop, tied to window state, never touching the address bar). Apps link with `AppLink`.
- **Windows** (`shell/windows.ts`): one window per app, z-order by last click, minimize, maximize
  and restore, minimum 320×240, the title bar always reachable, 48px taskbar. Move and resize by
  mouse or keyboard. Positions are kept in localStorage (`ui:windows:v1`) and pulled back into view
  when the browser shrinks. Below 900px wide the shell shows the launcher and full-screen pages.
- **Themes** (`packages/ui-themes`): modern (light and dark by system setting) and amber.
  Scanlines and glow are separate switches on amber. A unit test enforces contrast: 4.5:1 for
  modern, 7:1 for amber.
- **Accessibility is tested**: axe-core scans every main screen in both themes, on desktop.
- **A window remembers where its app is** (`Win.path`), so one app can open another at a place:
  `OpenAppLink` opens a window at that place on the desktop and the app's page on a phone, and has a
  real address so it opens in a new tab like any link.
- The taskbar is a fixed 48px high (the window manager relies on it) and has a bell with the unread
  count of notifications.
- Logout is a full page load, so no client state survives it.

## Tech (PROPOSED)
React + Vite + TypeScript; TanStack Query; Zustand for the window manager; xterm.js;
in-house window manager. All strings from `packages/strings` with `site.name` interpolation.

## As built (M7): Mail
- **Conversations**, not single messages: a subject, the people in it (2 to 10 counting you) and the
  messages. Anyone in a conversation can add someone; a newcomer reads from when they joined, not before
  (a "joined" line marks it). Leaving stops new messages and keeps what was said while you were there.
- **Only confirmed users** (not guests) can take part. People with the `user` role can start 20 new
  conversations a day; trusted people and admins have no daily cap. Replies are rate-limited per minute.
- **Blocking** (Settings → Blocked, or Block on a profile): the blocked person can't start a conversation
  with you or add you to one (either way they get a generic "can't send mail" so they aren't told), and
  their messages are hidden from you in groups you share. Admins can't be blocked.
- **Private by default:** sending mail is not audited. A **report** on one message goes to the admins'
  report queue with that message only, never the rest of the conversation (audited as `report.created`).
- **Delete** your own message: everyone sees "Message deleted."
- **Account deletion** treats mail like posts: kept without the name, or erased; the person leaves every
  conversation and their blocks go. **Export** (`12`): `mail/conversations.json` (each conversation's
  subject, people, and only your own messages) and `mail/blocked.json`.
- API in `14`; core in `apps/core/src/mail.ts`; tests `mail.test.ts`, `e2e/tests/mail.spec.ts`.

## As built (design pass, 2026-10-01)
The owners asked for a design, UI and usability pass: a stronger default look with the copy kept
plain, a "what's new" home, and the full landing page. No new themes.
- **Design tokens** (`packages/ui-themes`): besides colours, each theme sets a display font (system
  monospace: the site name, headings, numbers), three radii, two shadows, a tinted surface for
  selected and unread items (`accentSoft`), `warn`, a stronger line, title-bar colours for the focused
  window, and the desktop's dotted background. Modern is warm paper and ink with a blue accent.
  Contrast tests cover every new text pair. No font files are bundled (V10 stays open).
- **Scales** (`styles.css`): one type scale (`--step-*`, fluid) and one spacing scale (`--space-*`)
  used everywhere; controls are 40px high, 44px on touch screens.
- **Shared components** (`apps/shell/src/components`): `ConfirmDialog` via `useConfirm()` (a native
  `<dialog>` naming the action on its button; it replaced every `window.confirm`), `useToast()`,
  `EmptyState`, `Loading` (placeholder rows for lists), `BackLink`, `Tabs`, `SideNav` (Settings and
  the admin console, grouped; chips on narrow screens), `Avatar` (initials, colour from the stable
  id), `RelativeTime` (exact time on hover), `NotFound`.
- **Strings** can have a singular and a plural form, `"one|many"`, picked by `{count}` (no more
  "1 threads").
- **Taskbar**: apps menu with coloured app tiles, a search button, open windows with their icons,
  people online (opens People), a clock (Settings → Appearance can hide it, per device), mail,
  notifications, and an account menu with the person's avatar.
- **Keyboard**: Ctrl+K (Cmd+K) opens a search-and-jump palette (apps, boards, settings pages, a
  person by handle). Alt+` brings the next window forward, minimized ones included. In a focused
  title bar, Alt+Left and Alt+Right snap the window to half the screen. Menus follow the menu button
  pattern (arrows, Home, End, Escape returns focus). Opening a window moves focus into it; closing
  one gives focus to the window behind or the app's desktop icon.
- **Home**: on the desktop a home panel sits beside the icons; on a phone it is above the app grid.
  It shows a greeting, counts (new posts, unread mail, notifications, people online), boards with
  new posts, who's online, a "getting started" list worked out from what the person has already done
  (bio, homepage, watching a board, two-factor; confirming email for guests), dismissable, and links
  to their homepage. Empty sections are left out.
- **Who's online** is now shown: the home panel, the taskbar count, and the People app's start page.
- **Phones**: a tab bar along the bottom (Home, Boards, Mail, Notifications, Me) with unread counts.
- **Landing page**: site name, tagline, people online (a number only), recent threads on public
  boards, a few rings and homepages, and how to connect (web; telnet, SSH, IRC and the MUD when
  they are on). Data from `GET /api/v1/landing` (public, cached 30 s).
- **Default theme**: `ui.default_theme` in the site config, editable in the console; used until the
  person picks a theme.
- **Windows** open to the right of the desktop icons so the icons stay reachable.
- **Screenshots** for reviewing design changes: `SCREENSHOTS=<folder> pnpm --filter @app/e2e test
  screens` captures every main screen on desktop and phone in modern light, modern dark and amber.

## As built (M9-A): live updates
- **One event stream per tab** (`GET /api/v1/events`, `live.ts`): core says "something changed" and the tab refetches
  that query. Wired to new notifications, mail, posts (on boards the person may read) and announcements. The
  counters poll only every 5 minutes while the stream is up and every minute when it is not.
- **If the stream is lost** (proxy that buffers, restart, no network) the shell says nothing and falls back to polling,
  reopening the stream with growing pauses. When it comes back, everything is refetched once to catch up.
- **Chat, the MUD and the Terminal reconnect by themselves** after a lost connection (1 s, 2 s, 4 s … 30 s, with jitter).
  A goodbye (quitting the MUD, the BBS's own Goodbye) stays closed. Chat rejoins the channels that were open; each
  reconnect gets a fresh one-use ticket.

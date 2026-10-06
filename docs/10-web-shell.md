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

## Themes (DECIDED 2026-10-02, see `17` D18 and "As built (restyle)" below)
Five themes: **Webring** (the handmade web on cream paper; the default), **After dark** (the same zine
in amber, magenta second), **Terminal** (the BBS everywhere, with eight screen colours), **Platinum**
(late-90s grey desktop) and **Aqua** (turn-of-the-century gloss). Themes are token sets in
`packages/ui-themes`. Effects (scanlines, glow, CRT corners) are separate switches, off by default and
off whenever the device asks for reduced motion or more contrast. Admin sets the default.

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
- **First load** (Phase H4, 2026-10-02): the libraries every page needs (React, router, query) are one `vendor` file; the main file is our own code.
  Signup, legal pages, password recovery, two-factor setup, homepage reports and the guestbook sign page are fetched when someone goes there
  (the front door, Landing and Login, stay in the main file). Main file 482 KB → 223 KB raw (149 KB → 65 KB gzipped); `vendor` 226 KB (72 KB gzipped);
  so the first load is about 449 KB raw instead of 482 KB, and a new release of our code no longer refetches React. The editor (CodeMirror, 567 KB),
  the terminal (xterm), chat (irc-framework) and each app are their own files, fetched when opened. The English string table stays in the main file
  (it is the only language and every screen needs it). The size warning limit is 600 KB so only a file bigger than the editor is flagged.
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
- **Widgets come from libraries, styled by us** (2026-10-04): menus, context menus, tabs and the
  confirm dialog use React Aria Components (`components/Menu.tsx`, `feedback.tsx`); toasts use Sonner,
  and a toast can carry an Undo button (`toast(text, 'ok', { undo })`), so a reversible action can act
  at once instead of asking first; the palette uses cmdk. All are unstyled and take our CSS, so the
  themes are unchanged. Keep `confirm()` for what can't be taken back.
- **Keyboard**: Ctrl+K (Cmd+K) opens a search-and-jump palette (apps, boards, settings pages, a
  person by handle; letters in order match, so "stng" finds Settings). Alt+` brings the next window
  forward, minimized ones included. In a focused title bar, Alt+Left and Alt+Right snap the window to
  half the screen. Menus follow the menu button pattern (arrows, Home, End, typing a letter jumps to
  an item, Escape returns focus). Opening a window moves focus into it; closing
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
  screens` captures every main screen on desktop and phone in every theme.

## As built (M9-A): live updates
- **One event stream per tab** (`GET /api/v1/events`, `live.ts`): core says "something changed" and the tab refetches
  that query. Wired to new notifications, mail, posts (on boards the person may read) and announcements. The
  counters poll only every 5 minutes while the stream is up and every minute when it is not.
- **If the stream is lost** (proxy that buffers, restart, no network) the shell says nothing and falls back to polling,
  reopening the stream with growing pauses. When it comes back, everything is refetched once to catch up.
- **Chat, the MUD and the Terminal reconnect by themselves** after a lost connection (1 s, 2 s, 4 s … 30 s, with jitter).
  A goodbye (quitting the MUD, the BBS's own Goodbye) stays closed. Chat rejoins the channels that were open; each
  reconnect gets a fresh one-use ticket.

## As built (M9-B): desktop feel
- **The browser tab** says where you are and what is waiting: "(3) Boards — Synths and modular · Site name" (the
  count is mail plus notifications, "99+" at most). The icon is the site mark in the theme's accent colour, with a
  red dot when something is unread; it is drawn in the page (`shell/tabInfo.ts`), so no image files and the colours
  follow the theme.
- **Windows come back.** The open windows, their order, where each app was, and maximized/minimized are kept per
  person (`ui:session:v1`) and restored on the desktop. Logging out clears them.
- **Real links from windows.** A link inside a window has the app's own address, so "copy link" and "open in new
  tab" work; a plain click stays in the window. Each window has its own **Back and Forward** (title-bar buttons;
  Alt+Left and Alt+Right inside the window). A window's title and the tab show where you are inside the app
  (`useSubtitle`): a board's name, a thread's subject, a profile, a conversation.
- **Window handling:** resize from any edge or corner; drag to the left or right edge to take half the screen,
  to the top to fill it (a preview shows where it will land); a short open animation (off for reduced motion).
  Right-click, or Shift+F10 / the Menu key, opens a menu on desktop icons, taskbar buttons and title bars.
- **`?` lists every shortcut.** Ctrl+K also finds threads (by their words), rings and mail subjects, and remembers
  the last few things opened.
- **Wallpaper**: dots, grid, stripes or plain, drawn in the theme's colours. Since 2026-10-05 it is kept on the account and can also be a picture (see "Wallpapers" below).
- **When things go wrong:** a banner when the browser is offline; a banner when the session has ended (a link to
  log in in a new tab, so what you were writing stays; it goes by itself when you are back). One app crashing shows
  "Reload this app" and leaves the rest of the shell alone. Failed loads offer "Try again" and are retried once
  (never a 4xx).
- **Alerts for a background tab** (Settings → Notifications, on this device, off until turned on): a desktop
  notification and/or a short chime made in the browser (no sound files). A notification says that something came,
  never what; nothing shows on a locked screen. A burst is one nudge.

## As built (M9-C): writing and reading

- **Editor** (`components/Editor.tsx`): the shared writing box. Counter from `maxLength`, Ctrl/Cmd+Enter sends, `@name`
  suggestions from `GET /mentions`, a `beforeunload` guard while there are unsent words, and drafts. Used by the board
  composer, post editing, and mail (new message and reply).
- **Drafts** (`drafts.ts`): kept in this browser only, key `ui:draft:<user>:<place>`, 30 days, newest 40, shown with
  "Draft restored · Discard", cleared on send and at logout. Never sent anywhere, so not part of the export. The
  homepage studio's code editor uses the same store for unsaved file changes.
- **Threads** (`apps/boards`): edit (author for 24 h, moderators any time with a reason) with "edited" and earlier
  versions on click; six word reactions; pin/unpin for ops; "Copy link" per post (`#p_…` scrolls to it);
  a "New since your last visit" divider, from a per-thread, per-device seen mark (`ui:seen:<user>:<thread>`);
  a "N new replies" pill when replies arrive over the live channel while the thread is open.
- **Boards search** lives in the address (`search/<words>`), with a board filter and relative times.
- **People hover card** (`components/HoverCard.tsx`): avatar, name, role, short bio, rings and "Send mail", after a
  short hover or on focus; Escape closes it. Shown on `PersonLink` to signed-in people only.
- **Mail**: search and an unread-only filter over the 200 newest conversations (done in the browser), handle
  suggestions in the To field, quote-reply, drafts, and the conversation opens at its newest message.
- **Chat**: Tab finishes a nick (again to cycle), typing notices (IRCv3 `+typing`, below), a "New messages" divider,
  day separators, "jump to newest", click a nick for a private chat, `/help`, `/away`, `/whois`, and replayed history
  is not read out line by line (the log is not live for the first 1.5 s of a buffer).
- **Files**: choose or drop up to 20 files with a progress bar each, search and sort, image previews (png, jpeg,
  gif, webp up to 2 MB), copy link, and the uploader can edit title and description.
- **Studio**: upload progress, asks before replacing a file, leave guard and autosaved drafts in the editor, and a
  copy button for the asset snippet.
- **BBS** shows "(edited)", "[pinned]" and reaction counts (counts only; reacting is on the web).

## As built (M9-D): personal touches

- **Avatars**: one picture per person (PNG, JPEG or WebP up to 2 MB). Core decodes it with `sharp`, crops to 256×256 and
  stores a WebP under `FILES_DIR/avatars/<user id>.webp`; metadata is dropped and a non-image is refused. Served only to
  signed-in, confirmed people, by stable id (`GET /avatars/:id`). `GET /avatars` lists who has one (id → version) so the
  shell asks for pictures only where they exist; initials remain the fallback everywhere, and the BBS stays text.
- **Status line** (80 characters, no control characters) and an **away** flag: Settings → Profile, shown on the profile, the
  hover card, the directory and who's online. Not sent to IRC as AWAY, by decision (see `08`).
- **Profile page**: recent posts (public boards only), the homepage card (title and last update), rings, characters,
  copy link, and a coarse "here today / this week / a while ago" that the person can switch off. `users.last_seen_at` is
  now kept current while someone uses the site (written at most every ten minutes).
- **People directory** (`GET /people?q=&role=&offset=`): confirmed active people, most recent first; someone who hides
  their last-seen time is ordered by join date so the order does not give the time away.
- **What you are told about** (Settings → Notifications): replies, mentions and new threads on watched boards can each be
  turned off (nothing is made at all: not in the list, the badge or a browser alert); boards can be muted from their page
  (a mention still gets through); mail conversations can be muted (kept in the inbox, not counted as unread); an optional
  daily email summary appears only when the site has SMTP. Defaults are everything on.
- **On this device** (localStorage, not exported): Chat (timestamps, join/leave lines), Boards (default view, reactions),
  Terminal (text size, reader mode).

## As built (restyle, 2026-10-02)
The owners picked every look from the design board (canvas and proposal linked in `17`), with Webring as
the default. Modern and Amber are retired: saved choices move to Webring and Terminal (migration 0031,
the site config and browser storage all accept the old names).
- **Names**: `webring`, `after-dark`, `terminal`, `platinum`, `aqua` (one list, `THEMES` in
  `packages/shared`). Terminal's screen colour (`amber`, `green`, `white`, `ice`, `ansi`,
  `amber-magenta`, `paper`, `dusk`) is saved on the profile as `theme_variant` (`13`), exported (`12`).
- **Tokens** (`packages/ui-themes`): colours (with `fill` for primary buttons and selected things, `pop`
  for what is new, five `sticker` colours), window chrome (title colours and a title image for
  Platinum's stripes and Aqua's gloss, window-button corner), five font roles, and shape (corners,
  outline widths, hard or soft shadows, `shadowPop` for toasts, a small `tilt` for stickers). A unit test
  checks 25 text pairs at 4.5:1 and 4 edge pairs at 3:1 in every theme and screen colour, and that the
  Terminal window's 16 colours are readable in every screen colour.
- **Components** take their shape from tokens only: outlined buttons that drop into their shadow when
  pressed, one outside focus ring, boxed tabs with the current one filled and lifted, outlined cards and
  panels, alerts with a full border in their colour, toasts with the pop shadow, app icons as stickers.
- **Chrome**: a few rules key on `data-chrome` (`zine`, `terminal`, `platinum`, `aqua`, set from the
  theme, never the theme's name): Platinum's centred title on stripes and bevelled buttons, Aqua's round
  lights on the left and dock of open windows, Terminal's headings set into the box line.
- **Modifiers** (this device only): effects; spacing (roomy or compact, every theme); Terminal's box
  style (single, double, heavy, none; double brings the pixel heading font).
- **The Terminal window** uses your Terminal screen colour in every theme (an xterm theme built from
  `terminalPalette`), and follows a change made in Settings while it is open.
- **Fonts** are bundled with `@fontsource` (all OFL-1.1, `17` V10), so `font-src 'self'` is unchanged.
  A browser downloads only the faces the current theme uses.
- People's homepages, widgets and templates keep their own styling.
- **The apps** (R3) follow the board mockups with the same structure in every theme: a panel's first
  heading row is a title strip in the first sticker colour (Terminal sets it into the box line); the
  home greeting is big with a block cursor in `pop`, and the wall is a tilted sticker; a thread has a
  big title, a PINNED sticker, posts in the body font, metadata in the label font, and quieter nested
  replies; the front page shows the site name huge with an "Invite only" sticker when sign-ups are by
  invite; a profile is a card with a big avatar, the status as a speech bubble and rings as tags; admin
  status tiles show big numbers. Tables stay plain.
- **Phones** (R4): Webring and After dark use 2 px outlines and 3–4 px shadows under 700 px wide (the
  theme's `phone` tokens). The tab bar has dividers, and the current tab gets a bar on top as well as its
  fill, so it stands out in every theme. Profiles stack, and the big headings are a step smaller.
- **The note about the new look**: signed-in people see one dismissible note, once per device, saying
  the site has a new look, with a link to Settings, Appearance. It is part of the shell, not an
  announcement, so no site shows copy its admins didn't write.
- **Sizes** (2026-10-02): main file 233 KB (68 KB gzip), vendor 226 KB, stylesheet 105 KB (most of it
  `@font-face` rules). 57 font files, 638 KB in all, but a browser fetches only what the current theme
  uses; Webring's Latin faces are 88 KB.

## As built (polish, 2026-10-02)
- **Windows**: resize from all four edges and corners (8 px sides, larger corners); snap by dragging to an edge or corner, from the title bar
  menu (also Shift+F10 on the title bar), or with the keyboard on the focused title bar (arrows move, Shift+arrows resize from the right
  and bottom edges, Ctrl+Shift+arrows from the left and top, Alt+Left/Right snap to a half, Alt+Up/Down maximize and restore). Snap zones: left, right, top half, bottom half and the four quarters. Apps marked `.app-fill` (Chat, MUD, Terminal)
  fill the window instead of scrolling inside it.
- **Container layout**: Chat and the MUD are CSS containers, so a narrow window on a wide screen gets the compact layout (people list behind a
  button; the MUD side panel under the log). Phones keep their own layout.
- **Settings**: every tab uses the same section (`Section`: panel, heading, optional "Saved to your account" / "This device only" badge);
  on/off choices are switches (`role="switch"`); selects share one look everywhere.
- **Terminal window**: toolbar with Copy, Paste, Find and Full screen; Ctrl+Shift+C/V; optional copy on select; clickable links; a find bar;
  scrollback (1000–10000) and bell (off, flash, sound) choices; the BBS sets the window subtitle; phone keys gained Ctrl/Alt latches,
  Home/End/PgUp/PgDn and F1–F10; a keepalive so idle proxies don't drop it.
- **Chat and MUD**: see `08` and `09` (alerts, history, person menu; the MUD's rules, panel and map). The tab title counts chat mentions and
  private messages as well as mail and notifications.


## As built (installable apps, 2026-10-04)
People add apps to their own desktop. Admins choose which the site offers; each person adds the ones they want.
The format is built for outside authors later (Q18), but only the site's own packages exist for now.
- **A package** is a folder: `manifest.json` (`id`, `name`, `version`, `description`, one SVG path as the `icon`,
  a `sticker` slot for the tile colour, `entry`, `permissions`) and static files. First-party packages live in
  `packs/apps/{id}` and build into `packs/build/{id}`; core syncs the catalog from `APPS_DIR` at start. A new
  package is offered until an admin withdraws it; one that leaves the folder is hidden, and people's data stays.
- **Running** (docs/15): a sandboxed frame from the homes origin, with no network and no storage of its own. It
  talks to the shell over `@app/app-sdk` (Penpal): `storage.list/put/delete`, `profile()`, `setTitle`, and
  `toast(text, { undo })`, which uses the shell's own notes and resolves true if Undo was pressed. The shell pushes
  the theme as CSS custom properties (`--bg`, `--surface`, `--text`, `--accent`, `--font-body`…) on connect and on
  every theme change, so apps match all five themes.
- **In the shell** an added app is `app:{id}` in the registry (`shell/apps.tsx`, `shell/installed.ts`). It gets a desktop icon,
  a launcher tile, an apps menu entry, a palette entry, a window, and its own page at `/apps/{id}`, like a built-in app.
  Windows for an app that is removed or withdrawn close themselves; session restore waits for the list of added apps.
- **Add apps** (a built-in app at `/add-apps`) lists what the site offers with each app's permissions in plain words
  ("Keeps its own things on your account. They are in your export."). Add, Open, Remove (with Undo). Removing keeps the app's
  data, so adding it again brings it back; "Delete what it kept" is separate, and waits a few seconds for an Undo.
- **Admin console → Apps**: each package with its version and how many people have it, and an "Offer" checkbox
  (`app.offered` / `app.withdrawn` in the audit log).
- **Todo** is the first package: add, tick, edit, delete with Undo, clear done, an "N left" count in the window title.
  Each task is a document in its `items` collection. About 11 KB of script, no framework.
- Not in the BBS yet (two front doors, docs/04): a terminal view of app data is a later option.

## As built (React 19, 2026-10-04)
- React 19.3 with the React Compiler, so components re-render only what changed without hand-written `useMemo`/`useCallback`.
  New code needn't add them; existing ones are harmless and can go as files are touched.
- Bundles: `vendor` (React, the router, TanStack), `widgets` (React Aria, Sonner, cmdk: about 81 KB gzipped) and the
  main chunk (about 91 KB gzipped) are separate files, so a release of our own code doesn't make browsers fetch the
  libraries again.

## As built (instant feel, 2026-10-04)
- **TanStack DB pilot** (`collections.ts`): a Mail conversation's messages and the board list are collections read with
  `useLiveQuery`. A reply shows at once as "Sending…" and the server's copy replaces it; a refusal removes it, puts
  the text back in the box and says why. Deleting a message marks it deleted at once. Watching a board and "Mark all
  read" change at once. Collections use the same Query keys and response shapes as the rest of the app, so live
  events and other screens refresh them as before.
- **Optimistic updates elsewhere** (TanStack Query, with the change made in the click itself so a controlled input
  never snaps back): reactions, muting a board, marking notifications read, the admin Apps checkbox. Settings
  switches already worked this way. Not optimistic on purpose: joining a ring (it may need approval) and poll votes
  (the tally comes from the server).
- **No "Loading…" flash** on search and filter lists (mail, people, rings, homepages, board search): the last
  results stay while new ones load.
- **Prefetch**: resting the pointer on a thread link (or focusing it) loads the thread. Not for mail: opening a
  conversation marks it read, so loading one early would too.
- **Minimized windows** keep their state but pause their effects (polling, timers) with React's `<Activity>`. Apps
  that hold a connection (Chat, MUD, Terminal, added apps) keep running.
- **Moving between screens** cross-fades for 140 ms with the View Transitions API; nothing moves, and nothing at all
  with reduced motion.
- **Long logs** (chat and MUD, up to 2000 lines; long threads) use CSS `content-visibility: auto` rather than a
  JavaScript virtual list, so screen readers' live announcements, the browser's find and the MUD's find still see
  every line.

## Interface writing rule and "act now, Undo" (2026-10-05)
The interface should read like it was written by someone who uses it, not generated: short, plain, and only where
a person would otherwise go wrong.
- **A line under a field or heading** is one plain sentence, 150 characters at most, and only for what a person
  would otherwise get wrong ("It cannot be changed later."). Nothing that restates the label, the heading or the
  button. `hints.test.ts` finds every hint and holds it to the length.
- **Longer help** goes behind a "?" beside the heading (`components/HelpTip`, a React Aria popover: Escape closes it,
  focus goes back). The MUD client rules' per-tab explanations are the first use.
- **No "Keys:" lines.** Every shortcut is in the shortcuts sheet (`?`).
- **One line says where settings live** ("Settings are kept on your account, except the ones marked 'This device
  only'") at the top of Settings, instead of a badge on every section; only the exception is marked.
- **Reversible actions don't ask first.** The screen changes at once and a note offers Undo for six seconds
  (`undoable()` in `components/feedback`); the request is sent when the note's time is up, or when the person leaves
  the page. Used for removing an SSH key, deleting your own file, mail message or ring banner, and blocking someone
  (Undo unblocks). A dialog (`confirm()`) is kept only for what can't be taken back: deleting the account, leaving
  a mail conversation, handing over a ring, hiding or removing other people's content, replacing a file,
  discarding unsaved edits, and sending a long paste to chat.
- Before and after, by count: hint paragraphs 138 → 128, with the long ones cut or moved behind a "?", `confirm()` calls 18 → 13,
  "Keys:" lines 2 → 0.

## As built (forms, 2026-10-05)
- **`components/Form.tsx`**: `useZodForm`, `<Form>`, `<Field>` and `<CheckField>` on TanStack Form, using the shared zod schemas
  (`@app/shared`), so the browser applies the same rules as the server and says the same words (`emailSchema` has one plain
  message for both). A field's mistake shows when the person leaves it and goes as they fix it. Pressing the button with
  mistakes shows all of them. The button is **not** switched off while the form is invalid: a button that is off with no word
  about why leaves a person stuck (and screen readers skip it). It is off only while the request is on its way.
- **Server errors** use the documented `{ code, message }` shape, which has no field name, so the form maps an error *code*
  to its field (`serverFields`: `handle_unavailable` → handle, `email_taken` → email…). Any other error shows once, under
  the form, in the server's own plain words.
- Converted so far: sign-up, change password, forgot and reset password. Not converted, on purpose: the login page
  (several steps, and redirects that must run once), and the many one-field forms that already validate on the server
  (a rename, an add-a-handle box); they can move over as they are touched.

## As built (Studio editor, 2026-10-05)
- The editor (CodeMirror 6) adds: HTML and CSS completion (tags, attributes, properties), **Emmet** abbreviations offered as a
  suggestion (not bound to Tab, so Tab still leaves the editor), the **site's widgets** ("widget-guestbook" fills in the
  script line with your handle and the site's address), search and replace (Ctrl/Cmd+F), and a **lint** with a gutter for the
  usual mistakes: a tag that is never closed or closed in the wrong order, a picture with no alt text, an `http://`
  address on an https page. Messages are in the plain voice.
- **Live preview**: the text as typed, a moment after the last key, in the preview frame, from the homepage origin
  exactly as it will be published (your saved files around it, the draft in its place). The published page changes only
  when you save. Your unsaved text is also kept in your browser (existing), so a closed tab doesn't lose it.

## As built (installable site and push, 2026-10-05)
- **Installing.** The page links a manifest that core makes from the site config (`GET /api/v1/site/manifest.webmanifest`: the name, `start_url /`, standalone, the theme colour), with icons drawn from the site's mark (`/api/v1/site/icon-192.png`, `icon-512.png`, `icon-maskable.png`, rendered once by sharp). Nothing in the shell build names the site. The mark lives in `packages/shared` (`siteMarkSvg`), which also draws the tab icon.
- **Service worker** (`apps/shell/src/sw/sw.ts`, built by vite-plugin-pwa with `injectManifest`; registered in production builds only):
  - It keeps the page and its entry files when it installs. Every other shell file (an app's code, fonts) is kept the first time it is fetched; their names carry a hash, so a kept copy is never stale.
  - Any shell address opens the kept page without a connection, which shows the offline banner. `/api`, `/oidc`, `/ring`, `/widgets` and `/ws` always go to the network. Nothing from `/api` is ever stored, so no one's data is left on a shared computer.
  - The server paths skip the worker entirely where the browser supports static routing (`addRoutes`, Chrome 123+). A request the worker sees can be dropped when its page closes, and that lost what Undo sends on leaving. Requests made while the page is being left are `keepalive`.
  - The last public site config is kept on the device (`site:last`), so the shell can open without a connection. It holds nothing about the person.
  - A new version waits until every tab of the old one is closed (no `skipWaiting`), so a page never runs half old and half new. Caddy sends `/sw.js` with `no-cache` and `/assets/*` as immutable.
- **Push notifications** (decided 2026-10-05):
  - **Settings → Notifications → Push on this device**: a switch, and which kinds this device hears about: mail, replies, mentions, new threads on watched boards. **Other devices** lists the rest with Remove (acts at once, with Undo). The section is hidden when the site has no VAPID keys.
  - A notification says who and where ("bob replied to you in Lounge", "bob sent you mail") and never the text of a post, a letter or its subject. Clicking it opens that place, reusing an open tab. A tab that is open and in front gets no push, since it already shows its own note and chime.
  - It follows the site's notification settings: a push goes only where a notification was made (so kinds switched off, muted boards and blocks apply), and mail only where the conversation isn't muted.
  - A device belongs to the session that turned it on. Logging out deletes it, and so do a password change or reset and a suspension (every session but the current one). A push only goes to a device whose session is still signed in, so a shared computer stops getting someone's notifications when they log out.
  - Core sends through graphile-worker (`push_send` jobs, five tries with backoff). A device the push service says is gone (404/410) is forgotten. Payloads are encrypted (aes128gcm) with the device's keys and signed with the site's VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`; `cli vapid-keys` makes a pair, and `sitectl doctor` warns when they are missing).
  - Each person can have up to 10 devices; an eleventh replaces the oldest. A browser shared by two accounts belongs to whoever turned push on last.
  - The export lists devices without their push address or keys (`settings/push-devices.json`).
  - Not yet: admin alerts (new reports, applications) as push, and chat.

## As built (wiki, 2026-10-05)
The Wiki app (`apps/shell/src/apps/wiki/`, public) is described in `20`. It has pages, an editor with a live preview (a tab on phones) and drafts on the device, history, compare, put a version back, recent changes (with a Feed link), all pages, wanted pages, what links here and search. A link to a page that doesn't exist yet says "(no page yet)" to screen readers as well as showing a different colour. When a save conflicts, the app shows "Someone saved this page while you were editing" and keeps your text in the editor next to theirs.

## Wallpapers (2026-10-05)
Settings → Appearance → Desktop wallpaper. The choice is kept on the account, so it follows the person to other devices.
- **Patterns:** dots, grid, stripes and plain, drawn in the theme's colours.
- **The site's pictures:** two tiles (paper stars, slate stars) and five scenes (hillside, harbour lights, lanterns,
  lantern hill, the tower). They live in `apps/shell/public/wallpapers/` with thumbnails, and are listed in
  `WALLPAPER_PRESETS` in `packages/shared/src/wallpaper.ts`. A tile repeats; a scene fills the screen.
- **Your own picture:**
  - Upload one (PNG, JPEG, GIF or WebP, up to 8 MB), or paste a web address. Core copies the picture once (`15`, safe
    fetch), so the shell never loads anything from another site, and the other site never learns who looks at it.
  - It is drawn again as a WebP at most 2560 pixels wide.
  - It is shown only to its owner (`/api/v1/me/wallpaper/image`), so it is not public content: no reports and no
    audit. It is in the export.
  - Choices for fit: fill the screen, tile, or centre.
  - Signed out, someone's own picture can't be shown, so the desktop goes back to dots.
- **Code:** `apps/core/src/wallpaper.ts`, `apps/shell/src/apps/settings/WallpaperPicker.tsx`, and `applyWallpaper`
  in `theme.ts`. The last choice is kept in `localStorage` so the desktop looks right before the account answers.

## Pictures (2026-10-05, redone 2026-10-06)
Every picture on the site is drawn by an image model and then printed with `tools/art/riso.py` as a two-ink risograph
in the Webring inks: cream paper, black and fluorescent pink (see its README). None has people, animals or other
characters, and none has text. They are decorative (`alt=""`), so screen readers hear only the words beside them.
Files live in `apps/shell/public/art/` and `apps/shell/public/wallpapers/`.
- **Front page:** `art/hillside.webp`, a hillside village joined by telephone wires (Grok Imagine 2.0, linocut).
- **Not found:** `art/lost.webp`, a card-catalogue drawer with one card missing (Grok Imagine 2.0).
- **Empty places:** `EmptyState` takes `art`: `mail` (an empty mailbox), `notebook` (blank pages, wiki), `folder` (files)
  and `campfire` (two empty chairs, rings). Drawn by Recraft V4.1. Without `art` it keeps its icon.
- **Rings:** `art/rings.webp`, lantern-lit pools joined by paths, as a banner. **MUD:** `art/tower.webp` by the tips.
- **Wallpapers:** hillside, harbour lights, lanterns, lantern hill and the tower are the same drawings printed lighter
  (`--density 0.6`) so windows and text sit on them. The two drawings that are mostly black (hillside, lanterns) are
  printed as negatives: the black field becomes paper and the carved lines become ink.
- Model sources are kept outside the repo; only the printed results are committed.

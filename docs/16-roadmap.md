# 16 — Roadmap

Each milestone ends with something runnable. Tasks are sized for Claude Code, one at a time.
**v1 = M1–M4.** IRC is M5, the MUD M6, console depth M7, and the in-house BBS is **last (M8)**.

*M0 (Enigma½ spikes) is retired: on 2026-09-29 we decided to build our own BBS instead of
embedding Enigma. The spike is kept in `docs/spikes/m0-enigma.md` for reference.*

## M1 — Core & shell skeleton
1. Monorepo scaffold, compose (postgres, redis, caddy, core, shell), CI.
2. Config system: `site.*` from config, strings package, placeholder-name grep test.
3. Accounts: signup (invite mode), email verify, login, sessions, argon2id, TOTP for admins, with recovery codes, single-use codes and password reset.
4. OIDC provider with `role`, `role_rev`, `ops` claims. (Built; its first consumer is IRC in M5.)
5. Roles, scoped ops, audit log, event bus. (Done before the OIDC provider: its `ops` and `role_rev` claims
   depend on them.)
6. Shell: window manager, launcher, routing, mobile layout, modern + amber CRT themes.
7. Settings app (profile, passwords, theme; terminal password and SSH keys arrive with IRC).
8. Admin console v0: users table, dossier (basic), promote/suspend, invites, audit list.
**Accept:** fresh setup → admin invites a user → user signs up → admin promotes → audit shows all; works on phone.
**Status: done (2026-09-29).** Tasks 1–8 are built. `e2e/tests/acceptance.spec.ts` runs the accept line on a desktop browser and a phone. Not yet verified: the compose stack and Docker images (no Docker daemon was available); CI builds them.

## M2 — Boards
1. Board registry, trusted-only creation with quotas, visibility rules.
2. Posts in Postgres: threads, replies, full-text search, per-user read state.
3. Boards app in the shell: list, threads, composer + preview, lurking.
4. Notifications (replies, @mentions, watched boards).
5. Moderation: reports, hide/lock/move, board ops, mod log.
6. Admin console: moderation queue, boards list.
**Accept:** tests in `05`.
**Progress:** tasks 1–3 built (backend with `boards.test.ts`; the Boards app with `e2e/tests/boards.spec.ts`, including accessibility scans in both themes). Notifications (4) built: reply, mention and watched-board notifications, a Notifications app and a bell in the taskbar. Moderation (5) and the console's reports queue and boards list (6) built: hide, unhide, remove, lock, move, undo, reports with routing and escalation marks, the mod log, and board ops. **M2 is complete except the terminal side, which is M8.** Warn/mute are not built (`03`). Posts must join the export in M4 (`12`).

## M3 — Homepages & rings
1. Homes origin, per-user subdomains, quotas.
2. Homepage studio, templates, asset library.
3. Widgets: guestbook, counter, last-updated, online.
4. Rings: found/join/leave, ring board, ring page, nav bar, ring ops, directory.
5. Custom domains with verification + on-demand TLS.
6. Admin console: rings, homepages service page.
**Accept:** tests in `06` and `07`.
**Progress:** tasks 1 to 3 built (files, quotas, serving, redirects, templates, studio with editor and preview, asset library, widgets, guestbook, directory, reporting; `homes.test.ts`, `widgets.test.ts`, `studio.spec.ts`, `homepages.spec.ts`). Task 4 (rings) built (`rings.test.ts`, `rings.spec.ts`), and task 6's rings and homepages pages are in the console. Custom domains (5) built: add, verify by TXT record (fake resolver in tests), served on the verified name, `ask` endpoint for Caddy. Admin rename (which fills `handle_history` so the 90-day redirect is real) is built too. **M3 is complete** except what cannot be checked here: Caddy's on-demand TLS against a real domain, and the compose stack (no Docker). Q3 decided (JS allowed, report footer injected).

## M4 — Ownership & console polish (completes v1)
1. Export worker + archive format + signature; "exporter registered" CI check.
2. Account deletion flow.
3. Versioned settings with rollback; announcements to the shell.
4. Status board with live tiles; metrics rollups; backups page with restore-test results.
5. Legal pages, report/takedown flow, signup age gate (per `17` decision).
**Progress:** tasks 1 and 2 built (export worker, format, signature, the exporter check; account deletion), with `exports/*.test.ts`, `deletion.test.ts` and `data.spec.ts`. Task 3 built (versioned settings with preview and rollback; announcements): `settings.test.ts`, `announcements.test.ts`, `config.spec.ts`. Task 5 built: the signup age tick-box, legal pages with versions, and the public takedown form with an admin queue (`legal.test.ts`, `legal.spec.ts`). **M4 is complete.** Task 4 built: hourly `metrics_rollup`, the Status tab (live tiles polled every 15 s, sparklines, plain-worded warnings) as the console's home, `cli backup|restore-test|backup-key`, and the Backups tab with restore-test checks.
**Accept:** export round-trip test; settings rollback works; status board live.

## M5 — IRC
Ergo container, provisioning/auth, ring channels, Chat app, presence, IRC console page,
announcements to `#lobby`.
**Progress:** built. Ergo 2.19.1 with a generated config and core's auth-script; terminal passwords and
one-use chat tickets; the sync bot (official, ring and trusted users' channels, ops, suspensions, held
handles); the Chat app; presence; the console's IRC tab; announcements to `#lobby`. Tests run the real
Ergo: `irc/auth.test.ts`, `irc/sync.test.ts`, `chat.spec.ts` (desktop and phone, accessibility in both
themes). The compose services (`irc-config`, `ergo`) and TLS for native clients are written but not run
here (no Docker).

## M6 — MUD
Engine decision, container, auth backend, builders, MUD window, console page, MUD broadcasts.
Separate world-design doc first.
**Progress:** built. Spike and world design (`spikes/m6-evennia.md`, `18`); Evennia 5.0.1 in `services/mud`
signing in through core (terminal password or one-use ticket); core pushes renames, roles, builders,
suspensions and deletions; EvAdventure characters (3 per account) with our rules (no permanent death, safe
town, turn-based combat against monsters) and a starting town with monsters; the MUD window; the console's MUD
tab with builders; announcements to the MUD; characters in the export; the MUD's database in backups.
Tests: `services/mud/tests` (Evennia's runner), `mud/*.test.ts` against a real Evennia, `mud.spec.ts` (desktop
and phone, both themes). The container and compose service are written but not run here (no Docker). Not built:
duels, working shops, the tavern guestbook and noticeboard, quests.
Owners' direction (2026-09-30): keep the MUD at this minimum and build its content later; what matters now is that
characters are usable around the site. Built: core's copy of characters, public profiles (People app) with
characters, a featured character shown beside the author on board posts (`characters.test.ts`, `mud.spec.ts`).

## M7 — Console depth & extras
Audit replay with diffs, stats cohorts, heatmaps, command console; private mail; web file
areas; Gopher/Gemini mirror; more themes; vouching.
**Scope (owners, 2026-09-30):** private mail with small group threads; vouching (two trusted vouches, admin
confirms); web file areas; a read-only Gopher mirror. Not in M7: Gemini, new themes.
- [x] Private mail: conversations of 2–10 people, add/leave, blocks, delete own, report one message, export and
  deletion (`mail.test.ts`, `mail.spec.ts`; design in `10`).
- [x] Vouching: two trusted vouches, admin confirms from the Vouches tab with eligibility hints, sponsor flags
  within 90 days (`vouches.test.ts`, `vouches.spec.ts`; design in `03`).
- [x] Web file areas: admin-made areas, trusted uploads with quotas, download-only serving, reports and hiding,
  backups, export and deletion (`files.test.ts`, `files.spec.ts`; design in `05`).
- [x] Console depth: audit replay with diffs, stats (DAU/WAU/MAU, retention cohorts, posting heatmap, CSV), command
  console mapped to core functions and audited (`console.test.ts`, `diff.test.ts`, `console.spec.ts`; design in `11`).
- [x] Read-only Gopher mirror of public boards, homepages and file areas (`gopher.test.ts`; design in `05`).
- [x] Old-internet bundle (2026-10-05, design in `05`): Gemini mirror (`gemini.test.ts`), finger with .plan (`finger.test.ts`), Atom feeds (`feeds.test.ts`), the plan in Settings and the export (`imports.test.ts`, `e2e/tests/oldnet.spec.ts`).

## M8 — BBS (in-house, last)
Design in `04`. Depends only on core's API, so it can start once M4 is done; it is scheduled
last by decision, not by dependency.
1. Service scaffold: telnet, SSH and WebSocket listeners; telnet negotiation and terminal
   detection; sessions; node and per-IP limits.
2. Auth: terminal password via core `verify`, SSH keys, login ticket for the web terminal;
   drop sessions on suspend and role change.
3. Art pack templated with `site.name`; declarative menu config.
4. Boards in the terminal: list, read (threaded/flat), new-scan, post, reply with quoting,
   line editor.
5. Who's online, last callers, rings and homepages menus; presence to core.
6. Shell Terminal window: xterm.js, VGA font, mobile key bar, negotiation shim.
7. UTF-8 and CP437 modes.
8. Admin console: BBS service page (live nodes); MOTD and announcements publish to the BBS.
9. Private mail in the terminal; SSH keys in Settings → Terminal (owners, 2026-09-30).
10. Door games: drop files, sandboxed child process, operator config.
11. QWK offline mail: packet download, REP upload.
**Accept:** tests in `04`.
**Built (2026-09-30):** all of the above, with the M8 additions; every acceptance test in `04` is covered by
`apps/bbs/src/bbs.test.ts` (live, over real telnet, SSH and WebSocket connections against core) or
`e2e/tests/terminal.spec.ts`. Not built: ZMODEM in the terminal (QWK packets move over the web), a bundled VGA
font, door games checked against a real DOS door.

## Launch readiness (2026-09-30, owners' choice after M8)
- [x] Q9: 30 days of chat history, own messages in exports (`08`).
- [x] Security review: private-by-default routes, headers and CSP, terminal guess limit, zip-bomb guard,
  audit-log database role, dependency audit in CI (`15`).
- [x] Production deploy: `compose.prod.yaml`, `sitectl`, runbook (`19`).
- [x] Load test: ~1,000 requests/s, no errors, on one core process (`19`).
- [ ] Before opening: run `sitectl doctor` on the real server, point real DNS and SMTP, pick the name (Q1),
  have counsel review the legal pages (Q7), decide funding (Q8); check QWK with real readers and a real door.

## Design pass (2026-10-01, owners' choice)
- [x] Design foundation: tokens, type and spacing scales, refreshed modern palette (`10`).
- [x] Shared components: confirm dialog, toasts, empty and loading states, back links, tabs, side nav, avatars, relative times.
- [x] Shell: taskbar clock and online count, Ctrl+K palette, Alt+` window cycling, snapping, menu keyboard, phone tab bar, admin default theme.
- [x] Home panel and landing page (`GET /landing`).
- [x] App sweep: boards, mail, notifications, people (who's online), rings, files, settings, admin side nav.

## M9 — Finishing touches (2026-10-01, owners' choice) — DONE
The owners picked all four web areas and all three retro extras, and approved a push channel. Built in phases, each tested and pushed:
- **A, live updates**: `GET /events` (server-sent events) with hints that carry no content; chat, the terminal and the MUD reconnect by themselves.
  Checked with 100 open streams on one core process (`apps/core/src/live-load.test.ts`; `scripts/load-test.mjs --streams N` for a real site).
- **B, desktop feel**: windows remember themselves, real links from windows, back/forward, snapping and edge resize, tab title and favicon, desktop alerts, recovery banners, shortcuts sheet, wallpapers.
- **C, writing and reading**: the shared Editor with drafts and @mentions, editing with history, pins, reactions, post links, hover cards, mail search/quote/suggestions, chat Tab completion and typing, files and studio upgrades.
- **D, personal touches**: avatars, status line, richer profiles, a people directory, notification choices and mutes, a daily digest, device settings.
- **E, retro extras**: oneliners, bulletins, the voting booth and file areas in the terminal and on the web; counter looks, the 88×31 button maker, blinkies, ring banners and "sign with your account" for homepages; the Bandit Woods and the Flooded Mine, the lost-ledger quest, a working shop, a tavern noticeboard and a weakened effect that changes rolls.
Details are in the "As built (M9-…)" section of each doc and the dated entries in `17`. Phase G (2026-10-02) closed the loose ends: server-side mail paging, the tavern guestbook, duels in the training yard, and IRC AWAY (decided: web-only, see `08`). Phase H (2026-10-02) polished what the first look showed: tidy post headers and reply indents on phones, a calm admin status on a new site, no failing request for visitors, a smaller first load (main file 482 KB → 223 KB), `StudioApp` and `SettingsApp` split into per-tab files, and accessibility scans for the M9 screens in both themes. Left open on purpose: the older items Q16, federation, ZMODEM and import; in-game builder commands other than removing notes and guestbook lines are not audited.

## Restyle (2026-10-02, owners' choice) — DONE
The owners picked every look on the design board, with Webring as the default (`17` D18).
- **R1:** five themes and eight Terminal screen colours, with the old names mapped to the new ones (migration 0031). Also bundled open-licence fonts, and Settings, Appearance with theme cards, screen colour, effects, spacing and box style.
- **R2:** components, windows, the taskbar and app stickers take their shape from tokens, with chrome rules for Platinum, Aqua and Terminal. The Terminal window uses your screen colour.
- **R3:** every app follows the board mockups: title strips, home, threads, the front page, profiles and admin.
- **R4:** phone sizes, the one-time note about the new look, and full checks (axe in every theme on desktop and phone).

Details are in `10` ("As built (restyle)").

## Import and terminal sign-up (2026-10-02, owners' choice)
- **I1:** bring back an export: preview, then restore what is yours alone (`12`).
- **I2:** sign up from the terminal (`04`).

## Polish (2026-10-02, owners' choice) — DONE
- **P1:** admin 2FA is optional, a site setting that is off by default (`17` D19, `02`, `15`).
- **P2:** every window resizes from every edge and corner and snaps to halves and quarters (mouse and keyboard); apps fill their window. Settings tabs share one section pattern, with switches and "saved to your account / this device only" labels.
- **P3:** Terminal: copy and paste, find, clickable links, scrollback and bell choices, the BBS title in the window, more phone keys, keepalive (`10`).
- **P4:** Chat: alerts for mentions and private messages, older history on scroll, remembered private chats, nick colours and a person menu, away, ignore and highlight words kept on the account (`08`).
- **P5–P6:** the MUD sends vitals, room info and a map of visited rooms (also over GMCP), and the web client gained gauges, a mini-map, exits as buttons, full colour, links, split scrollback, find, saving the log, and rules (aliases, triggers, timers, keys, buttons, variables) kept on the account (`09`, `17` D20–D21).
- **P7:** chat and MUD follow the size of their own window; logging back into the MUD enters the character you made instead of an error.

## The tower (2026-10-03, owners' choice)
The MUD becomes a procedurally generated tower (`18`, `17` D22).
- [x] **T1:** the generator: seeded floors, stair guards, the gate in town, a map per floor, retiring the woods and mine, and a text check.
- [x] **T2:** enemy families and scaling, bosses, and a fight simulator for balance (also: rewards, levels, `rest`).
- [x] **T3:** gear: item bases, rarities, affixes and personal drops (with spoils for a full pack).
- [x] **T4:** checkpoints, losing run loot on defeat, and monthly seasons (with landings, `ascend` and `season`).
- [x] **T5:** a leaderboard on the site (home panel, console, profiles), export additions.

## Wiki (2026-10-05, owners' choice) — DONE
The site wiki and ring wikis (`20`).
- [x] **K1:** the markup parser (shared) and core: tables, rules, routes, history, conflicts, moderation, export, deletion.
- [x] **K2:** the Wiki app in the shell.
- [x] **K3:** read-only in the BBS, Gopher and Gemini; an Atom feed of recent changes; docs.

## Later phases (not scheduled)
BBS file areas, doors, QWK/offline mail, FTN echomail (scope: Q13). Desktop "point" app; self-hosted nodes; hub-and-spoke federation with
this site as hub.

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
**Progress:** tasks 1–3 built (backend with `boards.test.ts`; the Boards app with `e2e/tests/boards.spec.ts`, including accessibility scans in both themes). Notifications (4) built: reply, mention and watched-board notifications, a Notifications app and a bell in the taskbar. Next: moderation (5), console (6). Posts must join the export in M4 (`12`).

## M3 — Homepages & rings
1. Homes origin, per-user subdomains, quotas.
2. Homepage studio, templates, asset library.
3. Widgets: guestbook, counter, last-updated, online.
4. Rings: found/join/leave, ring board, ring page, nav bar, ring ops, directory.
5. Custom domains with verification + on-demand TLS.
6. Admin console: rings, homepages service page.
**Accept:** tests in `06` and `07`.

## M4 — Ownership & console polish (completes v1)
1. Export worker + archive format + signature; "exporter registered" CI check.
2. Account deletion flow.
3. Versioned settings with rollback; announcements to the shell.
4. Status board with live tiles; metrics rollups; backups page with restore-test results.
5. Legal pages, report/takedown flow, signup age gate (per `17` decision).
**Accept:** export round-trip test; settings rollback works; status board live.

## M5 — IRC
Ergo container, provisioning/auth, ring channels, Chat app, presence, IRC console page,
announcements to `#lobby`.

## M6 — MUD
Engine decision, container, auth backend, builders, MUD window, console page, MUD broadcasts.
Separate world-design doc first.

## M7 — Console depth & extras
Audit replay with diffs, stats cohorts, heatmaps, command console; private mail; web file
areas; Gopher/Gemini mirror; more themes; vouching.

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
**Accept:** tests in `04`.

## Later phases (not scheduled)
BBS file areas, doors, QWK/offline mail, FTN echomail, terminal signup (scope: Q13). Import
of export archives; desktop "point" app; self-hosted nodes; hub-and-spoke federation with
this site as hub.

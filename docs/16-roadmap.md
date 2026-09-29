# 16 — Roadmap

Each milestone ends with something runnable. Tasks are sized for Claude Code, one at a time.
**v1 = M0–M5.** IRC is M6, MUD M7.

## M0 — Spikes
| # | Question | Done when |
|---|---|---|
| 0.1 | Can an Enigma module expose an API to create users/areas, post as a local user, read messages and pointers? | curl creates user, area, post; visible in telnet |
| 0.2 | Can Enigma login be delegated (ticket on WebSocket, external password verify)? | xterm.js page auto-logs-in |
| 0.3 | Can areas be added at runtime? | behaviour documented, approach chosen |
| 0.4 | Encoding over WebSocket and for UTF-8 posts | test strings render correctly |
Gate: bridge vs fallback decision recorded in `17`.

## M1 — Core & shell skeleton
1. Monorepo scaffold, compose (postgres, redis, caddy, core, shell), CI.
2. Config system: `site.*` from config, strings package, placeholder-name grep test.
3. Accounts: signup (invite mode), email verify, login, sessions, argon2id, TOTP for admins.
4. OIDC provider with `role`, `role_rev`, `ops` claims.
5. Roles, scoped ops, audit log, event bus.
6. Shell: window manager, launcher, routing, mobile layout, modern + amber CRT themes.
7. Settings app (profile, passwords, terminal password, SSH keys, theme).
8. Admin console v0: users table, dossier (basic), promote/suspend, invites, audit list.
**Accept:** fresh setup → admin invites a user → user signs up → admin promotes → audit shows all; works on phone.

## M2 — BBS
1. Enigma container, art pack templated with `site.name`.
2. Bridge module (per M0).
3. Provisioning + nightly reconcile.
4. Terminal app with ticket login, VGA font, mobile key bar.
5. Native telnet/SSH with terminal password and keys.
6. Admin console: BBS service page (live nodes, bridge health).
**Accept:** tests in `02` and `04`.

## M3 — Boards web view
1. Board registry, trusted-only creation with quotas, visibility → ACS.
2. Boards app: list, threads, composer + preview, lurking.
3. Pointer sync, search index, notifications.
4. Moderation: reports, hide/lock/move, board ops, mod log.
5. Admin console: moderation queue, boards list.
**Accept:** tests in `05`.

## M4 — Homepages & rings
1. Homes origin, per-user subdomains, quotas.
2. Homepage studio, templates, asset library.
3. Widgets: guestbook, counter, last-updated, online.
4. Rings: found/join/leave, ring board, ring page, nav bar, ring ops, directory.
5. Custom domains with verification + on-demand TLS.
6. Admin console: rings, homepages service page.
**Accept:** tests in `06` and `07`.

## M5 — Ownership & console polish (completes v1)
1. Export worker + archive format + signature; "exporter registered" CI check.
2. Account deletion flow.
3. Versioned settings with rollback; announcements to shell + BBS.
4. Status board with live tiles; metrics rollups; backups page with restore-test results.
5. Legal pages, report/takedown flow, signup age gate (per `17` decision).
**Accept:** export round-trip test; settings rollback works; status board live.

## M6 — IRC
Ergo container, provisioning/auth, ring channels, Chat app, presence, IRC console page,
announcements to `#lobby`.

## M7 — MUD
Engine decision, container, auth backend, builders, MUD window, console page, MUD broadcasts.
Separate world-design doc first.

## M8+ — Console depth & extras
Audit replay with diffs, stats cohorts, heatmaps, command console; private mail; web file
areas; QWK export; Gopher/Gemini mirror; more themes; vouching.

## Later phases (not scheduled)
Import of export archives; desktop "point" app; self-hosted nodes; hub-and-spoke federation
with this site as hub; FTN echomail between nodes.

# 17 — Decisions, Open Questions & Verification

## Decisions
| # | Decision | Status |
|---|---|---|
| D1 | Hosted, one-stop service run by its admins (not an installable suite for others in v1) | DECIDED |
| D2 | One big site; users form **rings** modeled on webrings | DECIDED |
| D3 | ~~Enigma½ is the BBS~~ Superseded by D17 (2026-09-29) | SUPERSEDED |
| D4 | Terminal access and the modern web view share one message base, which lives in core; terminal access ships with the BBS (D17) | DECIDED |
| D5 | Roles: guest, user, trusted, admin; scoped **ops** on top | DECIDED |
| D6 | Only trusted users create boards (and found rings — PROPOSED extension) | DECIDED |
| D7 | Trusted granted by admins in v1; eligibility hints; vouching with admin confirmation (M7, Q10) | DECIDED |
| D8 | One `role` in the SSO token, read by all services | DECIDED |
| D9 | MUD is one shared world; no ring rooms or zones | DECIDED |
| D10 | Plain, period-accurate vocabulary; no invented metaphor | DECIDED |
| D11 | Plain voice in system text; no themed jokes or nostalgia bits | DECIDED |
| D12 | Name is a placeholder ("Nonternet"); must be changeable via config | DECIDED |
| D13 | Users own their stuff: full export, stable IDs, open formats, custom domains | DECIDED |
| D14 | Participation never requires running a server | DECIDED |
| D15 | Admin console is a first-class, deliberately deep feature | DECIDED |
| D16 | Built with Claude Code from these docs | DECIDED |
| D17 | The BBS is built in-house (not Enigma½), is a client of core's API, and is the **last** milestone (M8). Boards and posts are native to core and work on the web from v1 | DECIDED |

### Superseded from earlier planning
| Earlier | Now |
|---|---|
| Many self-hosted "towns" peering with each other | Single hosted site (D1); federation is a later phase |
| Per-board opt-in federation, quarantine, two-key approval | Deferred; boards stay plain-text to keep it possible |
| Cross-town trust badges | Removed (no other towns) |
| Neighborhoods | Rings (D2) |
| Town / sysop / handle@town vocabulary | Plain vocabulary (D10) |
| Enigma½ as the BBS (D3), with a bridge module, user provisioning and reconcile | In-house BBS as a core client, last (D17) |
| Post storage and read pointers inside Enigma | Boards, posts and read state in core's Postgres |
| BBS in v1 (M2) | BBS is M8; v1 is M1–M4 |

## Proposed defaults
| # | Proposal |
|---|---|
| P1 | TypeScript monorepo, Postgres, Redis, React shell |
| P2 | core is its own OIDC provider (built in M1: authorization code + PKCE, first-party clients from the site config) |
| P3 | ~~Enigma bridge module~~ Withdrawn with D3. The BBS reads and writes through core's API (`04`) |
| P4 | Separate terminal password for native clients |
| P5 | Homepages on per-user subdomains of a separate registrable domain |
| P6 | Ergo for IRC; minimal built-in web client. Built in M5: Ergo 2.19.1 with core's auth-script, and a Chat app on irc-framework (MIT) |
| P7 | Evennia for the MUD |
| P8 | Per-user Ed25519 keypair; signed exports |
| P9 | Quotas: 3 boards, 2 rings per trusted user; 50/100 MB homepages |
| P10 | Ring boards: public read, members post |
| P11 | Core stack: `pg` with plain SQL and forward-only migrations (no ORM), argon2id via `@node-rs/argon2`, `otplib` for TOTP, cookie sessions with hashed tokens, `Origin`-check CSRF, Fastify |
| P12 | Events use a transactional outbox in Postgres, relayed to Redis streams (at-least-once, idempotent consumers), rather than publishing straight from request handlers |

## Open questions
| # | Question | Needed by |
|---|---|---|
| Q1 | Final name and domain(s) | before public launch |
| Q2 | ~~Bridge vs fallback~~ Withdrawn: no Enigma | — |
| Q3 | ~~Allow JavaScript on homepages? Inject footer/report link?~~ Resolved 2026-09-30: JS is allowed, isolated by origin; the homes server injects a small report footer into every HTML page (see `07`) | — |
| Q4 | ~~Can guests use IRC `#lobby`? Observer mode in MUD?~~ Resolved 2026-09-30: confirmed users only, for IRC (`08`) and the MUD (`18`) | — |
| Q5 | ~~Can trusted users register non-ring IRC channels?~~ Resolved 2026-09-30: yes, within `limits.trusted_channel_quota` (default 3) | — |
| Q6 | ~~MUD engine and world design~~ Resolved 2026-09-30: Evennia; generic fantasy with combat at launch; 3 characters per account (`18`). Combat details PROPOSED | — |
| Q7 | Minimum age: DECIDED — configurable tick-box, default 16 (`02`). Legal jurisdiction details still need counsel; pages ship as placeholders | M4 |
| Q8 | Funding model (free, supporter tier, donations) | before launch |
| Q9 | ~~IRC history in exports?~~ Resolved 2026-09-30: chat history kept 30 days in Postgres; a person's own messages are exported, others' are not; deleted accounts' messages are forgotten at once (`08`). Others' posts as context in exports: still no | — |
| Q10 | ~~Vouching: auto-promote or admin confirm?~~ Resolved 2026-09-30: two trusted users vouch, an admin confirms; sponsors flagged if the person is demoted for abuse soon after (`03`) | — |
| Q11 | ~~Private mail: local DMs, later netmail?~~ Resolved 2026-09-30: local private messages and small group threads on this site; netmail maybe later with the BBS | — |
| Q12 | Future federation shape: hub-and-spoke, points, peers | later phase |
| Q13 | ~~BBS scope beyond boards~~ Resolved 2026-09-30: file areas built on the web in M7 (`05`); for M8 the terminal also gets private mail, door games and QWK offline mail. Still out: FTN echomail, terminal signup, file areas in the terminal (later) | — |
| Q14 | ~~Enigma rename handling~~ Withdrawn: no Enigma | — |
| Q15 | ~~Password reset, TOTP recovery codes and TOTP replay protection~~ Resolved 2026-09-29: built in M1 | — |
| Q16 | OIDC `prompt=login` and `max_age` are not enforced (the site session is the login). Do any services need forced re-authentication, and does that need a re-enter-password step on the site? | M5 |

## Implementation notes
- 2026-09-29: the shell has no nested routers. Full pages use the URL; windows use state (`10`).
- 2026-09-29: `RATE_LIMIT=off` added for tests and refused in production (`15`).
- 2026-09-29: board notifications are one per person per post (reply, then mention, then watch); watchers hear about new threads only (`05`, PROPOSED). Email and live push for notifications are not built.
- 2026-09-29: board moderation is hide/unhide, remove, lock/unlock and move, each with a reason and each audited; a removal erases the text and cannot be undone; warn and mute are deferred (`03`). Private boards are readable by listed members only, admins included (`05`, PROPOSED). The mod log is public per board unless `moderation.public_modlog` is false.
- 2026-09-29: a window's place inside its app is held in the window manager, so apps can link to each other (`10`).
- 2026-09-30: IRC (M5). Accounts come only from core via Ergo's auth-script; the Chat app uses one-use tickets; native clients use the terminal password. A bot owned by core registers every channel and applies modes and suspensions by reconciling desired against applied state (`08`). Admins are channel ops, not IRC opers. Account bans stay site suspensions; the console bans addresses only. IRC history is in Ergo's memory for 7 days and is not exported or backed up.
- 2026-09-30: MUD (M6). Evennia, building on its EvAdventure example (Knave rules, CC-BY credit). Generic fantasy, combat at launch (turn-based, monsters only unless both agree to a duel, no permanent death: PROPOSED), 3 characters per account, confirmed users only (`18`). The MUD window renders Evennia's raw markup as an accessible text log rather than xterm.js (`09`).
- 2026-09-30: MUD as built. Logins go only through core (terminal password or a MUD-only ticket); builders are a core op (`mud:world`); core pushes account state to the MUD and it deletes a deleted person's characters. Found while building (VERIFIED against Evennia 5.0.1): EvAdventure ships no item prototypes and never places starting gear in the character's inventory, and copies wisdom into charisma, so the game carries its own character sheet and prototypes; Evennia's menus send ANSI codes even in raw mode; its trusted-proxy list (`UPSTREAM_IPS`) matches exact addresses, so compose gives Caddy a fixed one. The MUD's database is dumped by `cli backup` when `MUD_DATABASE_URL` is set.
- 2026-09-30: Q9 decided by the owners (own chat messages exported, 30 days). VERIFY finding: Ergo's persistent history needs a binary built with the postgresql tag; the official image has it, the release binary on this dev box does not, so history tests skip without it.
- 2026-09-30: M8 as built: the BBS lives in `apps/bbs` (not `services/bbs`: our own code is under `apps/`). Door games are configured only in the site config, never the console, because each is a command run on the server. QWK transfers are on the web for now; ZMODEM in the terminal is not built. Presence (who's online) is kept in core's memory, fed by the BBS's node reports and web sessions.
- 2026-09-30: M8 scope from the owners: the BBS as planned in `04`, plus private mail in the terminal, door games, QWK offline mail, and SSH keys managed in Settings → Terminal. FTN echomail and terminal signup stay out.
- 2026-09-30: M7 scope from the owners: private mail with group threads, vouching with admin confirmation, web file areas, a read-only Gopher mirror (no Gemini), no new themes this milestone, plus the console items (audit replay, stats cohorts, heatmaps, command console).
- 2026-10-01: design pass (owners' choice): refined modern look with character, no new themes, a "what's new" home panel, and the full landing page from `10`. Built: design tokens and scales, shared components (confirm dialog replaces `window.confirm`), Ctrl+K palette, window cycling and snapping, phone tab bar, taskbar clock and online count, admin-set default theme (`ui.default_theme`, a PROPOSED item in `10` now built), singular/plural strings, public `GET /landing`. The code editor in the homepage studio stays light in every theme (its colours are tuned for white). V10 (font licences) untouched: only system fonts are used.
- 2026-10-01: M9-C writing and reading. Verified: Ergo relays client-only tags as TAGMSG (the shipped config lists `+draft/typing` and `typing` as tags history should not store), and irc-framework 4.14 has `tagmsg()` and a `tagmsg` event, so typing notices use `+typing`. Drafts are browser-only (not exported: they are not content on the site until sent). Left for M9-D, where preferences live: muting a mail conversation (it needs a stored per-person setting, so it belongs with notification preferences and the export). Mail inbox search is done in the browser over the 200 newest conversations; server-side `?q=&unread=&before=` paging is not built, because nobody has more than that yet.
- 2026-10-01: M9-D personal touches. Avatars use `sharp` (installed and tried here; it is bundled as an external native module like argon2, so `dist/package.json` and the Docker image install it). A per-kind *desktop* switch was dropped: the live hint carries no kind by design, and a switched-off kind makes no notification at all, which already silences the badge and the browser alert. The status line and away flag are **not** sent to IRC as AWAY yet: Ergo only lets a connection set its own away status, so it needs the sync bot to hold a connection per user, which it deliberately does not. Left as a marked TODO rather than faked. The daily digest is offered only when SMTP is set (`mailer.real`); with none, mail is only logged.
- 2026-10-01: M9-E3 MUD content. Answers `18` question 1 with its own suggestion: the town plus **two adventure areas** (Bandit Woods, Flooded Mine; nine rooms each), after the owners chose MUD content for M9 despite the earlier "keep it minimal". VERIFIED against Evennia 5.0.1: EvAdventure's shop system is a talk-to-the-NPC EvMenu (`shops.py`) and its quests are classes pickled onto the character; neither suits a few plain, testable commands, so the shop, the ledger quest and the noticeboard are small in-house modules (`world/shop.py`, `quests.py`, `noticeboard.py`) and EvAdventure's own are not used. Every roll goes through `EvAdventureRollEngine.saving_throw`, so "weakened" is one patch there. Evennia now runs in the dev container (a venv from `services/mud/requirements.txt`), so the 30 MUD tests and the core tests that start a real Evennia were run.
- 2026-10-01: First-look pass (walkthrough as a stranger, desktop and phone). Fixed what it showed: Evennia output arrived HTML-escaped in the web MUD, so the shell decodes entities; new characters now start with 10 coins (**PROPOSED**; the shop was a closed door at zero); capitalised fittings such as Marta no longer read "a Marta". The terminal now fits art and headings to the window width, so phones no longer see broken fragments. Known limits on a ~36-column terminal: a few menu lines still wrap and boxed intro text is clipped at the right edge; a proper narrow layout for boxes is not built.
- Still open from M1: Q16, no OIDC signing-key rotation command, compose stack unverified.

## Verify list
| # | Fact | Affects |
|---|---|---|
| V1–V6 | ~~Enigma½ module system, login delegation, runtime areas, pointers, encoding, rename~~ Withdrawn with D3. Results are kept in `docs/spikes/m0-enigma.md` | — |
| V7 | ~~Ergo: accounts, SASL, external auth, history, WebSocket~~ Verified 2026-09-30 against Ergo 2.19.1 (source and tests in `apps/core/src/irc/*.test.ts` run the real server). Found: opers can't follow accounts, unregistering needs a confirmation code, the network name can't hold spaces | 08 |
| V8 | ~~Evennia: auth backend, web client embedding~~ Verified 2026-09-30 against Evennia 5.0.1 (`spikes/m6-evennia.md`): login can be handed to core, stable ids and roles map, ticket login works over WebSocket; its WebSocket sends Evennia markup, not ANSI | 09 |
| V9 | xterm.js screen reader support | 10 |
| V10 | Licences of bundled GIFs, fonts, any embedded clients. Ergo and irc-framework are MIT (checked 2026-09-30) | 07, 08, 10 |
| V11 | Caddy on-demand TLS with ask endpoint. The `ask` endpoint and `Caddyfile.prod` are written and the endpoint is tested; Caddy itself has not been run against a real domain | 07, 15 |
| V12 | Node telnet and SSH server libraries (e.g. `ssh2`): pty, public-key auth, terminal-type and window-size negotiation, xterm.js over WebSocket | 04 |

## Spike log
| Date | Item | Result |
|---|---|---|
| 2026-09-29 | M0 (run against Enigma 0.5.1-beta) | 0.1 pass, 0.2 pass with custom code, 0.3 pass (not persistent), 0.4 partly tested. See `docs/spikes/m0-enigma.md`. |
| 2026-09-30 | M6 spike (Evennia 5.0.1) | Pass: core-backed login, account per user by core id, role mapping, ticket login over WebSocket. See `docs/spikes/m6-evennia.md`. |
| 2026-09-29 | Direction change | Enigma½ dropped in favour of an in-house BBS, scheduled last (D17). Spike kept as a record; the bridge code was removed from the repo (it is in git history). |

## Change process
Update this file and the affected doc in the same commit when anything here changes.

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
| D7 | Trusted granted by admins in v1; eligibility hints; vouching later | DECIDED |
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
| Q9 | IRC history in exports? Others' posts as context in exports? | M4 |
| Q10 | ~~Vouching: auto-promote or admin confirm?~~ Resolved 2026-09-30: two trusted users vouch, an admin confirms; sponsors flagged if the person is demoted for abuse soon after (`03`) | — |
| Q11 | ~~Private mail: local DMs, later netmail?~~ Resolved 2026-09-30: local private messages and small group threads on this site; netmail maybe later with the BBS | — |
| Q12 | Future federation shape: hub-and-spoke, points, peers | later phase |
| Q13 | BBS scope beyond boards: file areas, door games, QWK/offline mail, FTN echomail, terminal signup — in or out, and when? File areas: in, built on the web in M7 (2026-09-30); the rest still open | before M8 |
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
- 2026-09-30: M7 scope from the owners: private mail with group threads, vouching with admin confirmation, web file areas, a read-only Gopher mirror (no Gemini), no new themes this milestone, plus the console items (audit replay, stats cohorts, heatmaps, command console).
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

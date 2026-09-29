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
| P2 | core is its own OIDC provider |
| P3 | ~~Enigma bridge module~~ Withdrawn with D3. The BBS reads and writes through core's API (`04`) |
| P4 | Separate terminal password for native clients |
| P5 | Homepages on per-user subdomains of a separate registrable domain |
| P6 | Ergo for IRC; minimal built-in web client |
| P7 | Evennia for the MUD |
| P8 | Per-user Ed25519 keypair; signed exports |
| P9 | Quotas: 3 boards, 2 rings per trusted user; 50/100 MB homepages |
| P10 | Ring boards: public read, members post |
| P11 | Core stack: `pg` with plain SQL and forward-only migrations (no ORM), argon2id via `@node-rs/argon2`, `otplib` for TOTP, cookie sessions with hashed tokens, `Origin`-check CSRF, Fastify |

## Open questions
| # | Question | Needed by |
|---|---|---|
| Q1 | Final name and domain(s) | before public launch |
| Q2 | ~~Bridge vs fallback~~ Withdrawn: no Enigma | — |
| Q3 | Allow JavaScript on homepages? Inject footer/report link? | M3 |
| Q4 | Can guests use IRC `#lobby`? Observer mode in MUD? | M5/M6 |
| Q5 | Can trusted users register non-ring IRC channels? | M5 |
| Q6 | MUD engine and world design | M6 |
| Q7 | Minimum age and legal jurisdiction details | M4 |
| Q8 | Funding model (free, supporter tier, donations) | before launch |
| Q9 | IRC history in exports? Others' posts as context in exports? | M4 |
| Q10 | Vouching: auto-promote or admin confirm? | later |
| Q11 | Private mail: local DMs, later netmail? | M7 |
| Q12 | Future federation shape: hub-and-spoke, points, peers | later phase |
| Q13 | BBS scope beyond boards: file areas, door games, QWK/offline mail, FTN echomail, terminal signup — in or out, and when? | before M8 |
| Q14 | ~~Enigma rename handling~~ Withdrawn: no Enigma | — |
| Q15 | ~~Password reset, TOTP recovery codes and TOTP replay protection~~ Resolved 2026-09-29: built in M1 | — |

## Verify list
| # | Fact | Affects |
|---|---|---|
| V1–V6 | ~~Enigma½ module system, login delegation, runtime areas, pointers, encoding, rename~~ Withdrawn with D3. Results are kept in `docs/spikes/m0-enigma.md` | — |
| V7 | Ergo: accounts, SASL, external auth, history, WebSocket | 08 |
| V8 | Evennia: auth backend, web client embedding | 09 |
| V9 | xterm.js screen reader support | 10 |
| V10 | Licences of bundled GIFs, fonts, any embedded clients | 07, 08, 10 |
| V11 | Caddy on-demand TLS with ask endpoint | 07, 15 |
| V12 | Node telnet and SSH server libraries (e.g. `ssh2`): pty, public-key auth, terminal-type and window-size negotiation, xterm.js over WebSocket | 04 |

## Spike log
| Date | Item | Result |
|---|---|---|
| 2026-09-29 | M0 (run against Enigma 0.5.1-beta) | 0.1 pass, 0.2 pass with custom code, 0.3 pass (not persistent), 0.4 partly tested. See `docs/spikes/m0-enigma.md`. |
| 2026-09-29 | Direction change | Enigma½ dropped in favour of an in-house BBS, scheduled last (D17). Spike kept as a record; the bridge code was removed from the repo (it is in git history). |

## Change process
Update this file and the affected doc in the same commit when anything here changes.

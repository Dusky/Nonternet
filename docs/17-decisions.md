# 17 — Decisions, Open Questions & Verification

## Decisions
| # | Decision | Status |
|---|---|---|
| D1 | Hosted, one-stop service run by its admins (not an installable suite for others in v1) | DECIDED |
| D2 | One big site; users form **rings** modeled on webrings | DECIDED |
| D3 | Enigma½ is the BBS | DECIDED |
| D4 | BBS has terminal access and a modern web view over the same message base | DECIDED |
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

### Superseded from earlier planning
| Earlier | Now |
|---|---|
| Many self-hosted "towns" peering with each other | Single hosted site (D1); federation is a later phase |
| Per-board opt-in federation, quarantine, two-key approval | Deferred; boards stay plain-text to keep it possible |
| Cross-town trust badges | Removed (no other towns) |
| Neighborhoods | Rings (D2) |
| Town / sysop / handle@town vocabulary | Plain vocabulary (D10) |

## Proposed defaults
| # | Proposal |
|---|---|
| P1 | TypeScript monorepo, Postgres, Redis, React shell |
| P2 | core is its own OIDC provider |
| P3 | Enigma bridge module (fallback: packets + read-only SQLite) |
| P4 | Separate terminal password for native clients |
| P5 | Homepages on per-user subdomains of a separate registrable domain |
| P6 | Ergo for IRC; minimal built-in web client |
| P7 | Evennia for the MUD |
| P8 | Per-user Ed25519 keypair; signed exports |
| P9 | Quotas: 3 boards, 2 rings per trusted user; 50/100 MB homepages |
| P10 | Ring boards: public read, members post |

## Open questions
| # | Question | Needed by |
|---|---|---|
| Q1 | Final name and domain(s) | before public launch |
| Q2 | ~~Bridge vs fallback~~ Resolved 2026-09-29: bridge (P3 confirmed), see spike log | M0 |
| Q3 | Allow JavaScript on homepages? Inject footer/report link? | M4 |
| Q4 | Can guests use IRC `#lobby`? Observer mode in MUD? | M6/M7 |
| Q5 | Can trusted users register non-ring IRC channels? | M6 |
| Q6 | MUD engine and world design | M7 |
| Q7 | Minimum age and legal jurisdiction details | M5 |
| Q8 | Funding model (free, supporter tier, donations) | before launch |
| Q9 | IRC history in exports? Others' posts as context in exports? | M5 |
| Q10 | Vouching: auto-promote or admin confirm? | later |
| Q11 | Private mail: local DMs, later netmail? | M8 |
| Q12 | Future federation shape: hub-and-spoke, points, peers | later phase |
| Q13 | Enigma can only check passwords against its own hash, so the terminal password hash is copied into Enigma at provisioning. Accept this as the one service that holds a copy, or build an external-verify patch? | M2 |
| Q14 | Enigma has no rename API; its own tool does a one-line SQL `UPDATE` on its user table. Allow the bridge to do the same from inside Enigma's process (an exception to "never write to Enigma's databases"), or disallow handle changes for BBS users? | M2 |

## Verify list
| # | Fact | Affects |
|---|---|---|
| V1 | Enigma½ module system and internal APIs | 04, M0 — **verified** 2026-09-29 (`webHandlers` module; see `docs/spikes/m0-enigma.md`) |
| V2 | Enigma½ login delegation / WebSocket auth hook | 02, 04 — **verified**: no hook; ticket login works via wrapper plus copied WS server |
| V3 | Enigma½ runtime area creation | 04 — **verified**: works, in memory only, re-register on start |
| V4 | Enigma½ pointer storage | 05 — table found, bridge access not tested |
| V5 | Enigma½ encoding over WS; UTF-8 handling | 04, 05 — UTF-8 over telnet verified; CP437 and xterm.js not tested |
| V6 | Enigma½ user rename support | 02 — no API; see Q14 |
| V7 | Ergo: accounts, SASL, external auth, history, WebSocket | 08 |
| V8 | Evennia: auth backend, web client embedding | 09 |
| V9 | xterm.js screen reader support | 10 |
| V10 | Licences of bundled GIFs, fonts, any embedded clients | 07, 08, 10 |
| V11 | Caddy on-demand TLS with ask endpoint | 07, 15 |

## Spike log
| Date | Item | Result |
|---|---|---|
| 2026-09-29 | M0 (run against Enigma 0.5.1-beta) | 0.1 pass, 0.2 pass with custom code, 0.3 pass (not persistent), 0.4 partly tested. Bridge chosen; P3 confirmed. See `docs/spikes/m0-enigma.md`. |

## Change process
Update this file and the affected doc in the same commit when anything here changes.

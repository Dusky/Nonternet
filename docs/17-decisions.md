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
| D18 | Five themes from the design board: Webring (default), After dark, Terminal (eight screen colours), Platinum, Aqua. Modern and Amber retired and mapped to Webring and Terminal. Effects off by default. Board: https://claude.ai/artifact/7m11ykm4aaUKYrS3akbFGA, proposal: https://claude.ai/code/artifact/e76bc564-641f-4c36-b021-9f8c9a2ad99e (2026-10-02) | DECIDED |
| D19 | Admin two-factor is a site setting, `security.require_admin_2fa`, **off by default** (owners, 2026-10-02). When on, an admin without 2FA gets a limited session until they set it up | DECIDED |
| D20 | MUD client automation is **rules only, never code**: aliases, triggers with a fixed set of actions, timers, keys, buttons, variables (owners, 2026-10-02) | DECIDED |
| D21 | Chat and MUD client settings are **kept on the account** (`client_settings`), exported, imported and erased with it; device-only display choices stay on the device (owners, 2026-10-02) | DECIDED |
| D22 | The MUD is a procedurally generated tower: one shared, endless tower rebuilt monthly (seasons), personal loot, defeat returns you to your last checkpoint, the town is the hub, content from hand-written tables combined by a seed with no live AI text (owners, 2026-10-03; `18`). Replaces the M9-E3 woods, mine and quest. No puzzle rooms (owner, 2026-10-03) | DECIDED |

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
| P13 | Shell interaction stack (2026-10-04, after comparing options): React Aria Components for menus, dialogs and tabs (chosen over Radix, Base UI and Ark for its accessibility and i18n depth); Sonner for toasts with Undo; cmdk for the palette; TanStack DB for client-side data, piloted on Boards and Mail (owners' choice, accepting that it is beta; fallback is React 19 `useOptimistic`); TanStack Form with zod 4 for forms; React 19.2 with the React Compiler; View Transitions for moving between screens; long logs with CSS `content-visibility` (TanStack Virtual was planned and dropped, see 2026-10-04 below). Background work in core moves to graphile-worker (Postgres, no new service). Not adopted: a rich-text editor (posts must read the same in the terminal), Better Auth (our auth already has audit, TOTP and OIDC; passkeys use SimpleWebAuthn directly), Tauri/Electron (the PWA covers installing), Meilisearch (Postgres search first; ParadeDB if ranking disappoints) |
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
| Q13 | ~~BBS scope beyond boards~~ Resolved 2026-09-30: file areas built on the web in M7 (`05`); for M8 the terminal also gets private mail, door games and QWK offline mail. Still out: FTN echomail, file areas in the terminal (later). Terminal signup built 2026-10-02 (`04`) | — |
| Q14 | ~~Enigma rename handling~~ Withdrawn: no Enigma | — |
| Q15 | ~~Password reset, TOTP recovery codes and TOTP replay protection~~ Resolved 2026-09-29: built in M1 | — |
| Q16 | OIDC `prompt=login` and `max_age` are not enforced (the site session is the login). Do any services need forced re-authentication, and does that need a re-enter-password step on the site? | M5 |
| Q18 | Outside authors for installable apps: who may publish, how apps are reviewed, signed, reported and taken down, and how a sandboxed frame is kept from carrying data out by navigating itself (docs/15). The format is ready for it; nothing is decided | before anyone but the site publishes an app |
| Q17 | Should boards or homepages federate over ActivityPub (e.g. Fedify), so people on Mastodon can follow them? Raised 2026-10-04 | not scheduled |

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
- 2026-10-01: M9-C writing and reading. Verified: Ergo relays client-only tags as TAGMSG (the shipped config lists `+draft/typing` and `typing` as tags history should not store), and irc-framework 4.14 has `tagmsg()` and a `tagmsg` event, so typing notices use `+typing`. Drafts are browser-only (not exported: they are not content on the site until sent). Left for M9-D, where preferences live: muting a mail conversation (it needs a stored per-person setting, so it belongs with notification preferences and the export). Mail inbox search was first done in the browser over the 200 newest conversations; it is now server-side (see the 2026-10-02 entry).
- 2026-10-01: M9-D personal touches. Avatars use `sharp` (installed and tried here; it is bundled as an external native module like argon2, so `dist/package.json` and the Docker image install it). A per-kind *desktop* switch was dropped: the live hint carries no kind by design, and a switched-off kind makes no notification at all, which already silences the badge and the browser alert. The status line and away flag are **not** sent to IRC as AWAY yet: Ergo only lets a connection set its own away status, so it needs the sync bot to hold a connection per user, which it deliberately does not. Phase G4 (2026-10-02) settled it: VERIFIED against Ergo 2.19.1's source that `AWAY` only changes the calling connection (no operator or NickServ route), so the status line stays web-only; see `08`. The daily digest is offered only when SMTP is set (`mailer.real`); with none, mail is only logged.
- 2026-10-01: M9-E3 MUD content. Answers `18` question 1 with its own suggestion: the town plus **two adventure areas** (Bandit Woods, Flooded Mine; nine rooms each), after the owners chose MUD content for M9 despite the earlier "keep it minimal". VERIFIED against Evennia 5.0.1: EvAdventure's shop system is a talk-to-the-NPC EvMenu (`shops.py`) and its quests are classes pickled onto the character; neither suits a few plain, testable commands, so the shop, the ledger quest and the noticeboard are small in-house modules (`world/shop.py`, `quests.py`, `noticeboard.py`) and EvAdventure's own are not used. Every roll goes through `EvAdventureRollEngine.saving_throw`, so "weakened" is one patch there. Evennia now runs in the dev container (a venv from `services/mud/requirements.txt`), so the 30 MUD tests and the core tests that start a real Evennia were run.
- 2026-10-01: First-look pass (walkthrough as a stranger, desktop and phone). Fixed what it showed: Evennia output arrived HTML-escaped in the web MUD, so the shell decodes entities; new characters now start with 10 coins (**PROPOSED**; the shop was a closed door at zero); capitalised fittings such as Marta no longer read "a Marta". The terminal now fits art and headings to the window width, so phones no longer see broken fragments. Known limits on a ~36-column terminal: a few menu lines still wrap and boxed intro text is clipped at the right edge; a proper narrow layout for boxes is not built.
- 2026-10-02: Phase G1, mail inbox search and paging are server-side: `GET /mail?q=&unread=&before=&limit=` pages by `(last_message_at, id)`, and the shell's inbox uses an infinite query with a debounced search. The `unread` count in the answer is now the whole inbox, not the loaded page. A conversation's `muted` flag comes from `GET /mail/:id`, so no screen depends on the inbox list being cached.
- 2026-10-02: Phase G2, tavern guestbook (same rules as the noticeboard, newest 100 kept, exported and erased). Moderation in the MUD was not in the audit log; builders removing someone else's note now report to core through `POST /internal/mud/audit`, which writes `mud.note_removed` / `mud.guestbook_removed`. Other Evennia builder commands (`@dig` and the like) are still not audited; that is a known gap, not decided.
- 2026-10-02: Phase G3, duels. Opt-in and non-lethal, in the training yard only. `allow_pvp` is a room-wide flag, so consent is enforced by replacing EvAdventure's `attack` with one that refuses any person who has not agreed to a duel with the attacker. VERIFIED that the turn-based handler fights PC against PC there. The loser stays at half hit points with no weakness and no teleport. No rewards, ranking or wagers; if people want those, that is a new decision.
- 2026-10-02: Phase H2, a new site's admin status is calm. The first look showed two red warnings on a site that was minutes old. Now the "no good backup" and "no restore test" warnings wait for a grace period counted from the first account: **2 days** for the first backup, **14 days** for the first restore test (PROPOSED numbers). After that, and for any failed restore test, the old rules apply unchanged.
- 2026-10-02: Phase H3/H4. `GET /session` (public, 200 with `user: null` for visitors) replaces `/me` in the shell's sign-in check so a visitor's first page load is not a failing request; `/me` still answers 401. First load: a `vendor` chunk plus lazy pages (numbers in `10`). The stray "xterm" text in the main file is only a word in a help string, not an import.
- 2026-10-02: Phase H5/H6 (and the end of M9). `StudioApp.tsx` and `SettingsApp.tsx` are split into one file per tab with no behaviour change (the Studio's editor is still the only lazy part). Axe scans now cover every settings tab and the M9 screens (inbox searching / unread only / muted, people, a profile, bulletins, polls) in both themes.
- 2026-10-02: **The compose stack is verified** (it was the last thing marked unverified from M1). Run with Docker 29 in the dev container: all seven images built from the committed Dockerfiles, `docker compose up` brought up Postgres, Redis, core, the shell, homes, the BBS, Gopher, the MUD, Ergo and Caddy, and through Caddy on port 8080 a member could sign in, the site API answered, a ticket login worked on all three WebSockets (chat through Ergo's real `auth.sh`, the MUD, the BBS terminal), telnet and SSH on the BBS, MUD telnet and Gopher answered, data survived `down` and `up`, and `cli backup` and `cli restore-test` passed inside the real image (database, MUD world, chat history). Found and fixed on the way: (1) **no `.dockerignore`**, so the host's `node_modules` and `dist` went into the build context and over the image's own: added; (2) **Caddy's fixed address (172.30.0.10) was taken by the MUD** because Caddy starts last and Docker numbers containers from the bottom of the subnet, so Caddy failed to start: automatic addresses now come from the top half only (`ip_range`); (3) the Gopher container reported **unhealthy** because it inherited core's health check: it has its own. (4) **`/readyz` was never routed to core** in either Caddyfile, so `sitectl doctor` and `sitectl upgrade` were checking the shell's fallback page, which answers 200 whatever core is doing: `/healthz` and `/readyz` now go to core (checked: 502 with core stopped). Not verified: TLS and certificates on a real domain (V11), the production overlay actually running (it was checked to parse, and `sitectl doctor` was not run), wildcard homepage domains, and real SMTP. Sandbox note: this environment's Docker Hub pulls are rate limited and its HTTPS proxy needs a CA certificate, so the test used images pulled from a mirror and a throwaway Dockerfile copy that adds the CA; neither is needed on a normal server.
- Still open from M1: Q16, no OIDC signing-key rotation command.

- 2026-10-02: restyle (D18). The five themes are token sets with a few `data-chrome` rules. The note about the new look lives in the shell (shown once per device), not as an announcement row, because a migration-seeded announcement would put our copy on other people's sites. Effects stay off under reduced motion or more contrast. Sizes: main 233 KB, vendor 226 KB, fonts fetched per theme (Webring 88 KB).

- 2026-10-02: import of exports (owners' choice). Only what is yours alone comes back (profile, settings, picture, homepage, files, SSH keys); everything involving other people stays in the archive and is listed. Origin is proven only for archives made here for you; from another site the integrity is checked and the preview says the origin is not proven.

- 2026-10-02: terminal sign-up (owners' choice): the emailed code confirms in the terminal; telnet allowed with a plain warning; website and terminal passwords must differ; 3 accounts an hour per caller address. Nothing about agreeing to the terms is stored, on the web or in the terminal (unchanged).

- 2026-10-02: admin two-factor is optional (owners' choice). New console setting `security.require_admin_2fa`, off by default; when on, the old rule applies (limited sessions until TOTP is set up, including someone promoted mid-session). Supersedes the 'required for admins' line in `02`/`15`.
- 2026-10-03: homepage links 404'd when running locally, because the example config's `homes_domain: example-homes.net` sent browsers to the public internet. The example now uses `homes.localhost` (browsers resolve `*.localhost` to this machine), `sitectl doctor` fails while a real site still has a `localhost` domain or one that differs from `.env`, and `doctor` no longer stops silently at the first missing `.env` key (`07`, `19`).
- 2026-10-03: updates and restarts from the console go through a host agent (`sitectl agent`) reading request files from a shared folder, rather than giving any container the Docker socket: a compromised core can only ask for a fixed action, never run a command (`19`).
- 2026-10-03: people change their own email and handle and turn two-factor off from Settings (`02`). Only renames a person makes themselves count toward the once-every-90-days limit (`handle_history.by_user`), so an admin's correction doesn't use up their turn. A changed email is confirmed before it replaces the old one.
- 2026-10-03: sign-up by application is built (`02`). Declining suspends the account rather than deleting it, so the same handle and address can't simply try again; the person is told why. Approval and email confirmation can happen in either order. Ops don't review applications yet.
- 2026-10-04: BBS prompts. List prompts take letters as single keys (numbers still need Enter), and a screen that leaves something to read waits for a key before the menu returns (`04`). Classic BBS behaviour; both were missing, so options looked like they did nothing in the Terminal window.
- 2026-10-04: the character copy from the MUD had a race. Two pulls on separate timers could overlap, and the older list, committing last, deleted a character the newer one had just saved, which also cleared the owner's featured choice (`ON DELETE SET NULL`). Pulls now queue in-process, take an advisory lock, and stamp rows with the database time taken before asking; an older pull never updates or deletes a row stamped later (`09`). Found as a flaky e2e test.

- 2026-10-04: installable apps (owners' choice: the site's own apps first, outside authors later; each person picks what to add from what admins offer). Apps are packages run in a sandboxed, opaque-origin frame from the homes origin with no network, reaching the account only through a permission-checked bridge (Penpal). This follows the iframe-and-bridge model of Figma, Shopify and MCP Apps; Module Federation and Web Components were ruled out because they run app code on the shell's origin. All app data goes in one generic table, so export, import and deletion cover every app automatically. Todo is the first (`10`, `12`, `15`). Building it showed that Caddy's `ask` refused the bare homes domain, so the documented stable `/u/{id}/` links could never have had a certificate; it is now allowed.

- 2026-10-04: React 19.3 with the React Compiler 1.0 (as a Babel plugin through `@vitejs/plugin-react` 5.2, staying on Vite 6; plugin-react 6 needs Vite 8, a separate upgrade), and zod 4.6 in shared, core and the BBS. zod 4 changed `.default(value)` to return the value without parsing it, so object defaults that relied on inner defaults (`.default({})`) are now `.prefault({})`; its issue fields changed (`origin`, `invalid_format`, `invalid_value`), so `zod-message.ts` was rewritten for them. The interface libraries from P13 (React Aria, Sonner, cmdk) are their own cached chunk: 256 KB, about 81 KB gzipped, on every page.

- 2026-10-04: instant feel (`10`). Long chat and MUD logs use CSS `content-visibility: auto` instead of TanStack Virtual (a change from P13): a virtual list would drop off-screen lines from the page, which breaks live announcements, browser find and the MUD's find; the CSS keeps every line in the page and skips only layout and painting. Conversation links are not prefetched, because opening a conversation marks it read on the server.

- 2026-10-05: filler removed from the interface (`10`). A written rule caps hints at 150 characters, with a test; longer help sits behind a "?". Reversible actions act at once with Undo instead of asking: the request is delayed six seconds so even things the server can't take back can be undone, and a page leave sends what is waiting (note: `pagehide` sends are not guaranteed by browsers, so a person who closes the tab inside the six seconds may lose the removal, which fails safe: nothing is deleted). Confirmation dialogs stay for what can't be taken back.

- 2026-10-05: forms (`10`). The submit button stays on while a form is invalid (a change from "submit enabled when valid" in the plan): a disabled button with no explanation strands people and screen readers, and pressing it with mistakes now shows all of them. Server errors are mapped to fields by error *code*, because the documented error shape has no field name (adding one broke the security test for the shape).
- 2026-10-05: graphile-worker (J in the plan) is postponed to the push phase. Every `setInterval` in core is an idempotent reconciler (IRC and MUD sync, the digest), a poll of a database table (exports) or an already-durable outbox, so none loses work when it stops; a job queue would add retries and visibility but also need DDL rights for its own schema under the restricted runtime role (`DB_RUNTIME_ROLE`). Sending push notifications needs per-message retries, so it adopts the queue then.
- 2026-10-05: Studio (`07`, `10`): lint, completion, Emmet (as a suggestion, not on Tab) and a live preview served from the homepage origin through a ten-minute draft behind an unguessable token. A browser-side preview (a sandboxed `srcdoc` frame) was rejected: it would inherit the shell's content policy, so inline scripts and outside pictures that work on the published page would not show.

## Verify list
| # | Fact | Affects |
|---|---|---|
| V1–V6 | ~~Enigma½ module system, login delegation, runtime areas, pointers, encoding, rename~~ Withdrawn with D3. Results are kept in `docs/spikes/m0-enigma.md` | — |
| V7 | ~~Ergo: accounts, SASL, external auth, history, WebSocket~~ Verified 2026-09-30 against Ergo 2.19.1 (source and tests in `apps/core/src/irc/*.test.ts` run the real server). Found: opers can't follow accounts, unregistering needs a confirmation code, the network name can't hold spaces | 08 |
| V8 | ~~Evennia: auth backend, web client embedding~~ Verified 2026-09-30 against Evennia 5.0.1 (`spikes/m6-evennia.md`): login can be handed to core, stable ids and roles map, ticket login works over WebSocket; its WebSocket sends Evennia markup, not ANSI | 09 |
| V9 | xterm.js screen reader support | 10 |
| V10 | Licences of bundled GIFs, fonts, any embedded clients. Ergo and irc-framework are MIT (checked 2026-09-30). Fonts bundled for the themes (Bricolage Grotesque, Space Mono, VT323, IBM Plex Mono and Sans, Pixelify Sans, Nunito Sans, Silkscreen, via @fontsource 5.3) are all OFL-1.1 (checked 2026-10-02) | 07, 08, 10 |
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

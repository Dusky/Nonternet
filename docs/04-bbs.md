# 04 — BBS (built in-house, last milestone)

**DECIDED (2026-09-29):** we build our own BBS instead of embedding Enigma½, and it ships
**last** (M8 in `16-roadmap.md`). Everything below is PROPOSED and kept deliberately thin
until that milestone. Nothing else in the plan depends on it.

## Why it can wait
Accounts, boards, rings and homepages give users everything on the web. The BBS is a second
front door onto the same data ("two front doors", `00`), not a source of data. Boards live in
core (`05`, `13`), so the BBS adds no storage, no user table and no sync.

## What it is
A TypeScript service, `apps/bbs` (our own code lives under `apps/`; `services/` holds borrowed software), with telnet, SSH and WebSocket listeners (WebSocket is
for the shell's xterm.js window). It is a **client of the core API**:
- No message store and no user table of its own. A post from the terminal is a post in core,
  so the web view sees it immediately, and export (`12`) already covers it.
- It never touches Postgres directly. It calls core with a per-session delegated token, so
  roles, ops, bans, quotas and the audit log apply exactly as they do on the web.
- Nothing to reconcile: users, roles and boards are read from core, not copied.

## Authentication
| Path | How |
|---|---|
| Telnet / SSH, password | terminal password, checked by core's private `verify` endpoint |
| SSH, key | public keys from core (`ssh_keys`); host key managed by `sitectl` |
| Web terminal | one-time **login ticket** in the WebSocket URL (`login_tickets`, 60 s, single use), redeemed against core when the socket connects; replay and expiry are refused |
| Signup | built 2026-10-02: `new` at the handle prompt (or SSH user `new`); same rules as the web, both passwords, the emailed code confirms and signs in (`02`) |

The BBS subscribes to `user.suspended`, `user.role_changed` and `session.revoked` and drops or
updates live sessions within 5 s.

## Terminal behaviour
- **Negotiation first.** Before drawing anything, handle telnet TTYPE and NAWS and the ANSI
  cursor and device queries. Classic clients and xterm.js both need this.
- **Encoding.** UTF-8 by default. A CP437 mode for classic clients (detected from terminal
  type) transcodes at the edge. Characters that can't be shown become `?`, and the web
  composer warns about them in its preview (`05`).
- **Screens.** ANSI art from a replaceable art pack, templated with `site.name` (see the
  placeholder rule in `CLAUDE.md`). Menus are declarative config, not code.
- **Editor.** A simple line editor first; a full-screen editor later.
- **Limits.** Configurable node count, idle timeout and per-IP connection limits.

## Feature set at launch (M8)
Login and MOTD, then a main menu that mirrors the shell: Boards (list, read threaded or flat,
new-scan, post, reply with quoting), Rings, Who's online, Last callers, Homepages directory,
and a settings page that points to the web. Presence is reported to core for the site-wide
"who's online".

## Also in M8 (owners, 2026-09-30; Q13)
- **Private mail** in the terminal: the same conversations as the web Mail app (`10`): list, read, reply,
  start one. Blocks apply.
- **Door games** (PROPOSED design): native doors run as a child process with a DOOR32.SYS / DOOR.SYS
  drop file and the caller's terminal on stdin/stdout, one sandboxed process per session, configured by the
  operator (name, command, working folder, node limit, time limit). DOS doors need an emulator the operator
  installs (e.g. DOSEMU2 or DOSBox-X); the BBS only starts the configured command. VERIFY before relying on
  a specific door.
- **QWK offline mail** (PROPOSED): download new messages from chosen boards as a `.QWK` packet (CONTROL.DAT,
  MESSAGES.DAT, index files), reply offline, upload the `.REP` packet; replies become posts through core
  with the same checks as any post. Transfer by ZMODEM in the terminal, or by the web (Settings).
- **SSH keys**: added and removed in Settings → Terminal; part of the export.

## Later (see Q13 in `17`)
File areas in the terminal, FTN echomail.

## Notes carried over from the Enigma½ spike
The spike (`docs/spikes/m0-enigma.md`) is kept as a record. What still applies:
- Telnet negotiation and terminal detection must finish before the first screen.
- A ticket-at-connect login works well for the web terminal.
- UTF-8 and CP437 are separate modes; test both.

## Acceptance tests (M8)
- Telnet and SSH login with the terminal password; SSH login with a registered key.
- Web post appears in the terminal within 2 s with the correct author, and vice versa.
- Reading in the terminal updates unread counts on the web.
- Suspending a user drops their terminal sessions within 5 s.
- The web terminal logs in with no prompt; a replayed or expired ticket is refused.
- UTF-8 and CP437 clients both round-trip a post correctly.

## As built (M8)
- **Sign-in** (`apps/core/src/bbs/`, `routes/bbs.ts`): the BBS presents a token derived from `BBS_SECRET` on
  core's private `/internal/bbs/*` endpoints. Core checks the terminal password, a one-use `bbs` ticket
  (`POST /api/v1/bbs/ticket`, 60 s) or an SSH key (the BBS verifies the signature with `ssh2`, core checks the
  fingerprint belongs to that handle), and answers with an ordinary session (`sessions.kind = 'bbs'`, 12 h)
  that the BBS sends as the `sid` cookie on the public API. Logging out revokes it. Admins without
  two-factor get a limited session, as on the web.
- **Nodes and drops:** every 3 s the BBS reports its nodes (session, where, how connected). Core answers per
  node whether the session is still valid and the caller's role; an invalid one (suspended, deleted, signed
  out) is dropped at once. Core keeps the report for who's online (`GET /api/v1/online`: web, chat, BBS).
- **Calls** are logged in `bbs_calls` for the last callers list and "last on"; deleted with the account.
- **SSH keys** (`ssh_keys`) are added in Settings → Terminal: ed25519, ECDSA or RSA ≥ 2048, one owner per
  key, up to 10 each, audited, exported as `keys/ssh_authorized_keys`.
- **Service** (`apps/bbs`): telnet (own negotiation code: ECHO, SGA, BINARY, TTYPE, NAWS; waits up to 1.5 s
  for type and size before the first screen), SSH (`ssh2`: password, keyboard-interactive, public key; the host
  key is made on first start and kept in `/data`), WebSocket for the Terminal window (JSON messages; ticket in
  the first one). Limits from `bbs.max_nodes`, `bbs.per_ip`, `bbs.idle_minutes`. CP437 for classic terminal
  types (ANSI, SyncTERM, …), UTF-8 otherwise, switchable under Settings.
- **Art pack** (`apps/bbs/art/default`): `login`, `motd`, `main`, `goodbye` screens with `{{site.name}}`-style
  placeholders and colours, and `menus.yaml` (keys, labels, built-in actions; checked at start).
- **Boards:** list with unread counts, thread list (20 a page, `*` for unread), reading flat or threaded (T),
  posting and replying with a line editor (`/s` save, `/a` abandon, `/q` quote, `/l` list, `/d` delete last
  line), the site's preview warnings before posting, and a new-message scan across boards
  (`GET /api/v1/boards/:slug/new`: posts after the read pointer, oldest first). Reading moves the same read
  pointer the web uses.
- **Mail, rings, homepages, who, last callers:** mail reads, replies to, adds people to and starts the same
  conversations as the web; rings can be browsed, joined, left, and their board read; the homepage directory
  lists titles and addresses; who's online shows the BBS's own nodes (always current) plus people on the web
  and in chat from core; last callers comes from core's call log. Both lists go a screenful at a time
  (the BBS's own nodes first), so a busy site doesn't scroll them past. Settings points to the web and can
  switch the character set.
- **Terminal window** (shell app `terminal`, shown when `services.bbs` is on): xterm.js over `/ws/bbs`, signed
  in by a one-use ticket; a key bar (Esc, Tab, Ctrl-C, arrows, Enter) for phones; a screen-reader mode
  (xterm.js's own); how to connect with your own telnet or SSH program. The VGA font is used if the viewer
  has one installed ("Px437 IBM VGA 8x16"); none is bundled (licence to check first).
- **Console:** a BBS tab with live nodes (from the last node report), last callers, and Disconnect (revokes
  the person's BBS sessions, audited as `bbs.disconnected`). The message of the day is the `bbs.motd`
  setting (Config), shown after login. Live announcements are shown after login and passed to everyone
  connected within 30 s.
- **Door games** (`apps/bbs/src/doors.ts`): listed in the site config under `bbs.doors` (operator only; the
  console can't add one, since each is a command run on the server). For each caller the BBS makes a private
  folder with DOOR32.SYS (11 lines) and/or DOOR.SYS (52-line GAP layout), runs the command (after
  `bbs.door_wrapper`, for a sandbox such as bwrap or nsjail) in its own process group with a minimal
  environment, passes keystrokes straight through and converts between CP437 and UTF-8 as needed. Limits per
  door: callers at once, minutes per visit, lowest role. The folder is removed afterwards. Doors get no
  access to core. VERIFY a real door (e.g. under DOSBox-X) before offering it; only the test door has run here.
- **QWK offline mail** (`apps/core/src/qwk.ts`): the packet (`<BBSID>.QWK`, BBSID = `site.short_name` in
  capitals, 8 characters) holds CONTROL.DAT, MESSAGES.DAT (128-byte blocks, CP437, lines ended by 0xE3, QWKE
  lines for subjects and names over 25 characters), an NDX per conference (MBF block numbers) and DOOR.ID.
  Conferences are the boards you watch (all readable boards if none), numbered once per person
  (`qwk_conferences`) so replies find their board. Message numbers are the posts' site-wide `seq`. Making a
  packet moves the read pointers past it (up to 2,000 messages). A `<BBSID>.REP` (up to 200 messages, 1 MB)
  becomes posts through the ordinary post path, with the same checks; a reference number makes it a reply;
  each REP file is taken once (`qwk_uploads`). Transfer is on the web (Settings → Terminal); **ZMODEM in the
  terminal is not built** (the BBS's QWK menu points to the web). Private mail is not in packets. VERIFY with
  real readers (MultiMail, OLX) before announcing it.
- Compose: service `bbs` (telnet 2323, SSH 2222 locally), Caddy routes `/ws/bbs`. Tests: `apps/bbs/src/*.test.ts`
  (telnet, terminal, and a live test over real sockets against core), `apps/core/src/bbs/bbs.test.ts`.


## As built (M9-C)
Thread lists mark pinned threads `[pinned]`; posts show `(edited)` and reaction counts after the date line. Reacting, editing and pinning stay on the web.

## As built (M9-E1): classics
- **Oneliners** (`O`): 60 characters, one per person per hour, shown at login (the last five) and on the web Home panel. Admins can
  take a line down (audited as `oneliner.hidden`); you can remove your own. People you have blocked do not appear for you.
- **Bulletins** (`I`, "Information bulletins"): numbered notices written by admins. The newest unread one is announced at login; reading
  one counts the older ones as read. (`B` stays Boards.)
- **Voting booth** (`V`): admins and trusted people ask (2–8 choices, optional closing time); everyone confirmed votes once; the tally
  shows after you have voted or when the poll is closed. The web has the same polls under Boards.
- **File areas** (`F`): list areas and files, read a description, and get the download address; the download itself is on the web.
- New art screens in the pack: `newuser` (first call), `oneliners`, `bulletins`, `polls`, `files` and `lastcall` (today's callers, before
  the goodbye). All use `{{site.name}}` and friends; none hard-codes a name.

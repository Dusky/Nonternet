# M0 spike — Enigma½ integration (source read)

**Method:** read the source of ENiGMA½ `0.5.1-beta` (`NuSkooler/enigma-bbs`, default branch,
shallow clone on 2026-09-29). **Nothing was run yet.** Every finding below is from reading
code and is still VERIFY until the runtime checks at the end pass.

## Findings
| Item | Finding | Design impact |
|---|---|---|
| V1 modules | Modules are loaded by category (`login`, `content`, `chat`, `scannerTossers`, `webHandlers`). A module exports `moduleInfo` and `getModule`, and lives in a config-listed path. `webHandlers` modules get the web server and call `addRoute`. | The bridge can be a `webHandlers` module inside the Enigma process, as `04` proposes. |
| Built-in REST API | Enigma already ships a versioned REST API (`core/rest`): JWT login and refresh, `x-enigma-api-key` keys, conferences, areas, message list/read/post/delete, `/users/me`, `/system/info`, `/nodes`, `/stats`. It is off unless `restApi` is enabled. | Covers part of the bridge table (`GET` areas/messages, `/who`, `/stats`). |
| Post authorship | REST `POST /areas/:tag/messages` posts as the authenticated user only. | The bridge needs its own "post as user X" route. It can't reuse REST unless core holds per-user Enigma tokens, which it should not. |
| User create / rename / groups | No REST route creates users, changes groups, suspends, or renames. `PUT /users/me` edits a fixed set of profile fields. | Bridge must provide `POST /users`, `PATCH /users/:id`, kick. Uses Enigma's `User` class, not SQLite. |
| V2 login delegation | `User.authenticateFactor1` checks password (PBKDF2), SSH pubkey or TLS client auth against Enigma's own store. No external-verify hook found. WebSocket login server subclasses the telnet client, so it shows the normal login screen. | Ticket auto-login needs a custom login step. Password verify for telnet/SSH is simplest if the bridge **provisions the terminal password hash into Enigma** rather than delegating each login. Still to prove at runtime. |
| V3 areas at runtime | Areas are read from `config.messageConferences` (in-memory config object loaded at startup). No runtime create API. | Bridge would have to mutate the live config object, or write a config file and reload. Needs runtime test. Fallback: pre-create area pool, or restart on board creation. |
| V4 pointers | Stored in Enigma's `user_message_area_last_read (user_id, area_tag, message_id)`. | Read/write through Enigma's `message_area.js` functions from the bridge. |
| V5 encoding | WebSocket server writes binary frames and reuses telnet client code. No encoding negotiation found in the WebSocket file itself. | Client-side (xterm.js) CP437 handling still to be tested. |
| V6 rename | No rename path found yet. | Still open. |

## Consequences
- **Bridge is likely feasible** as a `webHandlers` module. The fallback (FTN packets plus
  read-only SQLite) looks unnecessary, but the decision waits for runtime proof of 0.1 and 0.3.
- Enigma's built-in REST and its JWT secret must stay disabled or unreachable from outside.
  The bridge listens on the internal network only, with its own shared secret.
- The riskiest unknowns are runtime area creation (0.3) and ticket login (0.2).

## Runtime checks still to do
1. Install and start Enigma (`npm install` builds native modules) with a test config.
2. Bridge stub: `POST /users`, then telnet in as that user.
3. Create an area at runtime, post to it, see the post in telnet.
4. WebSocket login with a ticket, no prompt.
5. UTF-8 and CP437 strings round-trip.

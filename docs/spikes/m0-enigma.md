# M0 spike — Enigma½ integration

**Tested against:** ENiGMA½ `0.5.1-beta` (`NuSkooler/enigma-bbs`, default branch, 2026-09-29),
Node 22, Linux. Stub bridge and scripts: `services/enigma/bridge/`.

**Method:** source read first, then a running instance driven over HTTP, telnet and WebSocket.
Anything not run is marked **not tested**.

## Results by task
| Task | Result | Evidence |
|---|---|---|
| 0.1 Create user, area, post via a module API; see it in telnet | **Pass** | `POST /bridge/users` created `zerocool`; telnet login with that password worked; `POST /bridge/areas/:tag/messages` posts appeared in the login newscan under the author's name |
| 0.2 Ticket login on WebSocket | **Pass, with custom code** | A valid one-time ticket skips the login screen and lands in the post-login sequence; a replayed or invalid ticket is refused. Needs a copy of Enigma's WebSocket login server plus a wrapper (see below). Not tested in a browser or xterm.js |
| 0.3 Areas at runtime | **Pass, but not persistent** | An area added through the bridge was visible in telnet with no restart. It was gone after Enigma restarted |
| 0.4 Encoding | **Partly tested** | A UTF-8 post (`café — ✓ 日本`) displayed intact over telnet for a client reporting a UTF-8 terminal. CP437 clients and xterm.js rendering **not tested** |

## What we learned
- **Modules.** A `webHandlers` module runs inside the Enigma process and can register HTTP
  routes. It can require Enigma's own `User`, `Message` and `persistMessage`. Module loading
  takes the file name from a single directory (`paths.webHandlers`), so the bridge file is
  copied into it.
- **Enigma's built-in REST API** (`core/rest`) can list areas, read messages and show
  nodes/stats, but cannot create users, change groups, rename, or post as someone else. Keep it
  disabled. The bridge has its own routes and shared secret.
- **Users.** `new User()` then `user.create({ password })` works from the bridge. The password
  is stored as Enigma's own PBKDF2 hash, so the terminal password must be provisioned into
  Enigma (doc `02` already says services never store a copy; Enigma is the exception).
- **Ticket login.** Enigma has no external-auth hook. What worked:
  - The bridge wraps `User.prototype.authenticateFactor1` so an `authType` of `ticket` is
    checked against a one-time, 30-second ticket store instead of a password.
  - A copy of `core/servers/login/websocket.js` reads `?handle=&ticket=` from the URL and, at
    the `ready` event, calls Enigma's `userLogin` with that type, then starts at
    `sshConnected` (the menu Enigma already uses for pre-authenticated SSH).
  - The login has to run at `ready`, not in the constructor: `client.log` and `client.user`
    do not exist yet when the constructor runs.
  - The WebSocket server speaks telnet negotiation in-band (terminal type, window size, ANSI
    device queries). The shell's xterm.js window needs a small shim to answer those.
- **Runtime areas.** Areas live in the in-memory `messageConferences` config. The bridge adds
  one by extending that object. **They are lost on restart**, so the bridge must re-register
  every board's area each time Enigma starts. Messages are stored in Enigma's database and
  survive.
- **Read pointers.** The newscan honours per-user last-read pointers (a post shown once was
  not shown again). Reading and writing them from the bridge is **not tested**.
- **Rename.** Enigma has no API for it. Its own `oputil` does a one-line SQL `UPDATE` on the
  `user` table. See open question Q14.
- **Kick / suspend.** `client_connections` exposes active connections and
  `User.AccountStatus.disabled` exists. **Not tested** in the bridge.

## Decision for the M0 gate
Build the bridge as an in-process module (P3 confirmed). The FTN-packet fallback is not
needed. It does depend on three pieces of code that reach into Enigma internals: the
`authenticateFactor1` wrapper, the copied WebSocket login server, and the runtime-area
registration. Pin the Enigma version, and give each one an integration test so an upgrade
that breaks it fails loudly.

## Still to do (belongs in M2)
1. Persist and re-register areas on every Enigma start.
2. Pointers, kick, suspend and `/who` in the bridge.
3. Replace the process-global ticket store with a shared module or a call to core.
4. Browser test: xterm.js with a telnet-negotiation shim, CP437 art and the VGA font.
5. SSH login with a registered key.
6. Decide rename handling (Q14).

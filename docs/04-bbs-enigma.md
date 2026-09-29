# 04 — BBS: Enigma½ Integration

Enigma½ is the BBS (DECIDED). We integrate it; we don't write a BBS.

## What Enigma provides (VERIFY each)
ANSI/art-driven menus, message areas, file areas, door games, telnet/SSH/WebSocket access,
FTN echomail support, SQLite storage, Node.js with custom modules.

**VERIFY items that shape the design**
1. Custom module loading and which internal APIs (users, messages, areas) modules can use.
2. Whether login can be delegated to a module (tickets, external password verify).
3. WebSocket exposure and whether an auth handshake can be injected.
4. Whether message areas can be added at runtime or require reload/restart.
5. How last-read pointers are stored.
6. Encoding over WebSocket (CP437 vs UTF-8).

## The Enigma bridge (PROPOSED)
A custom module **inside the Enigma process** exposing a private HTTP API (internal network
only, shared-secret auth). It uses Enigma's own APIs and never edits SQLite files directly.

| Method | Path | Purpose |
|---|---|---|
| POST | `/users` | upsert user (id, handle, role, ops) |
| PATCH | `/users/:id` | role/groups, suspend, rename |
| POST | `/tickets/redeem` | WebSocket auto-login via core ticket |
| POST | `/verify` passthrough | native login → core verify (if delegation possible) |
| GET/POST/PATCH | `/areas`, `/areas/:tag` | list/create/update areas, ACS |
| GET | `/areas/:tag/messages?cursor=` | headers page |
| GET | `/messages/:id` | full message |
| POST | `/areas/:tag/messages` | post as a local user |
| POST | `/messages/:id/hide` | moderation |
| GET/PUT | `/users/:id/pointers` | last-read pointers |
| POST | `/sessions/:id/kick` | disconnect |
| GET | `/who` | live nodes / connected users |
| GET | `/stats` | node counts, message rates (for the admin console) |

Emits: `bbs.message.created`, `bbs.user.login`, `bbs.user.logout`, `bbs.node.status`.

**Fallback if M0 shows modules can't do this:** read Enigma's SQLite read-only and post by
writing FTN packets to its inbound directory, using an internal echo tag per board. Worse
authorship and latency; log the decision if used.

## Boards ↔ areas
- Each core **board** maps 1:1 to an Enigma **message area** (tag derived from board ID, not
  name, so renames are safe).
- core owns board metadata (owner, ring, visibility, ops). Enigma owns messages and pointers.
- Ring boards are ordinary boards with `ring_id` set (see `06`).

### Visibility → ACS
| Visibility | Read | Post |
|---|---|---|
| public | anyone incl. guests and logged-out web visitors | user+ |
| members | user+ | user+ |
| ring | anyone (read) / ring members (post) — PROPOSED default for ring boards | ring members |
| private | listed members | listed members |

### Role → Enigma groups (PROPOSED)
guest → `guests`; user → `users`; trusted → `users,trusted`; admin → `users,trusted,admins`;
ops handled by per-area ACS lists maintained by the bridge.

## Terminal access
- **In the shell**: xterm.js window over WebSocket, ticket auto-login, VGA-style bitmap font,
  correct CP437 rendering (VERIFY), mobile key bar.
- **Native**: telnet (admin can disable) and SSH with terminal password or SSH key.
- **New users in the terminal**: Enigma's own signup is disabled; the login screen tells
  unknown callers to sign up on the web. (A terminal signup module that calls core is a
  nice later addition.)

## Art pack & branding
Default art pack: login screen, main menu, matrix — all templated with `site.name`. Main menu
mirrors the shell: Boards, Rings, Files, Doors, Chat info, Who's online, Homepages
directory, Settings. Admins can swap the art pack.

## Later
Web view of file areas; door games guide; joining external FTN networks (e.g. fsxNet) as an
ordinary node — Enigma supports this natively and it doesn't conflict with the hosted model.

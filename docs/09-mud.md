# 09 — MUD

**One shared world for everyone** (DECIDED). No areas owned by rings or users.

## Engine (PROPOSED: Evennia; OPEN until the MUD milestone)
| Engine | Pros | Cons |
|---|---|---|
| **Evennia** (Python) | Web client + WebSocket, custom auth backends, easy scripting, good admin | Python beside Node |
| **PennMUSH/TinyMUSH** | Authentic MUSH culture, softcode | Harder web/SSO integration |
| **Custom** | Full control | Large scope |

VERIFIED 2026-09-30 (Evennia 5.0.1, `spikes/m6-evennia.md`): a custom Django auth backend can hand every login to core; its WebSocket protocol is JSON with Evennia markup, so the shell renders it itself.

## Integration
- Auth via core: login ticket (web), terminal password (native).
- One account per user; characters created in-game (limit PROPOSED 3 per account).
- Role mapping: guest → none (or a read-only "observer", OPEN), user → Player,
  admin → Admin/Developer. **Builders** are appointed separately by admins (building is a
  world-level privilege, not tied to trusted) (PROPOSED).
- Shell window (PROPOSED, changed after the spike): an accessible text log like the Chat app, fed by
  Evennia's WebSocket in raw mode, with Evennia's colour markup parsed into styled text. No server
  HTML on the shell's origin. (Was: xterm.js, which would need an ANSI translation layer anyway.)

## World design (OPEN — draft in `18-mud-world.md`)
Setting, starting area, what players do (socializing, exploring, puzzles, economy?), how the
world grows. Admins and appointed builders own the world.

## Admin console hooks
Connected players, rooms with occupancy, builder activity, recent logins, object counts,
world snapshot/backups — see `11`.

# 09 — MUD

**One shared world for everyone** (DECIDED). No areas owned by rings or users.

## Engine (PROPOSED: Evennia; OPEN until the MUD milestone)
| Engine | Pros | Cons |
|---|---|---|
| **Evennia** (Python) | Web client + WebSocket, custom auth backends, easy scripting, good admin | Python beside Node |
| **PennMUSH/TinyMUSH** | Authentic MUSH culture, softcode | Harder web/SSO integration |
| **Custom** | Full control | Large scope |

VERIFY: Evennia custom auth backend, embeddable/replaceable web client, current version support.

## Integration
- Auth via core: login ticket (web), terminal password (native).
- One account per user; characters created in-game (limit PROPOSED 3 per account).
- Role mapping: guest → none (or a read-only "observer", OPEN), user → Player,
  admin → Admin/Developer. **Builders** are appointed separately by admins (building is a
  world-level privilege, not tied to trusted) (PROPOSED).
- Shell window: xterm.js over WebSocket to match the BBS window (PROPOSED), with the engine's
  web client as fallback.

## World design (OPEN — its own design doc later)
Setting, starting area, what players do (socializing, exploring, puzzles, economy?), how the
world grows. Admins and appointed builders own the world.

## Admin console hooks
Connected players, rooms with occupancy, builder activity, recent logins, object counts,
world snapshot/backups — see `11`.

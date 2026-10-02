# 09 — MUD

**One shared world for everyone** (DECIDED). No areas owned by rings or users. World design: `18`.

## Engine (DECIDED 2026-09-30: Evennia 5.0.1)
| Engine | Pros | Cons |
|---|---|---|
| **Evennia** (Python) | Web client + WebSocket, custom auth backends, easy scripting, good admin | Python beside Node |
| **PennMUSH/TinyMUSH** | Authentic MUSH culture, softcode | Harder web/SSO integration |
| **Custom** | Full control | Large scope |

VERIFIED 2026-09-30 (Evennia 5.0.1, `spikes/m6-evennia.md`): a custom Django auth backend can hand every
login to core; its WebSocket protocol is JSON with Evennia markup, so the shell renders it itself.
The game lives in `services/mud` (an Evennia game directory) and runs as its own container.

## Signing in (as built)
- **Nobody has a MUD password.** Every `connect <handle> <password>` goes to core's `/internal/mud/auth`
  (private network, bearer token derived from `MUD_SECRET`). Core accepts the person's **terminal
  password** (`02`) or a **one-use ticket** made for the MUD (`POST /api/v1/mud/ticket`; a chat ticket
  doesn't work here, and the other way round). Evennia's own sign-up is off.
- The MUD window gets a ticket, opens Evennia's WebSocket at `/ws/mud`, waits for the welcome screen
  (VERIFIED: Evennia drops input sent before its session is ready) and sends `connect`.
- **Confirmed users only** (DECIDED, Q4). One Evennia account per person, keyed by core's user id, so a
  rename carries over; the account name is the current handle. Evennia's password on it is unusable.
- Role mapping at every login and on every change: admin → `Developer`, builder → `Builder`, everyone
  else → `Player`. **Builders** are a core op (`mud:world`, role `mud_builder`) that admins appoint from
  the console's MUD tab or a user's dossier; anyone can be one, not only trusted users.
- Up to **3 characters** per account (DECIDED), made in-game with `charcreate` (`18`).
- Known limit: Evennia checks the login with core synchronously, so a slow core pauses the MUD for up
  to 5 s.

## Keeping the MUD in step (as built)
Core pushes everyone's handle, status, role and builder flag to the MUD's `/internal/accounts/sync` on
relevant events (group `mud-sync`) and every five minutes. The MUD renames, changes permissions,
disconnects anyone who is suspended or unconfirmed, and deletes a deleted person's account and characters.
Announcements an admin marks for the MUD go to everyone playing (`/internal/broadcast`).

## Shell window (as built)
A text log like the Chat app, fed by Evennia's WebSocket in raw mode: Evennia's colour markup and the
ANSI codes its menus carry (VERIFIED) are parsed into styled text, drawn toward the theme's colours so they
stay readable. No server HTML reaches the shell's origin. A command line with history. Native clients use
telnet on `mud.public_port` (default 4000). (Was PROPOSED: xterm.js, which would have needed an ANSI layer.)

### The client, as built in the polish phase (P6), measured against Mudlet
Owners' choices: **rules, no code**, and the rules **kept on the account** (`client_settings`, client `mud`, zod schema `mudClientSchema` in
`@app/shared`; exported as `mud/client.json`, brought back by import, erased with the account; at most 256 KB).
- **Log**: Evennia markup and ANSI drawn in full (16 colours, xterm-256 and greys, backgrounds, italic, inverse, underline), always pulled toward the
  theme so every theme stays readable. `|lc…|lt…|le` links are buttons that send their command. 2000 lines kept. Scrolling back splits the screen:
  the newest lines stay in view below. **Find** marks matches and steps through them. **Save the log** as plain text or as a coloured web page
  (everything escaped).
- **Input**: history kept on the account (200, newest first; Up and Down), a command separator (default `;`, doubled to send it as text),
  **speedwalk** (`#3n 2e`) and **repeat** (`#5 kill rat`), a line starting with a space is sent exactly as typed. One line sends at most 50 commands.
- **Aliases**: starts with / is exactly / regular expression; `$1`… `$*` for what follows, `@name` for variables; aliases may use aliases, 8 deep.
- **Triggers**: contains / starts with / is exactly / regular expression over each line (colours removed), with up to 8 actions: send, colour
  the match or the line, hide the line, copy it to a named side window, chime, desktop notice when the tab is in the background, set a variable
  from a capture. Triggers may send at most 40 commands per 10 seconds; past that they pause and say so.
- **Timers** (every N seconds while playing, start off), **keys** (F-keys, Ctrl/Alt combinations, the number pad; the number pad walks by
  default), **buttons** under the log, **variables**, and **groups** to turn several rules on or off at once.
- **Side panel**: health and experience gauges (`<meter>` with words), level, coins, fighting and weakened; a mini-map of the rooms this
  character has been in, drawn from `room_info`/`area_map` with the room you are in marked, and the ways out as buttons (the map in words);
  captured-line windows as tabs with unread counts. It can be hidden, and on a narrow screen it goes under the log.
- **Options**: separator, speedwalk, echo, number pad, side panel, screen reader mode (Evennia's own `client_options`), text size.
- **Share**: rules saved as a JSON file (history left out) and brought back in, either added to yours or replacing them.
- Not built, compared with Mudlet: Lua scripting (decided: rules only), a full mapper that you edit by hand, multiple profiles per
  account, sound packs and MSP, and multi-session tabs.
- Tests: `engine.test.ts`, `markup.test.ts`, `log.test.ts` in the shell; e2e `mud.spec.ts` (gauges, map, exits, alias, trigger, button,
  speedwalk, history after reload, axe).

## What the MUD tells a client besides text (as built, P5)
Two Evennia outputfuncs (`services/mud/world/oob.py`), so the web client gets `["vitals", [], {...}]` and `["room_info", [], {...}]` frames, and a telnet
client gets them over GMCP (`TELNET_OOB_ENABLED = True`, for Mudlet and friends):
- **vitals**: `hp, hp_max, level, xp, xp_next, coins, weakened, in_combat`. Sent on entering a character and whenever one of the first five changes
  (they are `Watched` attributes on `Character`), and when you are beaten.
- **room_info**: `id, name, area {key, name}, coord [x, y, z], exits [{name, aliases, to}]`. Sent on entering a character, on every move, and when a search
  finds a hidden way. A hidden exit is listed only for someone who has found it.
- The client can ask too (inputfuncs `vitals_get`, `room_get`, `area_map`). `area_map` lists the rooms of the current area **this character has been
  in** (kept in `db.visited`, newest 2000), with positions and exits, so a map never shows a room you have not seen.
- Every built room has an area and a position (`world/mapdata.py`, applied on every build). Rooms builders add in-game have none and stay off the map
  until a builder sets `db.area` and `db.coord`.
- Screen-reader mode is Evennia's own `client_options {screenreader: true}` (VERIFIED in 5.0.1: the webclient then strips decorative characters).
- Tested in `tests/test_oob.py` and through a real Evennia in core's `mud/sync.test.ts`.

## Characters around the site (as built)
The point of the MUD for the rest of the site is that characters show up elsewhere. Core keeps a copy of every
character in `mud_characters` (name, level, XP, HP, coins, the six abilities; keyed `c_<MUD object id>`), pulled from
the MUD's `/internal/characters` after each sync pass, every two minutes, and at once when the MUD says a character was
made (`/internal/mud/characters-changed`). Not copied: where a character is (that would say where the person is right
now) and what it carries. Any part of the site reads characters from core, never from the MUD:
- **Profiles** (`GET /api/v1/users/:handle`, public, the People app): the person's characters with their stats.
- **Featured character**: a person picks one in Settings → Profile (`PUT /api/v1/me/featured-character`); board posts
  carry it as `author.character` and show "as Tansy, level 4" beside the name. A character deleted in the MUD drops out
  of the copy, its badge goes and the choice is cleared.
- New features (rings, homepages, the BBS) use the same `CharacterView` / `CharacterBadge` types from `@app/shared`.

## Ownership
Each person's characters (sheet, abilities, HP, level, coins, where they are, what they carry) join their
export as `mud/characters.json` (`12`). If the MUD is set up but not answering, the export fails rather than
leave them out. Deleting an account deletes its characters.

## Admin console hooks (as built)
MUD tab: who is playing, as which character and where, how they connected; busiest rooms; counts of
accounts, characters, rooms and things; builders (appoint and remove, audited). Not built: builder
activity, recent logins, world snapshots in the console (the world is in the nightly backup, `15`).

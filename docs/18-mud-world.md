# 18 — MUD world design (DRAFT)

Status: **draft for discussion.** Everything here is OPEN or PROPOSED until the owners agree it. The
engine is PROPOSED as Evennia (spike in `spikes/m6-evennia.md`); one shared world is DECIDED (D9).

## What the MUD is for
The rest of the site is for reading, writing and making pages. The MUD is the site's **place**: somewhere
to hang out with people in real time, wander, and find small things other people made. It should feel
like the old internet's text worlds: talky, a bit strange, easy to learn, never a grind.

Goals (PROPOSED):
1. **Social first.** Rooms to sit and talk in, emotes, a few shared toys. Most visits are ten minutes of chatting.
2. **Worth wandering.** Enough odd corners, notes and small puzzles that exploring pays off.
3. **Grows by hand.** Admins and appointed builders add to it; no procedural filler.
4. **Low stakes.** No combat or economy at launch. Nothing to lose, so nothing to grief over.

Non-goals at launch: combat, levels, money, crafting, player-owned land (D9 rules out owned areas anyway).

## Setting (OPEN: pick one)
| Option | Pitch | Why it fits | Risk |
|---|---|---|---|
| **A. The Exchange** (recommended) | An old telephone exchange that grew into a small town overnight. Switchboard halls became streets; each line leads somewhere new. | Echoes the site's theme (lines, boards, rings) without naming it; new areas are "new lines", so growth has a built-in story. | Needs a light touch to stay charming rather than twee. |
| B. Late-night mall | A shopping arcade after closing, lights humming, shops that sell things that don't exist. | Instantly readable, strong mood, lots of small rooms. | Mood is narrow; can feel samey as it grows. |
| C. Floating archipelago | Islands connected by ferries and bridges; each island a different tone. | Easy to add islands with different flavours. | Generic fantasy pull; less connected to the rest of the site. |

Names of places are written into the world by builders, not the code, so the setting can change
without code changes. Nothing in the world uses the site's placeholder name.

## Starting area (PROPOSED, for option A)
- **The Lobby Switchboard**: where everyone arrives. A board of plugs; `look plugs` lists the lines that
  are open. Always has a few people in it once the site is busy.
- **The Break Room**: the main place to sit and talk. Kettle, a noticeboard that shows the latest site
  announcement, a couch that remembers who last sat on it.
- **Directory Hall**: a long corridor of doors, one per open area, with a short sign each.
- **Lost & Found**: where objects left lying around end up after a day, so rooms stay tidy.
- A **tutorial line** of four rooms that teaches `look`, `say`, `emote`, `go`, `get`, `read` in five minutes,
  skippable.

## What people do
- **Talk**: `say`, `emote`, `whisper`, `ooc`; per-room chat history of the last 20 lines when you arrive.
- **Explore**: readable notes, hidden exits found by looking closely, small single-player puzzles
  (a combination lock, a radio you tune). Finding things marks them in your character's journal.
- **Leave traces**: sign a room's guestbook, pin a note to a noticeboard (moderated like posts,
  and included in the export as your content).
- **Collect**: a few "souvenirs" per area, kept in your inventory; purely for fun.
- Later (OPEN): shared games (cards, dice), seasonal events run by admins, light economy.

## Characters (PROPOSED)
- One account per user (from core); up to **3 characters** per account, each with a name, short
  description and pronouns. Character names are unique and can't be someone else's handle.
- Your journal, notes, guestbook entries and souvenirs are your content and join the export (`12`).
- Observer mode for guests (Q4): OPEN. Suggest **no** at launch, matching IRC (confirmed users only).

## Building and ownership (PROPOSED)
- Admins appoint **builders** from the console (a core role, mapped to Evennia's `Builder` permission).
- Builders work in a **sandbox line** first; an admin opens a new line to everyone. Each area has a
  listed builder and a short brief so the world stays coherent.
- Builds are text (rooms, exits, objects, descriptions) stored in the game database; nightly world
  snapshots go into the site's backups (`15`).
- A style guide for builders (tone, length of descriptions, no in-jokes that need explaining).

## Moderation (PROPOSED)
Site rules apply. Ops tools: mute in a room, move someone to the Break Room, freeze a character; every
action audited in core (`03`). Suspension drops MUD sessions within 5 s (`02`).

## Questions for the owners
1. Setting: A, B, C, or something else?
2. Is "no combat, no economy at launch" right?
3. Guest observers (Q4): no at launch?
4. Three characters per account, or one?
5. Who builds the first areas, and how many areas should exist at launch (suggest: starting area + 3 lines)?

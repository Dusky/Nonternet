# 18 — MUD world design

Status: owners' decisions of 2026-09-30 are marked DECIDED; the rest is PROPOSED (the default until
someone changes it) or OPEN. Engine: **Evennia** (DECIDED, Q6; spike in `spikes/m6-evennia.md`).
One shared world (DECIDED, D9).

## What the MUD is for
The rest of the site is for reading, writing and making pages. The MUD is the site's **place**: a small
fantasy world to adventure in with other people in real time, and to hang out in between.

## Setting (DECIDED: generic fantasy)
A classic sword-and-sorcery world: a market town with a tavern, temple and guild halls, wild country
around it, and dungeons under it. Familiar on purpose, so newcomers know what to expect.
Place names and descriptions are written into the world by builders, not the code, and nothing in the
world uses the site's placeholder name.

## Rules and starting code (PROPOSED)
Build on Evennia's **EvAdventure** example game (`evennia.contrib.tutorials.evadventure`, BSD): Knave
rules (classless, early-D&D-like, CC-BY; credit on the MUD's help and about screens), character creation
from a character sheet, weapons and armour, healing and rest, three spells, monsters with simple AI,
quests and shops. It is marked work-in-progress upstream, so we import it and override what we change,
with our own tests, and pin the Evennia version.

## Combat (DECIDED: at launch; details PROPOSED)
- **Turn-based** (EvAdventure's `combat_turnbased`): each round you pick an action. Works with screen
  readers and on phones, unlike real-time "twitch" combat.
- **Monsters only by default.** Fighting another person needs both to agree (`duel <name>`), and only
  outside town. No looting other people.
- **No permanent death.** At 0 HP you wake at the temple with a short "weakened" effect; you keep your
  gear. (Knave's real death is too harsh for a social site.)
- New characters start with 10 coins (PROPOSED), enough for a first purchase at the market.
- Levels and gear come from Knave; a small economy follows from it (coins from monsters and quests,
  a few shops). Balance is tuned by builders after launch.
- Grief limits: no fighting in town, a cooldown after a duel, ops can freeze a character (`03`).

## Starting area (PROPOSED)
- **Town square**: where everyone arrives; a noticeboard shows the latest site announcement.
- **The tavern**: the main place to sit and talk; safe, no fighting.
- **Temple**: where you wake after defeat; healing for a few coins.
- **Market**: a weapon smith, an outfitter and a general store (EvAdventure shops).
- **Training yard**: a sign tells new people the basics (movement, inventory, wielding), and it is the one place for friendly duels (below). There is no practice dummy; the first real fight is the wild dog on the road.
- **The old road and the cellar dungeon**: the first adventure for new characters.

## What people do
- **Adventure**: quests, dungeons, monsters, loot.
- **Talk**: `say`, `emote`, `whisper`, `ooc`; the tavern is always safe.
- **Explore**: readable notes, hidden exits, small puzzles.
- **Leave traces**: sign a guestbook in the tavern, pin notes to the town noticeboard (moderated like
  posts and included in your export).

## Characters (DECIDED)
- One account per user (from core); up to **3 characters** per account, made with EvAdventure's
  character sheet. Character names are unique and can't be someone else's handle.
- **No guests**: like IRC, only confirmed users can enter (Q4 resolved for the MUD).
- Your characters (sheet, inventory, quest log), notes and guestbook entries are your content and join
  the export (`12`).

## Building and ownership (PROPOSED)
- Admins appoint **builders** from the console (a core role, mapped to Evennia's `Builder` permission).
- Builders work in a sandbox area first; an admin opens a new area to everyone. Each area has a listed
  builder and a short brief so the world stays coherent.
- The world lives in Evennia's database; nightly world snapshots go into the site's backups (`15`).
- A style guide for builders (tone, description length, monster and loot balance).

## Moderation (PROPOSED)
Site rules apply. Ops tools: mute in a room, move someone to the temple, freeze a character; every
action audited in core (`03`). Suspension drops MUD sessions within 5 s (`02`).

## As built (M6)
- EvAdventure character sheet (`charcreate`, up to 3), with our own item prototypes (upstream ships none)
  and a fix for its charisma roll; names must be new and can't be another person's handle.
- Turn-based combat against monsters in wild rooms; town rooms refuse all fighting; defeat carries you to
  the temple at half HP, gear kept, weakened for 5 minutes.
- Starting town built by `world/build_town.py` on first start (square, tavern, temple, market, training
  yard, the old road, a cellar and a goblin den with three monsters that come back 3 minutes after they
  are beaten). A developer can rerun it with `buildtown`.
- Built in M9-E3: two adventure areas, the first quest, working shops, a tavern noticeboard, and the weakened effect
  changing rolls (below). Not built yet: duels between players and the tavern guestbook.

### As built (M9-E3)
- **Areas** (`world/areas.py`): the **Bandit Woods** (9 rooms, from the old road: `woods`) and the **Flooded Mine** (9 rooms, from the old
  road: `mine`), with readable notes (`read <thing>`), wolves, bandits and a bandit chief, rats, spiders, a rubble crawler and a drowned miner.
  One way in each is hidden: `search` finds it for the person who searched (stored on the character), and until then the exit
  is not listed and cannot be used by name. Built idempotently by `buildtown`.
- **Quest: the lost ledger** (`world/quests.py`, `quests` shows progress): `ask marta` in the tavern, find the bandit camp and `search` it
  (a scrap of paper in the hollow oak says where), bring the ledger back for 25 coins and 25 xp. Paid once; a lost ledger just sends you
  back to find another. State is a small record on the character, not EvAdventure's quest classes.
- **Shop** (`world/shop.py`; `shop`, `buy`, `sell` in the market): prices are item values; Odo pays half (at least 1) and the things he buys are
  destroyed. Quest items are worth nothing to him.
- **Noticeboard** (`world/noticeboard.py`; `board`, `post`, `unpost` in the tavern): notes up to 200 characters, one a minute, newest 30 kept;
  the author, a builder or an admin can take one down; colour codes in a note are shown, not run. In the export (`noticeboard_notes`,
  with each character's `quests`) and removed when the account is erased.
- **Guestbook** (`world/guestbook.py`; `guestbook [page]`, `sign`, `unsign` in the tavern): the same rules as the noticeboard (200 characters, one a
  minute) but the newest 100 are kept and it reads newest first, ten to a page. In the export (`guestbook_entries`) and removed when the account is erased.
- **Moderation is audited.** When a builder or admin takes down someone else's note or guestbook line, the MUD tells core (`world/audit.py` →
  `POST /internal/mud/audit`), which writes `mud.note_removed` or `mud.guestbook_removed` with the actor, the author and the text. Taking down your own is not reported.
- **Duels** (`world/duels.py`, `commands/duel_cmds.py`; `duel <name>`, `accept`, `decline`, `yield`): only in the training yard (`YardRoom`, `allow_pvp`), and only
  when both people agree. The room flag lets the combat handler fight person against person; our `attack` is what checks consent, so nobody can hit a person who
  has not agreed, and a third person can't join. A challenge lapses after 30 seconds. Walking out of the yard, yielding or losing ends it. Losing costs nothing:
  you stay in the yard at half hit points, not weakened, not sent to the temple. Everywhere else a defeat is as before. VERIFIED against Evennia 5.0.1 that its
  turn-based handler fights two people in such a room.
- **Weakened** (`world/rules_patch.py`): for five minutes after a defeat every roll, attack or save, is one lower.

## Still open
1. ~~How many areas at launch?~~ **Answered 2026-10-01 (M9-E3): the town plus two adventure areas** (the Bandit Woods and the Flooded Mine, nine rooms each). Logged in `17`.
2. Who builds the first areas?

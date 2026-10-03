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
- **The old road and the cellar dungeon**: a first fight for new characters.
- **Tower gate** (northeast of the square, `tower`): the way into the tower (below). The tower is now what the MUD is about.

## What people do
- **Adventure**: quests, dungeons, monsters, loot.
- **Talk**: `say`, `emote`, `whisper`, `ooc`; the tavern is always safe.
- **Climb**: the tower's floors, their guards and bosses, the gear they drop, and the season's leaderboard. No puzzle rooms (owner, 2026-10-03).
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
- **Retired 2026-10-03** (for the tower, below): the Bandit Woods, the Flooded Mine and the lost ledger quest. A world built before then loses
  them on the next build (`retire_old_areas`); anyone standing there is moved to the square and keeps what they carry. Old quest records stay
  on the character and in the export. What follows is kept for the record.
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

## The tower (owners' choice, 2026-10-03)
One shared tower that everyone climbs, built from rules instead of by hand. The owners' choices:
- endless, harder as you go;
- rebuilt each month (seasons), with characters, levels and gear kept;
- personal loot and timed respawns;
- a defeat sends you back to your last checkpoint;
- the town stays as the hub;
- variety comes from hand-written parts combined by a seed, with no live AI text.

The full plan is phases T1–T5 (`16`).

### As built (T1: the generator)
- **Seasons and seeds** (`world/tower/seed.py`): the season number and its seed live in Evennia's `ServerConfig` (`tower_season`). The same seed
  always gives the same floors.
- **Floors** (`world/tower/layout.py`, `floors.py`):
  - a floor is built the first time anyone climbs to it, as 5 rooms low down, growing to 9 by floor 20;
  - rooms are grown on a grid from the entry at (0, 0), with an occasional loop;
  - the stair up is in the room farthest from the entry;
  - everything carries `tower`-category tags (`season:<n>`, `room:<season>:<floor>:<x>:<y>`), so a season can be cleared without touching
    what players carry.
- **Rooms** (`world/tower/tables.py`): 15 kinds of room with two descriptions each, plus 19 optional details, written by hand.
- **The stair guard**:
  - each floor's stair up is held by a guard (see T2 for who it is);
  - beating it opens the stair for everyone in the room at the time, and only for them (`TowerStair`, per character and per season);
  - the guard comes back after three minutes for the next person.
- **Progress** (`db.tower`): the season, the floors whose stairs you opened, and your highest floor. It starts fresh each season and is in
  the export (`characters[].tower`).
- **Map**: each floor is its own area ("Floor 3"), so the client's map shows one floor at a time.
- **Writing rules** ("keep AI slop low"), checked by `tests/test_tower_text.py`:
  - one or two plain, physical sentences;
  - no stock filler words ("ancient", "mysterious", "whispers"…);
  - no dashes or exclamation marks for effect;
  - length caps;
  - no two lines starting the same way;
  - plain names.

### As built (T2: enemies and difficulty)
- **Families** (`tables.FAMILIES`), ten floors each, then the list starts again with higher numbers:
  - vermin, bandits, constructs, undead, cultists, beasts;
  - four members each (weak, normal, strong) with one-line descriptions;
  - each family hits with its own weapon (teeth, blade…).
- **Traits** make one enemy different and are in its name: armoured (+2 armour), hulking (more health), venomous (a hit burns for 1d4
  more, half the time), fierce (+1 hit die).
- **Who stands where** is part of the seed (`floors.enemy_plan`):
  - rooms get 0–3 enemies, more often higher up;
  - nobody waits at a floor's entry;
  - the stair room has the guard: the family's strongest member (no trait below floor 10, one trait above, two on a boss floor).
- **Bosses**: the Rat Mother (floor 10), Captain Hesk (20) and the Forge Engine (30), written by hand. Later boss floors use the family's
  strongest member with two traits.
- **All the numbers are in one file** (`world/tower/scaling.py`): enemy hit dice, armour, health, damage dice, xp and coins by floor, plus the
  kit a climber is expected to have (the target for T3's loot).
- **Rewards**: when an enemy falls, everyone in the room gets its xp and coins, each their own.
- **Levels**:
  - the next level needs level² × 50 xp in total (50, 200, 450…);
  - each level raises your three weakest abilities by one (to +10 at most) and your health by 1d6;
  - EvAdventure's own `level_up` is not used: it reads an attribute that doesn't exist.
- **`rest`** (Knave's 1d8 + constitution) heals out of a fight, when no enemy is in the room, once every 20 seconds.
- **Fix**: enemies, and the town's monsters, used to start at 4 health whatever their hit dice. They now start full.
- **Balance**: `world/tower/balance.py` simulates an expected climber (the level the xp curve gives, the expected kit) against the enemies
  of a floor. Run `python -m world.tower.balance`. The tuned curve, 1000 fights each, a fresh climber per fight:

  | floor | level | room fight won | health lost | stair guard won (alone) |
  |---|---|---|---|---|
  | 1 | 1 | 88% | 26% | 89% |
  | 5 | 2 | 94% | 22% | 97% |
  | 10 | 3 | 84% | 37% | 46% (boss) |
  | 20 | 6 | 78% | 49% | 60% (boss) |
  | 30 | 11 | 76% | 57% | 74% (boss) |
  | 50 | 19 | 80% | 56% | 88% (boss) |
  | 80 | 31 | 74% | 62% | 76% |
  | 100 | 39 | 52% | 75% | 52% (boss) |

  Bosses are meant to be hard alone; bring friends. `tests/test_tower.py` keeps the first floors kind and the middle never hopeless.
  The simulator is a model, not the game. Play-testing comes after T3, when the gear it assumes exists.

### As built (T3: gear and loot)
- **Personal drops** (`world/tower/loot.py`):
  - when an enemy falls on a tower floor, each person in the room rolls their own find: a 25% chance from an ordinary enemy, always from
    the stair guard;
  - nothing lies on the floor for anyone to grab;
  - a find that won't fit in the pack waits in your **spoils** (up to ten; `spoils`, then `claim <number>`).
- **What drops**: weapons (knife, sword, mace, hand axe, and the two-handed spear and maul), body armour, helmets and shields.
  - Gear moves up a tier every 12 floors, and the tier is in the name (rough, iron, steel, tempered, masterwork; body armour goes quilted
    coat, leather coat, mail shirt, scale coat, plate coat).
  - Past the last tier a number counts up: "masterwork sword +2".
  - Strength follows the kit in `scaling.py`, so drops match what the balance simulator assumed.
- **Rarity**: common, fine (+1 damage step or armour), rare (one affix), epic (fine plus two affixes). Rarer finds get likelier with height.
- **Affixes**: what each does is in its name and its description, and each does something real:
  - heavy: damage dice one step bigger;
  - brutal: +2 damage per hit;
  - leeching: each hit heals you 1;
  - reinforced: +1 armour;
  - of warding: each hit taken does 1 less;
  - of thorns: whoever hits you takes 1.
- **Selling**: Odo pays half an item's value, and value rises with floor and rarity.
- **Run loot**: finds are marked `unbanked`; T4 decides what a defeat costs.
- **Export**: carried gear was already in it; waiting spoils are too now (`characters[].spoils`).

### As built (T4: checkpoints, defeat and seasons)
- **Checkpoints**: beating a boss (floors 10, 20…) sets your checkpoint for the season and makes everything you carry safe.
  `ascend` at the tower gate takes you to the floor above your checkpoint.
- **Landings**: the floor after each boss (11, 21…) starts on a landing with Sela, a trader (`shop`, `buy`, `sell` at market prices), and a
  `home` exit straight to the gate. Shop messages name whoever keeps the shop.
- **Defeat**: you wake in the temple as before, keeping your character, level, coins and everything worn or wielded. Finds still in your
  pack since your last checkpoint are lost, and the message lists them.
- **Seasons** (`world/tower/seasons.py`, script `tower_season`, checked hourly):
  - on a new month (UTC) the tower is rebuilt from a new seed and anyone inside is moved to the gate;
  - everything tagged with the old season is deleted: rooms, exits, enemies, their weapons, the trader. Nothing a player carries has that
    tag, so nothing carried is touched;
  - the top ten of the season are kept in a short history (`ServerConfig` `tower_history`, the last 24 seasons);
  - progress and checkpoints start again;
  - everyone online is told.
- **`season`** shows the season, days until the rebuild, your highest floor and checkpoint, and the five highest climbers.

### As built (T5: the tower on the site)
- **The MUD reports each character's climb** (`/internal/characters`: `tower {season, best, checkpoint}`), and nudges core whenever someone's
  highest floor rises, so the site follows within a moment.
- **Core keeps the climb** on its copy of each character (`mud_characters.tower_season`, `tower_best`, `tower_checkpoint`, migration 0035).
- **Leaderboard**: `GET /api/v1/mud/leaderboard`, signed in only. It ranks the highest floors of the latest season anyone has climbed in, ties
  going to the higher level, active people only.
- **Shown** on the home panel (top five, when the MUD is on), in the console's MUD page (top twenty), and on each character's card on a
  profile ("Tower: floor 12 in season 2").
- **Export**: `mud/characters.json` already carries each character's `tower` and `spoils` (T1, T3).

## Still open
- ~~Puzzle rooms in the tower?~~ **Ruled out 2026-10-03 (owner).** The tower is fighting, gear and climbing. Still open: traps and merchants inside the tower, and sharing loot within a party.
1. ~~How many areas at launch?~~ **Answered 2026-10-01 (M9-E3): the town plus two adventure areas.** Replaced 2026-10-03 by the tower (above).
2. Who builds the first areas?

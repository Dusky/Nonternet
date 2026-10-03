"""
Building tower floors (docs/18). A floor is made the first time anyone climbs to it, from the season's seed, and stays
until the season ends. Everything made here carries tags in the "tower" category, so it can be found and, at the end of a
season, removed without touching anything a player carries.

Progress is kept per character for the current season: which floors' stairs they have opened, and the highest floor reached.
"""
from evennia import create_object, search_tag

from world.tower import layout, scaling, seed, tables

CAT = "tower"
ROOM = "typeclasses.rooms.TowerRoom"
EXIT = "typeclasses.exits.Exit"
STAIR = "typeclasses.exits.TowerStair"
ALIASES = {"north": ["n"], "south": ["s"], "east": ["e"], "west": ["w"]}


def _one(tag):
    found = search_tag(tag, category=CAT)
    return found[0] if found else None


def room_at(season, floor, coord):
    return _one(f"room:{season}:{floor}:{coord[0]}:{coord[1]}")


def entry(floor, season=None):
    """The room you arrive in on this floor, building the floor (and any below it) if it isn't there yet."""
    s = season or seed.current()
    ensure_floor(floor, s)
    return room_at(s["season"], floor, (0, 0))


def stair_room(floor, season=None):
    s = season or seed.current()
    ensure_floor(floor, s)
    return _one(f"stair:{s['season']}:{floor}")


def plan(floor, seed_value):
    """What a floor will be, without making anything: cells, stair, and a (kind, text) per cell. Same seed, same plan."""
    rng = seed.rng(seed_value, "floor", floor)
    cells, stair = layout.layout(rng, layout.room_count(floor))
    kinds = list(tables.ROOM_KINDS)
    rng.shuffle(kinds)
    rooms = {}
    for i, coord in enumerate(sorted(cells)):
        kind = kinds[i % len(kinds)]
        text = rng.choice(tables.ROOM_KINDS[kind])
        feature = rng.choice(tables.FEATURES)
        if feature:
            text = f"{text} {feature}"
        if coord == stair:
            text = f"{text} {tables.STAIR_LINE}"
        rooms[coord] = (kind, text)
    return cells, stair, rooms


def ensure_floor(floor, s=None):
    """Builds the floor if this season doesn't have it yet. Returns how many rooms it made (0 if it was there)."""
    s = s or seed.current()
    season = s["season"]
    if _one(f"floor:{season}:{floor}"):
        return 0
    below = None
    if floor > 1:
        ensure_floor(floor - 1, s)
        below = _one(f"stair:{season}:{floor - 1}")
    cells, stair, rooms = plan(floor, s["seed"])
    made = {}
    for coord, (kind, text) in rooms.items():
        room = create_object(ROOM, key=kind, attributes=[
            ("desc", text), ("area", f"floor{floor}"), ("area_name", f"Floor {floor}"),
            ("coord", [coord[0], coord[1], 0]), ("floor", floor), ("season", season),
        ])
        room.tags.add(f"room:{season}:{floor}:{coord[0]}:{coord[1]}", category=CAT)
        room.tags.add(f"season:{season}", category=CAT)
        made[coord] = room
    made[(0, 0)].tags.add(f"floor:{season}:{floor}", category=CAT)
    made[stair].tags.add(f"stair:{season}:{floor}", category=CAT)
    for (x, y), doors in cells.items():
        for d in sorted(doors):
            dx, dy = layout.DIRS[d]
            _exit(EXIT, d, ALIASES[d], made[(x, y)], made[(x + dx, y + dy)], season)
    # Down to the stair room of the floor below, or out to the gate from floor 1.
    down_to = below or _gate()
    if down_to:
        _exit(EXIT, "down", ["d", "downstairs"], made[(0, 0)], down_to, season)
    # Up: kept shut for each person until they beat this floor's guard. It leads nowhere until the floor above exists.
    up = _exit(STAIR, "up", ["u", "upstairs", "climb"], made[stair], made[stair], season)
    up.db.floor = floor
    populate(floor, s, made, stair)
    return len(made)


def _exit(typeclass, key, aliases, here, there, season):
    e = create_object(typeclass, key=key, aliases=aliases, location=here, destination=there)
    e.tags.add(f"season:{season}", category=CAT)
    return e


def _gate():
    found = search_tag("room:gate", category="build")
    return found[0] if found else None


def enemy_plan(floor, seed_value, coords, stair):
    """Who stands where on a floor: [(coord, name, description, role, traits, is_guard)]. Same seed, same enemies."""
    rng = seed.rng(seed_value, "enemies", floor)
    fam = scaling.family(floor)
    common = [m for m in fam["members"] if m[1] != "strong"]
    out = []
    for coord in sorted(coords):
        if coord in ((0, 0), stair):
            continue
        for _ in range(scaling.enemies_in_room(floor, rng)):
            name, role, desc = rng.choice(common)
            traits = (rng.choice(tables.TRAITS),) if rng.random() < scaling.trait_chance(floor) else ()
            out.append((coord, name, desc, role, traits, False))
    role, traits = scaling.guard(floor)
    if floor in tables.BOSSES:
        name, desc = tables.BOSSES[floor]
    else:
        name, _r, desc = [m for m in fam["members"] if m[1] == "strong"][0]
    out.append((stair, name, desc, role, traits, True))
    return out


def populate(floor, s, rooms, stair):
    fam = scaling.family(floor)
    for coord, name, desc, role, traits, is_guard in enemy_plan(floor, s["seed"], rooms, stair):
        boss = is_guard and floor in tables.BOSSES
        key = name if boss else " ".join([*traits, name])
        spawn_enemy(rooms[coord], floor, key, desc, role, traits, fam["weapon"], s["season"], is_guard, boss)


def spawn_enemy(room, floor, key, desc, role, traits, weapon_name, season, is_guard=False, proper=False):
    stats = scaling.enemy(floor, role, traits)
    weapon = create_object("evennia.contrib.tutorials.evadventure.objects.EvAdventureWeapon", key=weapon_name,
                           attributes=[("damage_roll", stats["damage"])])
    weapon.location = None
    weapon.tags.add(f"season:{season}", category=CAT)
    mob = create_object("typeclasses.monsters.Monster", key=key, location=room, home=room, attributes=[
        ("desc", desc), ("hit_dice", stats["hit_dice"]), ("armor", stats["armor"]), ("hp_multiplier", stats["hp_multiplier"]),
        ("coins", stats["coins"]), ("xp", stats["xp"]), ("traits", list(traits)), ("weapon", weapon), ("season", season),
    ] + ([("warden_floor", floor)] if is_guard else []) + ([("proper_name", True)] if proper else []))
    mob.hp = mob.hp_max  # health is set at creation, before the hit dice above are in place
    mob.tags.add(f"season:{season}", category=CAT)
    return mob


# ---------------------------------------------------------------- progress

def progress(char):
    """This season's record for the character: {"season", "cleared": [floors], "best"}. A new season starts it fresh."""
    season = seed.current()["season"]
    p = dict(char.db.tower or {})
    if p.get("season") != season:
        p = {"season": season, "cleared": [], "best": 0}
    return p


def has_cleared(char, floor):
    return floor in progress(char)["cleared"]


def mark_cleared(char, floor):
    p = progress(char)
    if floor not in p["cleared"]:
        p["cleared"] = sorted([*p["cleared"], floor])
    char.db.tower = p


def reached(char, floor):
    p = progress(char)
    if floor > p["best"]:
        p["best"] = floor
        char.db.tower = p

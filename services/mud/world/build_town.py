"""
The starting town at the foot of the tower (docs/18). Idempotent: each thing carries a build tag, so running this again
only makes what is missing. It runs on the first start (server/conf/at_initial_setup.py); a developer can run it
again with `buildtown`. Builders extend the world in-game; this only lays the first stones.
"""
from evennia import DefaultExit, create_object, search_object, search_tag

BUILD = "build"

ROOMS = {
    # key: (typeclass, name, description, extra tags)
    "square": ("typeclasses.rooms.Room", "Town square",
               "Cobbles worn smooth by a thousand carts. A well stands in the middle, and a noticeboard leans against it. "
               "The tavern's lit windows are to the east, the temple's steps to the north, the market to the west. "
               "A road leaves town to the south.", ["start"]),
    "tavern": ("typeclasses.rooms.Room", "The tavern",
               "Low beams, a crackling hearth and long tables scarred by knives and dice. Nobody fights in here; "
               "the landlady has seen to that.", []),
    "temple": ("typeclasses.rooms.Room", "Temple of the Dawn",
               "Cool stone and quiet. Pallets line one wall for the wounded; a priestess walks between them. "
               "Those beaten in the wilds wake here.", ["respawn"]),
    "market": ("typeclasses.rooms.Room", "Market",
               "Stalls under striped awnings: a smith's anvil ringing, an outfitter's racks of cloaks and packs, "
               "a stall of odds and ends.", []),
    "yard": ("typeclasses.rooms.YardRoom", "Training yard",
             "A square of packed earth behind the temple, with straw targets and a rack of blunt practice weapons. "
             "A sign reads: TYPE 'help' TO LEARN. TYPE 'inventory' TO SEE WHAT YOU CARRY. 'wield' A WEAPON BEFORE THE ROAD. "
             "TO TEST YOURSELF AGAINST A FRIEND, 'duel <name>': BOTH MUST AGREE, AND NOBODY IS HURT FOR REAL.", []),
    "gate": ("typeclasses.rooms.Room", "Tower gate",
             "An iron door stands open in the base of the tower. Past it, a stone stair goes up into the dark.", []),
    "road": ("typeclasses.rooms.WildRoom", "The old road",
             "Past the last cottages the road turns to ruts between hedges. Something rustles in the ditch. "
             "A collapsed farmhouse has a cellar door hanging open.", []),
    "cellar": ("typeclasses.rooms.WildRoom", "Farmhouse cellar",
               "Damp stone, the smell of rot and old apples. Barrels lie smashed. Scratching comes from deeper in.", []),
    "den": ("typeclasses.rooms.WildRoom", "The goblins' den",
            "A hollow dug out behind the cellar wall. Bones, a stolen pot, and a nest of rags.", []),
}

EXITS = [
    # from, to, name, aliases, back name, back aliases
    ("square", "tavern", "east", ["e", "tavern"], "west", ["w", "out", "square"]),
    ("square", "temple", "north", ["n", "temple"], "south", ["s", "out", "square"]),
    ("square", "market", "west", ["w", "market"], "east", ["e", "out", "square"]),
    ("temple", "yard", "back", ["yard", "training"], "temple", ["out"]),
    ("square", "road", "south", ["s", "road"], "north", ["n", "town"]),
    ("square", "gate", "tower", ["northeast", "ne", "gate"], "out", ["southwest", "sw", "square", "town"]),
    ("road", "cellar", "cellar", ["down", "d"], "up", ["u", "out"]),
    ("cellar", "den", "deeper", ["in", "den"], "back", ["out"]),
]

MONSTERS = [
    # room, key, hit dice, armour, weapon prototype, coins, description
    ("road", "wild dog", 1, 1, None, 0, "A mangy dog with its hackles up."),
    ("cellar", "giant rat", 1, 1, None, 1, "A rat the size of a cat, all teeth."),
    ("den", "goblin", 2, 2, "rusty blade", 5, "A wiry goblin in a stolen helmet, muttering."),
]


def _find(tag):
    found = search_tag(tag, category=BUILD)
    return found[0] if found else None


def build_town(caller=None):
    say = caller.msg if caller else (lambda _m: None)
    made = 0
    rooms = {}
    for key, (typeclass, name, desc, tags) in ROOMS.items():
        room = _find(f"room:{key}")
        if not room:
            room = create_object(typeclass, key=name, attributes=[("desc", desc)])
            room.tags.add(f"room:{key}", category=BUILD)
            for t in tags:
                room.tags.add(t, category="world")
            made += 1
        elif key == "yard" and room.typeclass_path != typeclass:
            room.swap_typeclass(typeclass, clean_attributes=False)  # a yard built before duels existed
            if "duel" not in (room.db.desc or ""):
                room.db.desc = desc
        rooms[key] = room
    for src, dst, name, aliases, back, back_aliases in EXITS:
        for a, b, n, al in ((src, dst, name, aliases), (dst, src, back, back_aliases)):
            tag = f"exit:{a}:{b}"
            if not _find(tag):
                exit_ = create_object(DefaultExit, key=n, aliases=al, location=rooms[a], destination=rooms[b])
                exit_.tags.add(tag, category=BUILD)
                made += 1
    limbo = search_object("#2")
    if limbo and not _find("exit:limbo:square"):
        e = create_object(DefaultExit, key="town", aliases=["square"], location=limbo[0], destination=rooms["square"])
        e.tags.add("exit:limbo:square", category=BUILD)
        made += 1
    from evennia.prototypes.spawner import spawn

    for room, key, hd, armor, weapon, coins, desc in MONSTERS:
        tag = f"monster:{room}:{key}"
        if _find(tag):
            continue
        mob = create_object("typeclasses.monsters.Monster", key=key, location=rooms[room], home=rooms[room],
                            attributes=[("desc", desc), ("hit_dice", hd), ("armor", armor), ("coins", coins)])
        if weapon:
            from world.prototypes import by_key

            mob.db.weapon = spawn(by_key(weapon))[0]
            mob.db.weapon.location = None
        mob.tags.add(tag, category=BUILD)
        made += 1
    if not _find("exit:gate:tower"):
        up = create_object("typeclasses.exits.TowerEntrance", key="up", aliases=["u", "upstairs", "climb"],
                           location=rooms["gate"], destination=rooms["gate"])  # leads to floor 1 once it is built
        up.tags.add("exit:gate:tower", category=BUILD)
        made += 1
    from world.town_extras import build_extras

    retire_old_areas(rooms["square"])
    made += build_extras(rooms)
    from world.mapdata import apply_map

    apply_map(rooms)  # positions are not "new things", so they don't count
    say(f"Town built: {made} new things.")
    return made


# The Bandit Woods and the Flooded Mine came before the tower (2026-10-03). A world built back then loses them on the next
# build: whoever stands there is moved to the square, and what they carry stays theirs.
RETIRED = ["woods_edge", "fern_path", "hollow_oak", "stream", "clearing", "ridge", "lookout", "camp", "tent",
           "mine_gate", "adit", "cart_hall", "landing", "pump_room", "gallery", "stope", "foreman", "lake"]


def retire_old_areas(square):
    gone = 0
    for key in RETIRED:
        room = _find(f"room:{key}")
        if not room:
            continue
        for obj in list(room.contents):
            if obj.is_typeclass("typeclasses.characters.Character", exact=False):
                obj.move_to(square, quiet=True, move_type="teleport")
                obj.msg("|yThe woods and the mine are gone. You find yourself back in the square.|n")
            else:
                obj.delete()
        room.delete()  # exits leading here go with it
        gone += 1
    return gone

"""
The starting town (docs/18). Idempotent: each thing carries a build tag, so running this again only makes
what is missing. It runs on the first start (server/conf/at_initial_setup.py); a developer can run it
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
    "yard": ("typeclasses.rooms.Room", "Training yard",
             "A square of packed earth behind the temple, with straw targets and a rack of blunt practice weapons. "
             "A sign reads: TYPE 'help' TO LEARN. TYPE 'inventory' TO SEE WHAT YOU CARRY. 'wield' A WEAPON BEFORE THE ROAD.", []),
    "road": ("typeclasses.rooms.WildRoom", "The old road",
             "Past the last cottages the road turns to ruts between hedges. Something rustles in the ditch. "
             "Further on, a collapsed farmhouse has a cellar door hanging open.", []),
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
    from world.areas import build_areas
    from world.town_extras import build_extras

    made += build_areas(rooms)
    made += build_extras(rooms)
    say(f"Town built: {made} new things.")
    return made

"""
The two adventure areas beyond the town (docs/18): the Bandit Woods, reached from the old road, and the Flooded Mine.
Each has nine rooms, notes to read, monsters, and one hidden way through. Idempotent like the town: every thing carries a build
tag, so building again only makes what is missing. The town builder calls `build_areas`.
"""
from evennia import DefaultExit, create_object, search_tag

BUILD = "build"
ROOM = "typeclasses.rooms.WildRoom"

# key: (name, description)
ROOMS = {
    # ---- the Bandit Woods
    "woods_edge": ("Edge of the woods", "The hedges give way to birches. A trampled path runs north into the trees; the old road is back to the south. Someone has hung a dead crow from a branch as a warning."),
    "fern_path": ("Fern path", "Knee-high ferns close in on both sides and the light turns green. Boot prints, many of them, all heading the same way."),
    "hollow_oak": ("The hollow oak", "A great oak, split by lightning and hollow enough to stand in. Something has been scratched into the bark inside, and a scrap of paper is wedged in the crack."),
    "stream": ("Stream crossing", "A fast brown stream, shin-deep over flat stones. On the far side the path climbs; downstream, willows lean over a pool."),
    "clearing": ("Charcoal burners' clearing", "A ring of black earth where charcoal was once burned. The huts are empty, the doors torn off. Smoke still rises thinly from one."),
    "ridge": ("Ridge trail", "The path follows a bare ridge. Below to the east you can see a thread of smoke and the glint of a fire. A narrow track drops toward it."),
    "lookout": ("Bandits' lookout", "A platform of lashed poles in a pine, with a view of the whole valley. A dense wall of thorns grows against the rocks behind it."),
    "camp": ("Bandit camp", "Tents and a smoking fire in a rocky bowl hidden from the road. Crates, a rack of stolen cloaks, and a chest bound with a chain."),
    "tent": ("The leader's tent", "Cushions, a map weighed down with a knife, and a table of half-eaten food. Whoever lives here left in a hurry."),
    # ---- the Flooded Mine
    "mine_gate": ("Mine gate", "A timbered mouth in the hillside, a rusted iron gate hanging from one hinge. A cold breath comes out of the dark. A sign reads: DANGER. WATER."),
    "adit": ("The adit", "A low tunnel braced with black timbers that drip. Rails run down the middle, and the light from outside soon fails."),
    "cart_hall": ("Ore cart hall", "A wide chamber where the tracks fork. Three ore carts stand on the rails, one tipped over, its load of grey stone spilled."),
    "landing": ("Shaft landing", "A wooden platform over a shaft full of black water. A bucket on a chain hangs just above the surface, turning slowly."),
    "pump_room": ("Pump room", "A great iron pump, seized with rust, and a tangle of leather hoses. A ladder leads up to a small door in the wall, painted over."),
    "gallery": ("Side gallery", "A narrow passage where miners followed a vein. Pick marks everywhere, and a faint glitter in the walls."),
    "stope": ("Collapsed stope", "A cavern whose roof has come down in a heap. Water seeps through the rubble and pools. Something moves among the stones."),
    "foreman": ("Foreman's office", "A cramped dry room cut into the rock: a desk, a stool, a shelf of ledgers eaten by damp. The foreman's lamp is still on the desk."),
    "lake": ("Underground lake", "The tunnel opens onto a still black lake. Far out, the water is lit from below by something pale. It is very quiet."),
}

# from, to, name, aliases, back name, back aliases, hidden?
EXITS = [
    ("road", "woods_edge", "woods", ["w", "forest", "trees"], "road", ["out", "s", "south"], False),
    ("woods_edge", "fern_path", "north", ["n", "path"], "south", ["s", "out"], False),
    ("fern_path", "hollow_oak", "oak", ["east", "e"], "back", ["west", "w", "out"], False),
    ("fern_path", "stream", "north", ["n", "stream"], "south", ["s", "out"], False),
    ("stream", "clearing", "west", ["w", "clearing"], "east", ["e", "out"], False),
    ("stream", "ridge", "up", ["u", "ridge", "climb"], "down", ["d", "out"], False),
    ("ridge", "lookout", "lookout", ["pine", "north", "n"], "ridge", ["out", "s"], False),
    ("lookout", "camp", "thorns", ["through", "camp"], "out", ["lookout", "back"], True),
    ("camp", "tent", "tent", ["in", "inside"], "out", ["camp"], False),
    ("road", "mine_gate", "mine", ["east", "e", "gate"], "road", ["out", "west", "w"], False),
    ("mine_gate", "adit", "in", ["tunnel", "adit", "down"], "out", ["gate", "up"], False),
    ("adit", "cart_hall", "deeper", ["in", "on"], "back", ["out"], False),
    ("cart_hall", "landing", "shaft", ["landing", "down", "d"], "up", ["u", "out", "carts"], False),
    ("cart_hall", "gallery", "gallery", ["side", "vein"], "back", ["out", "carts"], False),
    ("cart_hall", "pump_room", "pumps", ["pump", "east", "e"], "back", ["out", "carts", "west", "w"], False),
    ("pump_room", "foreman", "ladder", ["door", "up", "u"], "down", ["d", "pumps", "out"], True),
    ("gallery", "stope", "rubble", ["stope", "on"], "gallery", ["back", "out"], False),
    ("landing", "lake", "lake", ["water", "down", "swim"], "up", ["u", "landing", "out"], False),
]

# room, key, hit dice, armour, weapon prototype, coins, description
MONSTERS = [
    ("fern_path", "wolf", 1, 1, None, 0, "A lean grey wolf, watching you with patient yellow eyes."),
    ("clearing", "crow swarm", 1, 1, None, 0, "A cloud of crows rises from the ash, shrieking."),
    ("lookout", "bandit scout", 1, 1, "dagger", 4, "A boy of no more than sixteen in a stolen cloak, holding a dagger like he means it."),
    ("camp", "bandit", 2, 2, "club", 6, "A broad-shouldered bandit with a scarred chin and a club studded with nails."),
    ("camp", "bandit", 2, 2, "dagger", 8, "A thin bandit with a mean smile and a dagger in each hand."),
    ("tent", "bandit chief", 3, 3, "sword", 25, "A tall woman in a captain's coat, a stolen sword in her hand. She does not look afraid of you."),
    ("adit", "giant rat", 1, 1, None, 1, "A rat the size of a cat, all teeth."),
    ("cart_hall", "cave spider", 2, 2, None, 3, "A spider as wide as a dinner plate, dropping from the roof on a thread."),
    ("gallery", "giant rat", 1, 1, None, 1, "A rat the size of a cat, all teeth."),
    ("stope", "cave spider", 2, 2, None, 3, "A spider as wide as a dinner plate, dropping from the roof on a thread."),
    ("stope", "rubble crawler", 2, 3, None, 5, "A thing of loose stones and old bones that moves like a crab."),
    ("lake", "drowned miner", 2, 2, "rusty blade", 7, "A miner in a rotted coat, walking out of the lake with water pouring from his sleeves."),
]

# room, key, aliases, text. Things to read.
NOTES = [
    ("woods_edge", "warning sign", ["sign"], "A board nailed to a post, burned in with a hot iron: TOLLS PAID HERE. NO TOLL, NO ROAD."),
    ("hollow_oak", "scrap of paper", ["paper", "scrap", "note"], "Scratched in a rough hand: 'Marta's book is in the chest at the camp. Say nothing. The chief will skin us. Thorns behind the lookout, walk through them sideways.'"),
    ("clearing", "charred sign", ["sign", "charred"], "The hut doors are marked: BURNERS GONE TO THE CITY. DO NOT TAKE OUR TOOLS."),
    ("mine_gate", "warning board", ["board", "sign"], "DANGER. WATER. The lower levels flooded in the spring. By order of the foreman: nobody goes past the carts after dark."),
    ("cart_hall", "chalk tally", ["tally", "chalk"], "A chalk tally on the wall, fifty-three strokes, then the words: NOBODY CAME."),
    ("pump_room", "pump manual", ["manual", "page"], "A greasy page: 'To keep the lower levels dry, the pump must run day and night. If the pump stops, the foreman's office is the only dry room left. Door behind the ladder.'"),
    ("foreman", "foreman's ledger", ["ledger", "book"], "The last page: 'The water is rising faster than the pump can keep up. I am sealing myself in here with the lamp. If you read this, tell Marta at the tavern I'm sorry about her husband's pick.'"),
    ("lake", "miner's last note", ["note", "last"], "Pinned to a post with a rusty nail: 'There is something under the lake that sings. Do not follow it.'"),
]


def _find(tag):
    found = search_tag(tag, category=BUILD)
    return found[0] if found else None


def build_areas(rooms):
    """`rooms` holds the town's rooms by key; this adds the two areas to them. Returns how many new things it made."""
    made = 0
    for key, (name, desc) in ROOMS.items():
        room = _find(f"room:{key}")
        if not room:
            room = create_object(ROOM, key=name, attributes=[("desc", desc)])
            room.tags.add(f"room:{key}", category=BUILD)
            made += 1
        rooms[key] = room
    for src, dst, name, aliases, back, back_aliases, hidden in EXITS:
        for a, b, n, al in ((src, dst, name, aliases), (dst, src, back, back_aliases)):
            tag = f"exit:{a}:{b}"
            if _find(tag):
                continue
            # A hidden way is hidden from both sides, and found separately from each.
            typeclass = "typeclasses.exits.HiddenExit" if hidden else DefaultExit
            exit_ = create_object(typeclass, key=n, aliases=al, location=rooms[a], destination=rooms[b])
            exit_.tags.add(tag, category=BUILD)
            if hidden:
                exit_.tags.add("hidden", category="world")
            made += 1
    from evennia.prototypes.spawner import spawn

    from world.prototypes import by_key

    for room, key, hd, armor, weapon, coins, desc in MONSTERS:
        tag = f"monster:{room}:{key}:{coins}"
        if _find(tag):
            continue
        mob = create_object("typeclasses.monsters.Monster", key=key, location=rooms[room], home=rooms[room],
                            attributes=[("desc", desc), ("hit_dice", hd), ("armor", armor), ("coins", coins)])
        if weapon:
            mob.db.weapon = spawn(by_key(weapon))[0]
            mob.db.weapon.location = None
        mob.tags.add(tag, category=BUILD)
        made += 1
    for room, key, aliases, text in NOTES:
        tag = f"note:{room}:{key}"
        if _find(tag):
            continue
        note = create_object("typeclasses.objects.Readable", key=key, aliases=aliases, location=rooms[room],
                             attributes=[("desc", f"{key.capitalize()}. Try 'read {aliases[0]}'."), ("text", text)])
        note.locks.add("get:false()")
        note.tags.add(tag, category=BUILD)
        made += 1
    return made

"""
What the tower is made of (docs/18): kinds of room and the small details that set one room apart from the next. Data only.
Every line is written and read by hand: short, physical and plain. tests/test_tower_text.py checks length, banned filler
and near-duplicates, so a weak line fails the build rather than reaching players.
"""

# name: two ways the room can look. One is picked per room.
ROOM_KINDS = {
    "Armoury": [
        "Empty weapon racks line the walls. Broken spear shafts lie in a heap by the door.",
        "Pegs for shields cover one wall, nearly all of them bare. Drag marks run from the pegs to the door.",
    ],
    "Barracks": [
        "Two rows of plank bunks, the blankets rotted to rags. Someone scratched a tally into the end of each one.",
        "Bunks stacked three high around a cold stove. A line of boots stands by the door, every one a left foot.",
    ],
    "Library": [
        "Shelves to the ceiling, the books swollen with damp. A ladder has come off its rail and lies across the floor.",
        "A reading table with a candle burned down to the holder. The shelves are labelled by floor number, not by subject.",
    ],
    "Shrine": [
        "A stone altar under a slit window. The offering bowl holds buttons, bent nails and a single copper coin.",
        "Paint on the walls shows the tower with no top to it. Dripped wax has built a small mound on the floor.",
    ],
    "Flooded hall": [
        "Water covers the floor to the ankle. It drains through a grate in the corner and slowly creeps back.",
        "A long hall with a puddle in every dip of the flagstones. The ceiling drips steadily from a dozen places.",
    ],
    "Garden": [
        "Raised stone beds of soil under a skylight green with moss. Bean vines climb strings all the way to the ceiling.",
        "A herb garden that someone still keeps. The rows are weeded and a watering can stands half full.",
    ],
    "Forge": [
        "A cold forge and an anvil with a hammer left lying on it. The coal bin beside it is full.",
        "Torn bellows hang on the wall. Soot covers everything up to waist height and stops in a clean line.",
    ],
    "Kitchen": [
        "A long table, a hearth wide enough to stand in, and pots hung by size. A loaf on the table has gone hard as wood.",
        "Shelves of jars, most of them cracked. A pot on the hearth holds a stew that set solid long ago.",
    ],
    "Storeroom": [
        "Crates stacked to the ceiling, each stamped with a floor number. One has been pried open and emptied.",
        "Sacks of grain along the wall, gnawed through at the bottom. Spilled grain crunches underfoot.",
    ],
    "Gallery": [
        "Portraits line both walls, every face scraped off the canvas. The frames are good oak.",
        "Empty picture hooks run the length of the room. Pale squares on the plaster show where the paintings hung.",
    ],
    "Cistern": [
        "A round stone tank fills most of the room. A chain runs from a winch down into the dark water.",
        "Pipes along the ceiling feed a stone tank. One has split, and a thin stream runs down the wall.",
    ],
    "Guardroom": [
        "A table with dice on it and four stools knocked over. A ring of keys hangs on a nail by the door.",
        "Arrow slits look down on the town far below. A crossbow with no string leans in the corner.",
    ],
    "Workshop": [
        "Benches covered in gears, springs and half-built locks. A drawer of tiny screws has spilled across the floor.",
        "A lathe with a chair leg still clamped in it. Wood shavings are piled ankle-deep under the bench.",
    ],
    "Bathhouse": [
        "A sunken tiled bath, dry and cracked down the middle. Towels on a rack have dried stiff as boards.",
        "Copper tubs in a row, green with age. A drain in the floor gurgles now and then.",
    ],
    "Map room": [
        "A table under glass shows the plan of the tower. The lower floors are drawn in detail; the upper ones are blank.",
        "Charts of single floors are pinned to every wall. Red pins mark the doors on each one.",
    ],
}

# One more sentence for a room, so two rooms of the same kind still differ. An empty string means nothing extra.
FEATURES = [
    "",
    "",
    "A torch burns in a bracket by the door.",
    "Bones have been swept into one corner.",
    "Cold air comes up through a crack in the floor.",
    "Someone has chalked an arrow on the wall, pointing up.",
    "The door frame is scored with claw marks.",
    "A dead lantern hangs from a hook in the ceiling.",
    "The room smells of wet dog.",
    "The floor slopes toward the far wall.",
    "A rope ladder hangs below a hatch that has been nailed shut.",
    "Muddy footprints cross the room and stop at a blank wall.",
    "A bucket catches a slow drip from above.",
    "Cobwebs fill the corners, thick as cloth.",
    "A small window shows nothing but cloud.",
    "Dozens of initials are carved into the door frame.",
    "A single chair sits in the middle of the room, facing the wall.",
    "Broken glass lies under the window.",
    "The walls here are warm to the touch.",
    "Pigeons nest on a ledge high up.",
    "A pile of rubble half blocks one doorway.",
]

# Added to the room with the stair up.
STAIR_LINE = "A stone stair climbs to the next floor."

# Who lives on the floors, ten floors to a family, in climbing order. Past the last family the list starts again, and the numbers in
# scaling.py keep rising. Each member: (name, role, description). Role "weak", "normal" or "strong" moves its hit dice by -1, 0 or +1;
# the strongest member guards the stair. "weapon" is what the family hits with.
FAMILIES = [
    {"name": "vermin", "weapon": "teeth", "members": [
        ("giant rat", "weak", "A rat the size of a cat, missing an ear."),
        ("bat swarm", "weak", "A dozen bats that move as one, squeaking."),
        ("tunnel beetle", "normal", "A beetle as long as your arm, its shell scraped and dented."),
        ("rat king", "strong", "Six rats with their tails knotted together, biting at anything in reach."),
    ]},
    {"name": "bandits", "weapon": "blade", "members": [
        ("cutpurse", "weak", "A thin youth with quick hands and a short knife."),
        ("bandit", "normal", "A bandit with a scarred chin and a club studded with nails."),
        ("deserter", "normal", "A soldier in a torn uniform who still keeps his blade clean."),
        ("bandit chief", "strong", "A tall woman in a captain's coat, holding a stolen sword."),
    ]},
    {"name": "constructs", "weapon": "fists", "members": [
        ("clay servant", "weak", "A clay figure with a blank face, still carrying a tray."),
        ("gear hound", "normal", "A dog built from springs and plates. It ticks when it runs."),
        ("iron guard", "normal", "A suit of armour with nobody inside, walking a fixed route."),
        ("door warden", "strong", "A stone figure twice the height of a man, stepping out of the wall it was part of."),
    ]},
    {"name": "undead", "weapon": "claws", "members": [
        ("skeleton", "weak", "Old bones held together with wire."),
        ("grave hound", "normal", "A dog with no fur left, only grey skin over its ribs."),
        ("drowned man", "normal", "A man in a rotted coat, water running from his sleeves."),
        ("bone knight", "strong", "A skeleton in full plate with the visor rusted shut."),
    ]},
    {"name": "cultists", "weapon": "ritual knife", "members": [
        ("acolyte", "weak", "A young man in a grey robe, holding a candle in one hand and a knife in the other."),
        ("zealot", "normal", "A shaven-headed woman shouting the same word over and over."),
        ("mask bearer", "normal", "Someone in a white clay mask with no eyeholes, who finds you anyway."),
        ("high priest", "strong", "An old woman in red who leans on a staff and does not hurry."),
    ]},
    {"name": "beasts", "weapon": "talons", "members": [
        ("storm crow", "weak", "A crow the size of an eagle, its feathers singed at the tips."),
        ("wall lizard", "normal", "A grey lizard that clings to the ceiling and drops on people."),
        ("gargoyle", "normal", "A stone gargoyle that has stopped staying on its ledge."),
        ("wyvern", "strong", "A small wyvern with a torn wing. Its bite still works fine."),
    ]},
]

# A trait makes one enemy different from the rest of its kind, and its name says which: "armoured bandit".
TRAITS = ["armoured", "hulking", "venomous", "fierce"]

# Hand-written bosses for the first boss floors. Past these, a boss floor's guard is the family's strongest member with two traits.
BOSSES = {
    10: ("Rat Mother", "A rat as big as a pony, with a dozen of her young around her feet."),
    20: ("Captain Hesk", "The bandits' captain in stolen plate, with a sword in each hand."),
    30: ("Forge Engine", "A furnace on four iron legs. Heat pours from its open door."),
}


# ---------------------------------------------------------------- gear (T3)
# Every 12 floors gear moves up a tier, and the tier word is in its name. Past the last tier the best word stays and a number counts up:
# "masterwork sword +2".
WEAPON_TIERS = ["rough", "iron", "steel", "tempered", "masterwork"]
# name: (damage step against the floor's expected weapon, two-handed?, description)
WEAPONS = {
    "knife": (-1, False, "A short blade with a plain wooden grip."),
    "sword": (0, False, "A straight blade, sharpened on both edges."),
    "mace": (0, False, "A flanged iron head on a short haft."),
    "hand axe": (0, False, "A bearded axe head on a haft the length of your forearm."),
    "spear": (1, True, "A leaf-shaped blade on a long ash pole."),
    "maul": (1, True, "A heavy block of metal on a long handle, for both hands."),
}
# Body armour by tier (its tier is in the name already), then helmets and shields with a tier word.
BODY_ARMOUR = [
    ("quilted coat", "A thick coat of stitched linen layers."),
    ("leather coat", "Boiled leather, stiff at first, shaped to whoever wears it."),
    ("mail shirt", "A shirt of riveted rings that reaches to the thigh."),
    ("scale coat", "Overlapping metal scales sewn onto a leather backing."),
    ("plate coat", "Steel plates riveted inside a canvas coat."),
]
HELMET = ("helm", "A round helmet with a strap under the chin.")
SHIELD = ("shield", "A round shield with a metal rim and boss.")
ARMOUR_TIERS = ["leather", "iron", "steel", "tempered", "masterwork"]

# Better finds: (name, weight on floor 1, weight on floor 100). The weights slide between the two with height.
RARITIES = [("common", 70, 40), ("fine", 20, 30), ("rare", 9, 22), ("epic", 1, 8)]

# What an affix does is in its name, and every one of them does something real (see typeclasses/monsters.py and characters.py).
WEAPON_AFFIXES = {
    "heavy": "Its damage dice are one step bigger.",
    "brutal": "Each hit does 2 more damage.",
    "leeching": "Each hit heals you by 1.",
}
ARMOUR_AFFIXES = {
    "reinforced": "Its armour is 1 higher.",
    "of warding": "Each hit you take does 1 less damage.",
    "of thorns": "Whoever hits you takes 1 damage.",
}

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

# The one thing guarding each floor's stair until the enemy tables arrive (T2): (key, description).
GUARD = ("stair guard", "A guard in mismatched armour who stands in front of the stair and does not move aside.")

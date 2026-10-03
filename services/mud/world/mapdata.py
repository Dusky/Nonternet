"""
Where each built room sits, for the client's map (docs/09). Every room has an area and a grid position (x east, y north,
z up). The positions only need to be right relative to their neighbours; a builder's own rooms simply have none, and the
client leaves them off the map. `apply_map` is idempotent and runs every time the town is built, so changing a position
here moves the room on the next build.
"""
AREAS = {"town": "Town"}  # tower floors name themselves (db.area_name, world/tower/floors.py)

# room key: (area, x, y, z)
COORDS = {
    "square": ("town", 0, 0, 0),
    "tavern": ("town", 1, 0, 0),
    "temple": ("town", 0, 1, 0),
    "market": ("town", -1, 0, 0),
    "yard": ("town", 0, 2, 0),
    "gate": ("town", 1, 1, 0),
    "road": ("town", 0, -1, 0),
    "cellar": ("town", 0, -1, -1),
    "den": ("town", 1, -1, -1),
}


def apply_map(rooms):
    """`rooms` holds built rooms by key. Sets db.area and db.coord where they differ. Returns how many rooms changed."""
    changed = 0
    for key, (area, x, y, z) in COORDS.items():
        room = rooms.get(key)
        if not room:
            continue
        if room.db.area != area or list(room.db.coord or []) != [x, y, z]:
            room.db.area = area
            room.db.coord = [x, y, z]
            changed += 1
    return changed

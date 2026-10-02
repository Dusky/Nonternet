"""
Where each built room sits, for the client's map (docs/09). Every room has an area and a grid position (x east, y north,
z up). The positions only need to be right relative to their neighbours; a builder's own rooms simply have none, and the
client leaves them off the map. `apply_map` is idempotent and runs every time the town is built, so changing a position
here moves the room on the next build.
"""
AREAS = {"town": "Town", "woods": "Bandit Woods", "mine": "Flooded Mine"}

# room key: (area, x, y, z)
COORDS = {
    "square": ("town", 0, 0, 0),
    "tavern": ("town", 1, 0, 0),
    "temple": ("town", 0, 1, 0),
    "market": ("town", -1, 0, 0),
    "yard": ("town", 0, 2, 0),
    "road": ("town", 0, -1, 0),
    "cellar": ("town", 0, -1, -1),
    "den": ("town", 1, -1, -1),
    "woods_edge": ("woods", 0, 0, 0),
    "fern_path": ("woods", 0, 1, 0),
    "hollow_oak": ("woods", 1, 1, 0),
    "stream": ("woods", 0, 2, 0),
    "clearing": ("woods", -1, 2, 0),
    "ridge": ("woods", 0, 3, 1),
    "lookout": ("woods", 0, 4, 1),
    "camp": ("woods", 1, 4, 1),
    "tent": ("woods", 2, 4, 1),
    "mine_gate": ("mine", 0, 0, 0),
    "adit": ("mine", 1, 0, 0),
    "cart_hall": ("mine", 2, 0, 0),
    "landing": ("mine", 2, -1, 0),
    "pump_room": ("mine", 3, 0, 0),
    "foreman": ("mine", 3, 1, 0),
    "gallery": ("mine", 2, 1, 0),
    "stope": ("mine", 2, 2, 0),
    "lake": ("mine", 2, -2, -1),
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

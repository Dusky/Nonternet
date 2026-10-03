"""
A floor's shape (docs/18): rooms on a grid, grown out from the entry at (0, 0), with the stair up in the room farthest
from it. Pure functions of a random generator, so a seed gives the same floor every time.
"""
DIRS = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}
REVERSE = {"north": "south", "south": "north", "east": "west", "west": "east"}
LOOP_CHANCE = 0.15  # how often a step onto an existing room joins the two, making a loop


def room_count(floor):
    """Five rooms low down, one more every five floors, never more than nine."""
    return min(9, 5 + floor // 5)


def layout(rng, count):
    """{(x, y): set of directions with a doorway}, and the stair room's coordinate."""
    cells = {(0, 0): set()}
    while len(cells) < count:
        x, y = rng.choice(sorted(cells))
        d = rng.choice(sorted(DIRS))
        dx, dy = DIRS[d]
        n = (x + dx, y + dy)
        if n in cells:
            if rng.random() < LOOP_CHANCE:
                cells[(x, y)].add(d)
                cells[n].add(REVERSE[d])
            continue
        cells[(x, y)].add(d)
        cells[n] = {REVERSE[d]}
    return cells, farthest(cells)


def distances(cells, start=(0, 0)):
    seen = {start: 0}
    queue = [start]
    while queue:
        x, y = queue.pop(0)
        for d in sorted(cells[(x, y)]):
            dx, dy = DIRS[d]
            n = (x + dx, y + dy)
            if n not in seen:
                seen[n] = seen[(x, y)] + 1
                queue.append(n)
    return seen


def farthest(cells):
    dist = distances(cells)
    return max(sorted(dist), key=lambda c: dist[c])

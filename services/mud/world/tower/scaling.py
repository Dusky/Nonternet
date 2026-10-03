"""
How hard the tower gets (docs/18). Every number that grows with height lives here, for enemies and for the gear a climber is
expected to have by then (the loot tables in T3 follow the same curve), so balance is tuned in one place. tests/test_balance.py
runs the fight simulator in balance.py over these numbers.
"""
from world.tower import tables

DIE_SIDES = [4, 6, 8, 10, 12]
ROLE_HD = {"weak": -1, "normal": 0, "strong": 1}


def family(floor):
    return tables.FAMILIES[((floor - 1) // 10) % len(tables.FAMILIES)]


def die(step):
    """Damage dice by step: 1d4, 1d6 … 1d12, then 2d4 … and so on."""
    count, side = divmod(max(0, step), len(DIE_SIDES))
    return f"{count + 1}d{DIE_SIDES[side]}"


def enemy(floor, role="normal", traits=()):
    """The numbers for one enemy on this floor. Tuned with balance.py; the table it gives is in docs/18."""
    hd = max(1, 1 + floor // 7 + ROLE_HD[role] + (1 if "fierce" in traits else 0))
    return {
        "hit_dice": hd,
        "armor": floor // 10 + (2 if "armoured" in traits else 0),
        "hp_multiplier": 5 if "hulking" in traits else 3,
        "damage": die(floor // 8 + (1 if role == "strong" else 0)),
        "xp": hd * 8,
        "coins": hd * 2,
    }


def guard(floor):
    """The role and traits of a floor's stair guard: gentle below floor 10, one trait above, two on a boss floor."""
    if floor < 10:
        return "normal", ()
    if floor % 10 == 0:
        return "strong", ("armoured", "hulking")
    return "strong", ("armoured",)


def enemies_in_room(floor, rng):
    """How many ordinary enemies stand in a room (the stair room has its guard instead)."""
    if rng.random() > min(0.85, 0.45 + floor * 0.01):
        return 0
    return 1 + (rng.random() < min(0.6, floor / 40)) + (rng.random() < min(0.3, floor / 100))


def trait_chance(floor):
    return min(0.6, 0.1 + floor * 0.01)


# ---------------------------------------------------------------- what a climber should have by now

def kit(floor):
    """The weapon and armour a climber is expected to carry on this floor: what T3's drops are tuned to give."""
    return {"damage": die(1 + floor // 8), "armor": 1 + floor // 10}


def xp_for_next(level):
    """Total xp to reach the next level: 50, 200, 450 … (level squared × 50)."""
    return level * level * 50

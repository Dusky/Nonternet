"""
A fight simulator for tuning the tower (docs/18). It plays Knave's rules as EvAdventure does them (d20 + attack bonus must beat
10 + armour; a 20 doubles the damage; a 1 always misses) between an expected climber and the enemies scaling.py puts on a floor,
many times, and reports how often the climber wins and how much health it costs. No Evennia objects: plain numbers in, numbers out.

Run it by hand to see the curve:  python -m world.tower.balance
"""
import random

from world.tower import layout, scaling

TRIALS = 1000


def roll(dice, rng):
    count, sides = (int(x) for x in dice.split("d"))
    return sum(rng.randint(1, sides) for _ in range(count))


def expected_xp(floor):
    """The xp a climber who cleared every floor below this one would have, on average."""
    total = 0.0
    for f in range(1, floor):
        rooms = layout.room_count(f) - 2  # not the entry, not the stair room
        p = min(0.85, 0.45 + f * 0.01)
        per_room = p * (1 + min(0.6, f / 40) + min(0.3, f / 100))
        total += rooms * per_room * scaling.enemy(f)["xp"] + scaling.enemy(f, "strong")["xp"]
    return total


def expected_level(floor):
    xp, level = expected_xp(floor), 1
    while xp >= scaling.xp_for_next(level):
        level += 1
    return level


def climber(floor):
    """A climber of the expected level, carrying the expected kit for this floor."""
    level = expected_level(floor)
    gear = scaling.kit(floor)
    return {"level": level, "attack": min(10, 2 + (level - 1) // 2), "hp": round(6 + 3.5 * (level - 1)),
            "damage": gear["damage"], "armor": gear["armor"]}


def _hits(attack, armor, dice, rng):
    r = rng.randint(1, 20)
    if r == 1 or r + attack <= 10 + armor:
        return 0
    return roll(dice, rng) * (2 if r == 20 else 1)


def fight(pc, foes, rng):
    """One fight to the end. Returns (won, hp left). The climber hits one foe a turn; every foe still standing hits back."""
    hp = pc["hp"]
    foes = [dict(f, hp=f["hit_dice"] * f["hp_multiplier"]) for f in foes]
    while hp > 0 and foes:
        target = foes[0]
        target["hp"] -= _hits(pc["attack"], target["armor"], pc["damage"], rng)
        if target["hp"] <= 0:
            foes.pop(0)
        for f in foes:
            hp -= _hits(f["hit_dice"], pc["armor"], f["damage"], rng)
            if f.get("venomous") and hp > 0:
                hp -= rng.randint(1, 4) if rng.random() < 0.5 else 0
    return hp > 0, max(0, hp)


def simulate(floor, kind="room", trials=TRIALS, seed=1):
    """Win rate and average share of health lost, for a typical room fight or the stair guard on this floor."""
    rng = random.Random(f"{seed}:{floor}:{kind}")
    pc = climber(floor)
    wins, lost = 0, 0.0
    for _ in range(trials):
        if kind == "guard":
            foes = [scaling.enemy(floor, *scaling.guard(floor))]
        else:
            count = 0
            while not count:  # a room that has anyone in it
                count = scaling.enemies_in_room(floor, rng)
            foes = [scaling.enemy(floor, rng.choice(("weak", "normal", "normal"))) for _ in range(count)]
        won, left = fight(pc, foes, rng)
        wins += won
        lost += 1 - left / pc["hp"]
    return {"floor": floor, "level": pc["level"], "win": wins / trials, "hp_lost": lost / trials}


if __name__ == "__main__":
    print("floor  level  room win  room hp lost  guard win")
    for f in (1, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100):
        r, g = simulate(f), simulate(f, "guard")
        print(f"{f:>5}  {r['level']:>5}  {r['win']:>8.0%}  {r['hp_lost']:>12.0%}  {g['win']:>9.0%}")

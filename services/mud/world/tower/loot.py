"""
Gear the tower drops (docs/18). A drop is a plain dict first, so it can be rolled, tested and kept in someone's spoils without
making an object; `make` turns it into the item. Each person rolls their own drop (personal loot). Item strength follows the kit in
scaling.py, so what drops on a floor is what the balance simulator assumed a climber has there.
"""
import random

from evennia import create_object

from world.tower import scaling, tables

TIER_FLOORS = 12
DROP_CHANCE = 0.25  # for an ordinary enemy; a stair guard always drops
_EV = "evennia.contrib.tutorials.evadventure.objects"


def _tier(floor, words):
    tier = floor // TIER_FLOORS
    if tier < len(words):
        return words[tier], ""
    return words[-1], f" +{tier - len(words) + 1}"


def rarity(floor, rng):
    t = min(1.0, max(0.0, (floor - 1) / 99))
    weights = [lo + (hi - lo) * t for _n, lo, hi in tables.RARITIES]
    return rng.choices([r[0] for r in tables.RARITIES], weights)[0]


def roll(floor, rng=None):
    """One random piece of gear for this floor: {"kind", "name", "desc", "rarity", "affixes", "damage" or "armor", "value", "floor"}."""
    rng = rng or random.Random()
    rar = rarity(floor, rng)
    kit = scaling.kit(floor)
    bonus = 1 if rar in ("fine", "epic") else 0
    n_affix = {"common": 0, "fine": 0, "rare": 1, "epic": 2}[rar]
    kind = rng.choices(["weapon", "body", "helmet", "shield"], [4, 3, 2, 2])[0]
    if kind == "weapon":
        base = rng.choice(sorted(tables.WEAPONS))
        step_mod, two_handed, desc = tables.WEAPONS[base]
        affixes = rng.sample(sorted(tables.WEAPON_AFFIXES), n_affix)
        step = 1 + floor // 8 + step_mod + bonus + (1 if "heavy" in affixes else 0)
        word, plus = _tier(floor, tables.WEAPON_TIERS)
        item = {"kind": "weapon", "base": base, "two_handed": two_handed, "damage": scaling.die(step), "desc": desc}
    else:
        affixes = rng.sample(sorted(tables.ARMOUR_AFFIXES), n_affix)
        extra = bonus + (1 if "reinforced" in affixes else 0)
        if kind == "body":
            tier = min(floor // TIER_FLOORS, len(tables.BODY_ARMOUR) - 1)
            base, desc = tables.BODY_ARMOUR[tier]
            word, plus = "", _tier(floor, tables.BODY_ARMOUR)[1]
            armor = max(1, kit["armor"] - 1) + extra  # the body piece carries most of the expected armour
        else:
            base, desc = tables.HELMET if kind == "helmet" else tables.SHIELD
            word, plus = _tier(floor, tables.ARMOUR_TIERS)
            armor = 1 + floor // 40 + extra
        item = {"kind": kind, "base": base, "armor": armor, "desc": desc}
    prefixes = [a for a in affixes if not a.startswith("of ")]
    suffixes = [a.removeprefix("of ") for a in affixes if a.startswith("of ")]
    suffix = ["of " + " and ".join(suffixes)] if suffixes else []  # "of thorns and warding"
    words = (["fine"] if bonus else []) + prefixes + ([word] if word else []) + [item["base"]] + suffix
    item.update({
        "name": " ".join(words) + plus,
        "rarity": rar,
        "affixes": affixes,
        "floor": floor,
        "value": 5 * (1 + floor // 4) * {"common": 1, "fine": 2, "rare": 4, "epic": 8}[rar],
    })
    return item


def describe(item):
    """The item's description: what it is, and a sentence per affix saying what it does."""
    lines = [item["desc"]]
    lines += [tables.WEAPON_AFFIXES.get(a) or tables.ARMOUR_AFFIXES[a] for a in item["affixes"]]
    return " ".join(lines)


def make(item, holder=None):
    """The object for a rolled drop, given to `holder` if there is one."""
    typeclass = {"weapon": "EvAdventureWeapon", "body": "EvAdventureArmor", "helmet": "EvAdventureHelmet", "shield": "EvAdventureShield"}[item["kind"]]
    attrs = [("desc", describe(item)), ("value", item["value"]), ("affixes", list(item["affixes"])), ("rarity", item["rarity"]),
             ("found_floor", item["floor"])]
    if item["kind"] == "weapon":
        attrs.append(("damage_roll", item["damage"]))
        if item["two_handed"]:
            from evennia.contrib.tutorials.evadventure.enums import WieldLocation

            attrs.append(("inventory_use_slot", WieldLocation.TWO_HANDS))
    else:
        attrs.append(("armor", item["armor"]))
    obj = create_object(f"{_EV}.{typeclass}", key=item["name"], attributes=attrs)
    if holder:
        obj.location = holder
    return obj


def give(char, item):
    """Puts a drop in the character's pack, or, when it won't fit, in their spoils to claim later. Returns the object or None."""
    from evennia.contrib.tutorials.evadventure.equipment import EquipmentError

    obj = make(item, char)
    try:
        char.equipment.add(obj)
    except EquipmentError:
        obj.delete()
        spoils = list(char.db.spoils or [])[-(SPOILS_MAX - 1):]
        char.db.spoils = spoils + [item]
        char.msg(f"|yYou find {item['name']} ({item['rarity']}) but have no room. It waits in your spoils: type 'spoils'.|n")
        return None
    obj.db.unbanked = True  # lost if you are beaten before your next checkpoint (T4)
    char.msg(f"|gYou find {item['name']} ({item['rarity']}).|n")
    return obj


def claim(char, number):
    """Takes spoil `number` (from 1) into the pack, if there is room now."""
    spoils = list(char.db.spoils or [])
    if not 1 <= number <= len(spoils):
        return "There is no spoil with that number. Type 'spoils' to see them."
    from evennia.contrib.tutorials.evadventure.equipment import EquipmentError

    item = spoils[number - 1]
    obj = make(item, char)
    try:
        char.equipment.add(obj)
    except EquipmentError as err:
        obj.delete()
        return f"Still no room: {err}"
    obj.db.unbanked = True
    del spoils[number - 1]
    char.db.spoils = spoils
    return f"You take {item['name']}."


SPOILS_MAX = 10

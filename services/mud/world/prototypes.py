"""
Item prototypes (docs/18). EvAdventure's character sheet names its starting gear by prototype key but
ships no prototypes, so they are defined here: every item its tables can roll, plus a few monster weapons.
Numbers follow Knave: armour points (Knave's "armor" value), weapon damage dice, item value in coins.
"""
from evennia.contrib.tutorials.evadventure.enums import WieldLocation

_EV = "evennia.contrib.tutorials.evadventure.objects"


def _gear(key, value=1, desc=""):
    return {"prototype_key": key, "key": key.split(",")[0], "typeclass": f"{_EV}.EvAdventureObject", "value": value,
            "desc": desc or f"A {key.split(',')[0]}, the kind of thing adventurers carry."}


def _weapon(key, damage, value, desc, two_handed=False):
    p = {"prototype_key": key, "key": key, "typeclass": f"{_EV}.EvAdventureWeapon", "damage_roll": damage, "value": value, "desc": desc}
    if two_handed:
        p["inventory_use_slot"] = WieldLocation.TWO_HANDS
    return p


def _armor(key, points, value, desc, cls="EvAdventureArmor"):
    return {"prototype_key": key, "key": key, "typeclass": f"{_EV}.{cls}", "armor": points, "value": value, "desc": desc}


# Weapons
CLUB = _weapon("club", "1d6", 2, "A heavy length of wood, thicker at one end.")
DAGGER = _weapon("dagger", "1d6", 5, "A short blade, good for close work.")
STAFF = _weapon("staff", "1d6", 1, "A tall walking staff shod with iron.", two_handed=True)
SWORD = _weapon("sword", "1d8", 10, "A plain soldier's sword.")
RUSTY_BLADE = _weapon("rusty blade", "1d4", 1, "A pitted, notched blade. Better than nothing.")

# Armour, as EvAdventure counts it: a bonus over the unarmoured base (Knave gambeson 12 = +2, brigandine 13 = +3,
# chain 14 = +4; helmet and shield +1 each).
GAMBESON = _armor("gambeson", 2, 15, "A thick quilted coat.")
BRIGANDINE = _armor("brigandine", 3, 30, "Leather lined with small riveted plates.")
CHAIN = _armor("chain", 4, 60, "A long shirt of iron rings.")
HELMET = _armor("helmet", 1, 10, "A simple iron cap.", "EvAdventureHelmet")
SHIELD = _armor("shield", 1, 10, "A round wooden shield with an iron boss.", "EvAdventureShield")

# Food
RATION = {"prototype_key": "ration", "key": "ration", "typeclass": f"{_EV}.EvAdventureConsumable", "value": 1, "uses": 1,
          "desc": "Dried meat, hard bread and an apple. A day's food."}

_GEAR = [
    "candles, 5", "chain, 10ft", "chalk, 10", "crowbar", "grap. hook", "hammer", "lamp oil", "lantern", "manacles",
    "mirror", "padlock", "pole, 10ft", "pulleys", "rope, 50ft", "sack", "spikes, 5", "tent", "tinderbox", "torches, 5",
    "waterskin", "air bladder", "bear trap", "bellows", "bucket", "caltrops", "chisel", "drill", "fish. rod", "glue",
    "grease", "hourglass", "lockpicks", "marbles", "metal file", "nails", "net", "pick", "saw", "shovel", "tongs",
    "blank book", "bottle", "card deck", "cook pots", "dice set", "face paint", "fake jewels", "horn", "incense",
    "instrument", "lens", "perfume", "quill & ink", "small bell", "soap", "sponge", "spyglass", "tar pot", "twine", "whistle",
]
for _i, _key in enumerate(_GEAR):
    globals()[f"GEAR_{_i}"] = _gear(_key)


def by_key(key):
    """Our prototype for this item key, or None. Used directly, so nothing depends on the global registry."""
    for value in globals().values():
        if isinstance(value, dict) and value.get("prototype_key") == key:
            return value
    return None

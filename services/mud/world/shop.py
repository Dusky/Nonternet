"""
Shops (docs/18): Odo's in the market, and the trader on the tower's landings. What is for sale, what things cost, and what they pay. Prices are the item's value in
coins; he pays half (never less than one) and the things he buys are destroyed, so selling cannot be used to loop coins.
EvAdventure's own shop system is a talk-to-the-NPC menu that its docs call unfinished, so this is a few plain commands instead.
"""
from evennia.contrib.tutorials.evadventure.equipment import EquipmentError
from evennia.prototypes.spawner import spawn

from world.prototypes import by_key

STOCK = ["club", "dagger", "staff", "sword", "gambeson", "brigandine", "helmet", "shield", "ration", "torches, 5", "rope, 50ft", "lantern", "lamp oil"]


def price(key):
    proto = by_key(key)
    return int(proto.get("value", 1)) if proto else None


def catalogue():
    return [(key.split(",")[0], price(key), key) for key in STOCK if by_key(key)]


def find_stock(name):
    name = name.strip().lower()
    for shown, cost, key in catalogue():
        if shown.lower() == name or key.lower() == name:
            return shown, cost, key
    for shown, cost, key in catalogue():  # a unique start of the name
        if shown.lower().startswith(name):
            return shown, cost, key
    return None


def buy(char, name, keeper="Odo"):
    item = find_stock(name)
    if not item:
        return f"{keeper} has nothing like that. Type 'shop' to see what is for sale."
    shown, cost, key = item
    if (char.coins or 0) < cost:
        return f"The {shown} costs {cost} coins and you have {char.coins or 0}."
    obj = spawn(by_key(key))[0]
    obj.location = char
    try:
        char.equipment.add(obj)
    except EquipmentError as err:
        obj.delete()
        return f"You cannot carry any more: {err}"
    char.coins = (char.coins or 0) - cost
    return f"You buy a {shown} for {cost} coins. You have {char.coins} left."


def sell_price(obj):
    value = obj.attributes.get("value", 0) or 0
    return max(1, value // 2) if value > 0 else 0


def sell(char, name, keeper="Odo"):
    name = name.strip().lower()
    for obj in char.equipment.all(only_objs=True):
        if obj.key.lower() == name or obj.key.lower().startswith(name):
            got = sell_price(obj)
            if not got:
                return f"{keeper} won't buy the {obj.key}: it is worth nothing."
            char.equipment.remove(obj)
            shown = obj.key
            obj.delete()
            char.coins = (char.coins or 0) + got
            return f"{keeper} takes the {shown} and pays you {got} coins. You have {char.coins}."
    return "You are not carrying anything like that."

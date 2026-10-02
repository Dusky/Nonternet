"""
Rooms (docs/18). Town rooms are safe: no fighting at all. Wild rooms allow fighting monsters. Only the
training yard allows fighting another person, by agreement, and no room allows death.
"""
from evennia.contrib.tutorials.evadventure.rooms import EvAdventureRoom
from evennia.typeclasses.attributes import AttributeProperty

from .objects import ObjectParent


class Room(ObjectParent, EvAdventureRoom):
    allow_combat = AttributeProperty(False, autocreate=False)
    allow_pvp = AttributeProperty(False, autocreate=False)
    allow_death = AttributeProperty(False, autocreate=False)


class YardRoom(Room):
    """
    The training yard: the one place two people can fight each other, and only by agreement (`duel`, `accept`). The room
    flag allows it for the combat handler; the `attack` command (commands/duel_cmds.py) is what checks consent, so a
    third person can't join in. Nobody dies here (allow_death stays off); a duel ends with the loser standing.
    """
    allow_combat = AttributeProperty(True, autocreate=False)
    allow_pvp = AttributeProperty(True, autocreate=False)


class WildRoom(Room):
    """Outside town: monsters can be fought here."""
    allow_combat = AttributeProperty(True, autocreate=False)

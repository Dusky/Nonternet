"""
Rooms (docs/18). Town rooms are safe: no fighting at all. Wild rooms allow fighting monsters. No room
allows fighting another person by default, and none allows death.
"""
from evennia.contrib.tutorials.evadventure.rooms import EvAdventureRoom
from evennia.typeclasses.attributes import AttributeProperty

from .objects import ObjectParent


class Room(ObjectParent, EvAdventureRoom):
    allow_combat = AttributeProperty(False, autocreate=False)
    allow_pvp = AttributeProperty(False, autocreate=False)
    allow_death = AttributeProperty(False, autocreate=False)


class WildRoom(Room):
    """Outside town: monsters can be fought here."""
    allow_combat = AttributeProperty(True, autocreate=False)

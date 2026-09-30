"""
Monsters (docs/18): EvAdventure's mob with simple AI. When beaten it leaves the room and comes back,
healed, a few minutes later, so adventure areas refill for the next person.
"""
from evennia.contrib.tutorials.evadventure.npcs import EvAdventureMob
from evennia.typeclasses.attributes import AttributeProperty
from evennia.utils import delay

from .objects import ObjectParent


class Monster(ObjectParent, EvAdventureMob):
    respawn_seconds = AttributeProperty(180, autocreate=False)

    def at_death(self):
        if self.location:
            self.location.msg_contents(f"|g{self.key} falls and is still.|n")
        self.db.lair = self.db.lair or self.home or self.location
        self.location = None  # out of the world until it comes back
        delay(self.respawn_seconds, self.respawn)

    def respawn(self):
        self.hp = self.hp_max
        lair = self.db.lair
        if lair:
            self.move_to(lair, quiet=True, move_type="teleport")
            lair.msg_contents(f"{self.key} is back.")

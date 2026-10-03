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
            self._reward()
            if self.db.warden_floor:
                self._open_stair()
        self.db.lair = self.db.lair or self.home or self.location
        self.location = None  # out of the world until it comes back
        delay(self.respawn_seconds, self.respawn)

    def respawn(self):
        self.hp = self.hp_max
        lair = self.db.lair
        if lair:
            self.move_to(lair, quiet=True, move_type="teleport")
            lair.msg_contents(f"{self.key} is back.")

    def _open_stair(self):
        """A floor's guard is down: the stair opens for everyone who was there for the fight."""
        from world.tower import floors

        for obj in self.location.contents:
            if obj.is_typeclass("typeclasses.characters.Character", exact=False):
                floors.mark_cleared(obj, self.db.warden_floor)
                obj.msg("|gThe way up is open.|n")

    def _reward(self):
        """Everyone in the room for the fight gets the xp and coins, each their own (docs/18: personal rewards)."""
        xp = self.db.xp or self.hit_dice * 8
        coins = self.coins or 0
        for obj in self.location.contents:
            if obj.is_typeclass("typeclasses.characters.Character", exact=False):
                obj.coins = (obj.coins or 0) + coins
                obj.msg(f"|g+{xp} xp, +{coins} coins.|n")
                obj.add_xp(xp)

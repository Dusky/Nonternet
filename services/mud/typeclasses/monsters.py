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

        floor = self.db.warden_floor
        for obj in self.location.contents:
            if obj.is_typeclass("typeclasses.characters.Character", exact=False):
                floors.mark_cleared(obj, floor)
                obj.msg("|gThe way up is open.|n")
                if floor % 10 == 0:
                    floors.set_checkpoint(obj, floor)
                    obj.msg(f"|gCheckpoint: floor {floor}. What you carry is safe now, and 'ascend' at the gate brings you back here.|n")

    def at_damage(self, damage, attacker=None):
        # The attacker's weapon affixes (world/tower/tables.py): brutal hits harder, leeching heals its wielder.
        affixes = (getattr(getattr(attacker, "weapon", None), "db", None) and attacker.weapon.db.affixes) or []
        if damage > 0 and "brutal" in affixes:
            damage += 2
        super().at_damage(damage, attacker=attacker)
        if damage > 0 and "leeching" in affixes and attacker.hp < attacker.hp_max:
            attacker.hp += 1

    def _reward(self):
        """Everyone in the room for the fight gets the xp and coins and their own roll for a drop (docs/18: personal loot)."""
        import random

        from world.tower import loot

        xp = self.db.xp or self.hit_dice * 8
        coins = self.coins or 0
        floor = self.location.db.floor
        for obj in self.location.contents:
            if obj.is_typeclass("typeclasses.characters.Character", exact=False):
                obj.coins = (obj.coins or 0) + coins
                obj.msg(f"|g+{xp} xp, +{coins} coins.|n")
                obj.add_xp(xp)
                if floor and (self.db.warden_floor or random.random() < loot.DROP_CHANCE):
                    loot.give(obj, loot.roll(floor))

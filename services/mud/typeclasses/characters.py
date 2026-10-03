"""
Characters (docs/18). Built on EvAdventure's character (Knave rules, equipment, combat). Our change:
**no permanent death.** At 0 HP you wake at the temple, keeping your gear, a little weakened.
"""
import time

from evennia import search_tag
from evennia.contrib.tutorials.evadventure.characters import EvAdventureCharacter
from evennia.typeclasses.attributes import AttributeProperty

from evennia.contrib.tutorials.evadventure.rules import dice

from world import duels, oob, rules_patch
from world.tower import scaling

from .objects import ObjectParent

rules_patch.apply()  # a weakened character rolls one lower (docs/18)

WEAKENED_SECONDS = 5 * 60


class Watched(AttributeProperty):
    """An attribute that tells the player's client when it changes (hp, level, coins...: the vitals, docs/09)."""

    def __set__(self, instance, value):
        # Read the stored value directly: __get__ would create the default through __set__ again.
        before = instance.attributes.get(self._key, category=self._category)
        super().__set__(instance, value)
        if before is not None and before != value:
            oob.send_vitals(instance)


def respawn_room():
    rooms = search_tag("respawn", category="world")
    return rooms[0] if rooms else None


class Character(ObjectParent, EvAdventureCharacter):
    hp = Watched(default=4)
    hp_max = Watched(default=4)
    level = Watched(default=1)
    coins = Watched(default=0)
    xp = Watched(default=0)

    def xp_for_next(self):
        return scaling.xp_for_next(self.level or 1)

    def add_xp(self, xp):
        """Xp, and a level whenever it is enough: the three lowest abilities go up by one (to +10 at most), and health by 1d6."""
        self.xp = (self.xp or 0) + xp
        levelled = False
        while self.xp >= self.xp_for_next():
            self.level = (self.level or 1) + 1
            names = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
            for name in sorted(names, key=lambda n: getattr(self, n) or 0)[:3]:
                setattr(self, name, min(10, (getattr(self, name) or 0) + 1))
            gain = dice.roll("1d6")
            self.hp_max = (self.hp_max or 1) + gain
            self.hp = (self.hp or 0) + gain
            self.msg(f"|gYou reach level {self.level}. Your three weakest abilities go up by one, and your health by {gain}.|n")
            levelled = True
        return levelled

    def worn_affixes(self):
        from evennia.contrib.tutorials.evadventure.enums import WieldLocation

        slots = self.equipment.slots
        worn = [slots.get(s) for s in (WieldLocation.BODY, WieldLocation.HEAD, WieldLocation.SHIELD_HAND)]
        return [a for obj in worn if obj for a in (obj.db.affixes or [])]

    def at_damage(self, damage, attacker=None):
        # A venomous enemy's hit burns a little more, half the time.
        if attacker and "venomous" in (attacker.db.traits or []) and dice.roll("1d2") == 2:
            extra = dice.roll("1d4")
            self.msg(f"|rThe venom burns for {extra} more.|n")
            damage += extra
        affixes = self.worn_affixes()
        damage = max(0, damage - affixes.count("of warding"))
        super().at_damage(damage, attacker=attacker)
        thorns = affixes.count("of thorns")
        if thorns and attacker and attacker != self and hasattr(attacker, "at_damage"):
            attacker.at_damage(thorns)  # no attacker given back, so thorns never bounce

    def at_post_puppet(self, **kwargs):
        super().at_post_puppet(**kwargs)
        oob.remember(self)
        oob.send_vitals(self)
        oob.send_room(self)

    def at_post_move(self, source_location, **kwargs):
        super().at_post_move(source_location, **kwargs)
        oob.remember(self)
        oob.send_room(self)
        if self.ndb.duel_with and not duels.consented(self, self.ndb.duel_with):
            duels.end(self)  # walked out of the yard: the duel is off

    def _lose_duel(self, winner):
        """A duel is friendly: the loser stays put, a little sore, with no weakness and no trip to the temple."""
        combat = self.ndb.combathandler
        if combat:
            try:
                combat.remove_combatant(self)
            except Exception:
                pass
        self.hp = max(1, self.hp_max // 2)
        if self.location:
            self.location.msg_contents(f"|y$You() $conj(yield), beaten. {winner.key} wins the duel.|n", from_obj=self)
        winner.msg("|gYou win the duel.|n")
        self.msg("|yYou lost the duel, but you are fine: just a little sore.|n")

    def at_defeat(self):
        """0 HP: out of the fight and carried to the temple. Never death (decided 2026-09-30). In a duel, you just stay."""
        opponent = self.ndb.duel_with
        if opponent:
            duels.end(self)
            self._lose_duel(opponent)
            return
        if self.location:
            self.location.msg_contents("|y$You() $conj(fall), beaten. Someone carries $pron(you) away...|n", from_obj=self)
        combat = self.ndb.combathandler
        if combat:
            try:
                combat.remove_combatant(self)
            except Exception:  # the fight may already be over
                pass
        self.hp = max(1, self.hp_max // 2)
        self.db.weakened_until = time.time() + WEAKENED_SECONDS
        oob.send_vitals(self)
        temple = respawn_room()
        if temple and self.location != temple:
            self.move_to(temple, quiet=True, move_type="teleport")
        self.msg("|yYou wake in the temple, sore but alive. Your gear is still with you. You feel weak for a few minutes.|n")

    def at_death(self):
        self.at_defeat()

    @property
    def weakened(self):
        return (self.db.weakened_until or 0) > time.time()

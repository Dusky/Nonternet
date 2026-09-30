"""
Characters (docs/18). Built on EvAdventure's character (Knave rules, equipment, combat). Our change:
**no permanent death.** At 0 HP you wake at the temple, keeping your gear, a little weakened.
"""
import time

from evennia import search_tag
from evennia.contrib.tutorials.evadventure.characters import EvAdventureCharacter

from .objects import ObjectParent

WEAKENED_SECONDS = 5 * 60


def respawn_room():
    rooms = search_tag("respawn", category="world")
    return rooms[0] if rooms else None


class Character(ObjectParent, EvAdventureCharacter):
    def at_defeat(self):
        """0 HP: out of the fight and carried to the temple. Never death (decided 2026-09-30)."""
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
        temple = respawn_room()
        if temple and self.location != temple:
            self.move_to(temple, quiet=True, move_type="teleport")
        self.msg("|yYou wake in the temple, sore but alive. Your gear is still with you. You feel weak for a few minutes.|n")

    def at_death(self):
        self.at_defeat()

    @property
    def weakened(self):
        return (self.db.weakened_until or 0) > time.time()

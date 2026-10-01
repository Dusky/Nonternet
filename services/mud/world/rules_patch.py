"""
Rolls and the "weakened" effect (docs/18). When someone is beaten they wake at the temple "a little weakened", and until
that wears off (five minutes) every roll they make is one lower. EvAdventure sends every roll, attacks and saving throws
alike, through `saving_throw`, so one change there covers all of it. Applied once, when the characters are loaded.
"""
from evennia.contrib.tutorials.evadventure import rules

WEAKENED_PENALTY = 1
_ORIGINAL = rules.EvAdventureRollEngine.saving_throw


def saving_throw(self, character, *args, modifier=0, **kwargs):
    if getattr(character, "weakened", False):
        modifier -= WEAKENED_PENALTY
    return _ORIGINAL(self, character, *args, modifier=modifier, **kwargs)


def apply():
    if rules.EvAdventureRollEngine.saving_throw is _ORIGINAL:  # not already patched
        rules.EvAdventureRollEngine.saving_throw = saving_throw

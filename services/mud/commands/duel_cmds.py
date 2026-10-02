"""Duels in the training yard (docs/18, world/duels.py): duel, accept, decline, yield, and an attack that needs agreement."""
from evennia import Command
from evennia.contrib.tutorials.evadventure.combat_turnbased import CmdTurnAttack

from world import duels


class CmdAttack(CmdTurnAttack):
    __doc__ = CmdTurnAttack.__doc__

    def func(self):
        found = self.caller.search(self.args, quiet=True) if self.args else None
        target = found[0] if found else None
        if target is not None and getattr(target, "is_pc", False) and not duels.consented(self.caller, target):
            self.msg("You can only fight someone who has agreed to a duel with you. In the training yard, use 'duel <name>'.")
            return
        super().func()


class CmdDuel(Command):
    """
    Challenge someone to a friendly duel in the training yard.

    Usage:
      duel <name>

    They have 30 seconds to 'accept' or 'decline'. Nobody is hurt for real: the loser stays in the yard, a little sore.
    'yield' ends it at any time.
    """

    key = "duel"
    help_category = "Combat"

    def func(self):
        char = self.caller
        if not duels.in_yard(char):
            self.msg("Duels are held in the training yard, behind the temple.")
            return
        found = char.search(self.args, quiet=True) if self.args.strip() else None
        if not found:
            self.msg("Who do you want to duel? Use 'duel <name>'.")
            return
        target = found[0]
        try:
            duels.challenge(char, target)
        except duels.DuelError as err:
            self.msg(str(err))
            return
        self.msg(f"You challenge {target.key} to a duel. They have {duels.CHALLENGE_SECONDS} seconds to answer.")
        target.msg(f"|y{char.key} challenges you to a friendly duel.|n Type |waccept|n or |wdecline|n.")


class CmdAccept(Command):
    """
    Accept a duel you have been challenged to.

    Usage:
      accept
    """

    key = "accept"
    help_category = "Combat"

    def func(self):
        char = self.caller
        try:
            who = duels.accept(char)
        except duels.DuelError as err:
            self.msg(str(err))
            return
        char.location.msg_contents(f"|y{char.key} and {who.key} square up for a friendly duel.|n Use 'attack <name>' to begin; 'yield' ends it.")


class CmdDecline(Command):
    """
    Turn down a duel.

    Usage:
      decline
    """

    key = "decline"
    help_category = "Combat"

    def func(self):
        char = self.caller
        try:
            who = duels.decline(char)
        except duels.DuelError as err:
            self.msg(str(err))
            return
        self.msg(f"You turn {who.key} down.")
        who.msg(f"{char.key} declines your duel.")


class CmdYield(Command):
    """
    End a duel you are in. Nothing is lost.

    Usage:
      yield
    """

    key = "yield"
    help_category = "Combat"

    def func(self):
        char = self.caller
        other = duels.end(char)
        if not other:
            self.msg("You are not in a duel.")
            return
        combat = char.ndb.combathandler
        if combat:
            try:
                combat.stop_combat()
            except Exception:  # the fight may already be over
                pass
        char.location.msg_contents(f"|y{char.key} yields to {other.key}. The duel is over.|n")

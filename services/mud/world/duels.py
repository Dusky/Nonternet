"""
Duels in the training yard (docs/18): two people who both agree can fight there. Nothing is lost: the loser stays where they
are, a little hurt, and nobody is weakened or carried off. State is kept on the two characters (ndb, so it never outlives a
restart) and ends when the fight does, when either walks away, or when either yields.
"""
import time

CHALLENGE_SECONDS = 30


class DuelError(ValueError):
    pass


def in_yard(char):
    from typeclasses.rooms import YardRoom

    return isinstance(char.location, YardRoom)


def challenge(challenger, target, now=None):
    now = now if now is not None else time.time()
    if target is challenger:
        raise DuelError("You can't duel yourself.")
    if not in_yard(challenger):
        raise DuelError("Duels are held in the training yard, behind the temple.")
    if target.location != challenger.location or not getattr(target, "is_pc", False):
        raise DuelError("There is nobody like that here to duel.")
    if challenger.ndb.duel_with or target.ndb.duel_with:
        raise DuelError("One of you is already in a duel.")
    if challenger.hp <= 0 or target.hp <= 0:
        raise DuelError("Someone here is already down.")
    target.ndb.duel_offer = (challenger, now + CHALLENGE_SECONDS)


def pending(target, now=None):
    """Who has challenged this person and is still waiting, or None."""
    now = now if now is not None else time.time()
    offer = target.ndb.duel_offer
    if not offer:
        return None
    who, until = offer
    if now > until or who.location != target.location or who.ndb.duel_with:
        target.ndb.duel_offer = None
        return None
    return who


def accept(target, now=None):
    who = pending(target, now)
    if not who:
        raise DuelError("Nobody is waiting on an answer from you.")
    target.ndb.duel_offer = None
    who.ndb.duel_with = target
    target.ndb.duel_with = who
    return who


def decline(target, now=None):
    who = pending(target, now)
    if not who:
        raise DuelError("Nobody is waiting on an answer from you.")
    target.ndb.duel_offer = None
    return who


def consented(a, b):
    """True only when each has agreed to fight the other, in the yard."""
    return bool(a.ndb.duel_with is b and b.ndb.duel_with is a and a.location == b.location and in_yard(a))


def end(char):
    """Close a duel for both sides. Returns the opponent (or None if there was no duel)."""
    other = char.ndb.duel_with
    char.ndb.duel_with = None
    if other:
        if other.ndb.duel_with is char:
            other.ndb.duel_with = None
    char.ndb.duel_offer = None
    return other

"""
Exits

Exits are connectors between Rooms. An exit always has a destination property
set and has a single command defined on itself with the same name as its key,
for allowing Characters to traverse the exit to its destination.

"""

from evennia.objects.objects import DefaultExit

from .objects import ObjectParent


class Exit(ObjectParent, DefaultExit):
    """
    Exits are connectors between rooms. Exits are normal Objects except
    they defines the `destination` property and overrides some hooks
    and methods to represent the exits.

    See mygame/typeclasses/objects.py for a list of
    properties and methods available on all Objects child classes like this.

    """

    pass


class HiddenExit(Exit):
    """
    An exit nobody sees until they have searched the room (docs/18). Not seen, not listed, and not usable by name either,
    until that person has found it: finding is remembered on the character, so it is theirs and not everyone's.
    """

    def found_by(self, who):
        return bool(who) and self.id in (who.db.found_exits or [])

    def access(self, accessing_obj, access_type="read", default=False, no_superuser_bypass=False, **kwargs):
        if access_type in ("view", "traverse", "cmd") and not self.found_by(accessing_obj):
            return False
        return super().access(accessing_obj, access_type, default=default, no_superuser_bypass=no_superuser_bypass, **kwargs)

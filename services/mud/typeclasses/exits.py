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


class TowerStair(Exit):
    """
    The stair up from a tower floor (world/tower). It opens for each person once they have beaten that floor's guard, and
    the floor above is only built when the first person climbs it.
    """

    def get_display_name(self, looker=None, **kwargs):
        name = super().get_display_name(looker, **kwargs)
        from world.tower import floors

        if looker and not floors.has_cleared(looker, self.db.floor):
            return f"{name} (guarded)"
        return name

    def at_traverse(self, traversing_object, target_location, **kwargs):
        from world.tower import floors

        floor = self.db.floor
        if not floors.has_cleared(traversing_object, floor):
            traversing_object.msg("The stair guard stands in the way. Beat it to go up.")
            return
        up = floors.entry(floor + 1)
        self.destination = up
        super().at_traverse(traversing_object, up, **kwargs)


class TowerEntrance(Exit):
    """From the gate in town up to the first floor, built on first use."""

    def at_traverse(self, traversing_object, target_location, **kwargs):
        from world.tower import floors

        first = floors.entry(1)
        self.destination = first
        super().at_traverse(traversing_object, first, **kwargs)

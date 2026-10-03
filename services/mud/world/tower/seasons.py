"""
Seasons (docs/18). On the first of each month (UTC) the tower is rebuilt from a new seed: anyone inside is moved to the gate, every
room, enemy and enemy weapon of the old season is deleted (nothing anyone carries is tagged, so nothing carried is touched), the
season's best climbs are kept in a short history, and checkpoints start again. Characters, levels and gear stay.
"""
from evennia import DefaultScript, create_script, search_script, search_tag
from evennia.server.models import ServerConfig

from world.tower import floors, seed

HISTORY_KEY = "tower_history"
HISTORY_MAX = 24


def due():
    s = seed.current()
    if "month" not in s:  # a season started before seasons had months: it is this month's
        s["month"] = seed.month_now()
        ServerConfig.objects.conf(seed.KEY, value=s)
        return False
    return s["month"] != seed.month_now()


def leaders(season, limit=10):
    from typeclasses.characters import Character

    rows = []
    for c in Character.objects.all_family():
        t = c.db.tower or {}
        if t.get("season") == season and t.get("best"):
            rows.append({"name": c.key, "best": t["best"]})
    return sorted(rows, key=lambda r: (-r["best"], r["name"]))[:limit]


def reset():
    """Ends the season now and starts the next. Returns the new season's number."""
    from evennia import SESSION_HANDLER

    old = seed.current()
    gate = floors._gate()
    tagged = list(search_tag(f"season:{old['season']}", category=floors.CAT))
    for obj in tagged:
        if obj.db.floor:
            for who in list(obj.contents):
                if who.is_typeclass("typeclasses.characters.Character", exact=False) and gate:
                    who.move_to(gate, quiet=True, move_type="teleport")
    for obj in tagged:
        if obj.pk:
            obj.delete()
    history = list(ServerConfig.objects.conf(HISTORY_KEY) or [])
    history.append({"season": old["season"], "month": old.get("month"), "leaders": leaders(old["season"])})
    ServerConfig.objects.conf(HISTORY_KEY, value=history[-HISTORY_MAX:])
    nxt = seed.new(old["season"] + 1)
    ServerConfig.objects.conf(seed.KEY, value=nxt)
    SESSION_HANDLER.announce_all(f"|wThe tower has been rebuilt for season {nxt['season']}. Checkpoints start again from floor 1.|n")
    return nxt["season"]


class TowerSeason(DefaultScript):
    """Checks once an hour whether a new month has begun."""

    def at_script_creation(self):
        self.key = "tower_season"
        self.interval = 3600
        self.persistent = True

    def at_repeat(self):
        if due():
            reset()


def ensure_script():
    if not search_script("tower_season"):
        create_script(TowerSeason)

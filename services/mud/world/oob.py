"""
What the MUD tells a client besides text (docs/09). Two messages, sent as Evennia outputfuncs, so the web client gets
`["vitals", [], {...}]` and `["room_info", [], {...}]`, and a telnet client with GMCP gets them too:

- vitals: hp, hp_max, level, xp, xp_prev and xp_next (the totals for this level and the next), coins, weakened, in_combat. Sent on puppet and whenever one of them changes.
- room_info: the room's id, name, area (key and name), coord, and the exits this person can see (a hidden exit only once
  they have found it), each with the destination's id. Sent on puppet, on every move, and after a search finds something.

A client can also ask (inputfuncs `vitals_get`, `room_get`, `area_map`); `area_map` lists the rooms of the current area
that this character has been in, with their exits, so the client can draw a map without ever seeing an unvisited room.
"""
from world.mapdata import AREAS
from world.tower import scaling

VISITED_MAX = 2000


def vitals(char):
    return {
        "hp": char.hp or 0,
        "hp_max": char.hp_max or 0,
        "level": char.level or 1,
        "xp": char.xp or 0,
        "xp_next": scaling.xp_for_next(char.level or 1),
        "xp_prev": scaling.xp_for_next((char.level or 1) - 1) if (char.level or 1) > 1 else 0,
        "coins": char.coins or 0,
        "weakened": bool(getattr(char, "weakened", False)),
        "in_combat": bool(char.ndb.combathandler),
    }


def _exits(room, char):
    out = []
    for ex in room.exits:
        if not ex.access(char, "view"):
            continue
        dest = ex.destination
        out.append({"name": ex.key, "aliases": list(ex.aliases.all()), "to": dest.id if dest else None})
    return out


def _area(room):
    key = room.db.area
    return {"key": key, "name": room.db.area_name or AREAS.get(key, key)} if key else None


def room_info(char):
    room = char.location
    if not room:
        return None
    return {
        "id": room.id,
        "name": room.get_display_name(char),
        "area": _area(room),
        "coord": list(room.db.coord) if room.db.coord else None,
        "exits": _exits(room, char),
    }


def remember(char):
    """Notes that this character has been in its current room (for area_map). Newest last, capped."""
    room = char.location
    if not room:
        return
    seen = list(char.db.visited or [])
    if room.id in seen:
        return
    seen.append(room.id)
    char.db.visited = seen[-VISITED_MAX:]


def area_map(char):
    """The rooms of the current area this character has been in (and the current room), with coords and exits."""
    room = char.location
    if not room or not room.db.area:
        return {"area": None, "rooms": []}
    from evennia import search_object

    seen = set(char.db.visited or []) | {room.id}
    rooms = []
    for rid in seen:
        found = search_object(f"#{rid}")
        r = found[0] if found else None
        if not r or r.db.area != room.db.area or not r.db.coord:
            continue
        rooms.append({"id": r.id, "name": r.get_display_name(char), "coord": list(r.db.coord), "exits": _exits(r, char)})
    rooms.sort(key=lambda r: r["id"])
    return {"area": _area(room), "rooms": rooms}


def _playing(char):
    return bool(char.sessions.count())


def send_vitals(char):
    if _playing(char):
        char.msg(vitals=((), vitals(char)))


def send_room(char):
    if not _playing(char):
        return
    info = room_info(char)
    if info:
        char.msg(room_info=((), info))

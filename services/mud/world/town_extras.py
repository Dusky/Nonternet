"""
People and fittings in the town that the commands in commands/world_cmds.py talk to (docs/18): Marta in the tavern (who has
a job for someone), the tavern's noticeboard, and the market's shopkeeper. Idempotent, like the rest of the town builder.
"""
from evennia import create_object, search_tag

BUILD = "build"

# room, tag, typeclass, key, aliases, description
FITTINGS = [
    ("tavern", "npc:marta", "typeclasses.objects.Object", "Marta", ["landlady", "keeper"],
     "A stout woman with flour to the elbows and a ring of keys at her belt. Her eyes keep drifting to a bare hook behind the bar. Try 'ask marta'."),
    ("tavern", "board:tavern", "typeclasses.objects.Object", "noticeboard", ["board", "notices"],
     "A cork board by the door, thick with pinned scraps. 'board' shows what is pinned; 'post <words>' pins a note of your own."),
    ("tavern", "book:tavern", "typeclasses.objects.Object", "guestbook", ["book", "visitors book"],
     "A fat leather book on the bar, its pages crowded with names and kind words. 'guestbook' reads it; 'sign <words>' adds your line."),
    ("market", "npc:shop", "typeclasses.objects.Object", "Odo", ["shopkeeper", "odo the shopkeeper"],
     "A cheerful man behind a counter crowded with weapons, coats and tins. A chalkboard reads: 'shop' TO SEE WHAT'S FOR SALE, 'buy' AND 'sell'."),
]


def build_extras(rooms):
    made = 0
    for room, tag, typeclass, key, aliases, desc in FITTINGS:
        found = search_tag(tag, category=BUILD)
        if found:
            if key[0].isupper():
                found[0].db.proper_name = True  # towns built before this existed get it too
            continue
        obj = create_object(typeclass, key=key, aliases=aliases, location=rooms[room], attributes=[("desc", desc)])
        obj.locks.add("get:false()")
        obj.tags.add(tag, category=BUILD)
        if key[0].isupper():
            obj.db.proper_name = True  # "Marta", not "a Marta"
        if tag == "board:tavern":
            obj.db.notes = []
        if tag == "book:tavern":
            obj.db.entries = []
        made += 1
    return made

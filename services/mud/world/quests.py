"""
The first quest (docs/18): the tavern keeper's lost ledger. Three steps, kept as a small record on the character
(`db.quests`), not in EvAdventure's quest framework (which stores pickled classes and has no quests of its own).

  1. Ask Marta. She says bandits took her ledger and tells you where to look.
  2. Find it: search the bandit camp. The ledger goes into your pack.
  3. Bring it back to Marta, for a reward.
"""
from evennia import search_tag
from evennia.contrib.tutorials.evadventure.equipment import EquipmentError

QUEST = "ledger"
REWARD_COINS = 25
REWARD_XP = 25
STEP_TEXT = {
    1: "Marta's ledger was taken by bandits in the woods south of town. Find their camp (a scrap of paper in the woods mentions a chest) and bring it back.",
    2: "You have found Marta's ledger. Take it back to her in the tavern.",
    3: "Done. You returned Marta's ledger.",
}


def _state(char):
    quests = char.db.quests or {}
    return quests.get(QUEST)


def _set(char, step):
    quests = dict(char.db.quests or {})
    quests[QUEST] = {"step": step}
    char.db.quests = quests


def step_of(char):
    s = _state(char)
    return s["step"] if s else 0


def log(char):
    """The lines for the `quests` command."""
    step = step_of(char)
    if not step:
        return ["You are not on any quest. Marta in the tavern might have something for you."]
    mark = "(done) " if step == 3 else ""
    return [f"|wThe lost ledger|n {mark}", f"  {STEP_TEXT[step]}"]


def _ledger_in_pack(char):
    for obj in char.equipment.all(only_objs=True):
        if obj.key == "tavern ledger":
            return obj
    return None


def ask_marta(char):
    step = step_of(char)
    if step == 0:
        _set(char, 1)
        return ("Marta wipes her hands. \"Someone took my ledger. Every debt in this town was in it, and bandits in the woods south of here "
                "have it, I'd swear. Bring it back and there's twenty-five coins in it for you.\"\n|yQuest started: the lost ledger.|n")
    if step == 1:
        return "\"Still looking? The bandits' camp is somewhere up in the woods. Find the chest.\""
    if step == 2:
        ledger = _ledger_in_pack(char)
        if not ledger:
            _set(char, 1)  # lost or given away: go and find it again
            return "\"You haven't got it with you. Go and find it again.\""
        char.equipment.remove(ledger)
        ledger.delete()
        _set(char, 3)
        char.coins = (char.coins or 0) + REWARD_COINS
        char.xp = (char.xp or 0) + REWARD_XP
        return (f"Marta turns the damp pages and her face changes. \"All of it. Bless you.\" She counts out {REWARD_COINS} coins.\n"
                f"|gQuest done: the lost ledger. +{REWARD_COINS} coins, +{REWARD_XP} xp.|n")
    return "\"Thank you again,\" says Marta. \"Your next drink is on me.\""


def search_room(char):
    """Searching reveals what is hidden in this room, for this person, and may turn up the ledger. Returns the lines to show."""
    out = []
    room = char.location
    found = list(char.db.found_exits or [])
    new = [e for e in room.contents if e.tags.has("hidden", category="world") and e.id not in found]
    for e in new:
        found.append(e.id)
        out.append(f"|gYou find a way through: {e.key}.|n")
    if new:
        char.db.found_exits = found
        from world import oob

        oob.send_room(char)  # the map can show the new way
    if room.tags.has("room:camp", category="build") and step_of(char) == 1:
        from evennia.prototypes.spawner import spawn

        from world.prototypes import by_key

        ledger = spawn(by_key("tavern ledger"))[0]
        ledger.location = char
        try:
            char.equipment.add(ledger)
        except EquipmentError as err:
            ledger.delete()
            out.append(f"|yYou find Marta's ledger in the chest, but cannot carry it: {err} Make room and search again.|n")
        else:
            _set(char, 2)
            out.append("|gYou break the chain and lift the lid. Under a stack of stolen cloaks is a fat, damp book: Marta's ledger.|n")
    if not out:
        out.append("You search carefully and find nothing new.")
    return out

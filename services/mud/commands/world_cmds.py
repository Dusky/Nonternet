"""World commands (docs/18): reading, searching, asking, the shop, the noticeboard and the guestbook."""
from evennia import Command, search_tag

from world import audit, guestbook, noticeboard, oob, shop

BUILD = "build"


def _here(char, tag):
    return [o for o in char.location.contents if o.tags.has(tag, category=BUILD)] if char.location else []


class CmdRead(Command):
    """
    Read a note, sign or page.

    Usage:
      read <thing>
    """

    key = "read"
    help_category = "General"

    def func(self):
        char = self.caller
        if not self.args.strip():
            self.msg("Read what? Look around to see what is written here.")
            return
        target = char.search(self.args.strip(), location=char.location, quiet=True)
        target = target[0] if target else None
        text = target.db.text if target else None
        if not text:
            self.msg("There is nothing to read there.")
            return
        self.msg(f"You read the {target.key}:\n|w{text}|n")


class CmdSearch(Command):
    """
    Search the room for anything hidden: ways through, and things people have tucked away.

    Usage:
      search
    """

    key = "search"
    aliases = ["hunt"]
    help_category = "General"

    def func(self):
        char = self.caller
        if char.ndb.combathandler:
            self.msg("You are in the middle of a fight.")
            return
        room = char.location
        found = list(char.db.found_exits or [])
        new = [e for e in room.contents if e.tags.has("hidden", category="world") and e.id not in found]
        if not new:
            self.msg("You search carefully and find nothing new.")
            return
        char.db.found_exits = found + [e.id for e in new]
        for e in new:
            self.msg(f"|gYou find a way through: {e.key}.|n")
        oob.send_room(char)  # the map can show the new way


class CmdRest(Command):
    """
    Catch your breath and bind your cuts. Not in a fight, and not with an enemy in the room.

    Usage:
      rest
    """

    key = "rest"
    aliases = ["sleep", "camp"]
    help_category = "General"

    def func(self):
        import time

        from evennia.contrib.tutorials.evadventure.rules import dice

        char = self.caller
        if char.ndb.combathandler:
            self.msg("Not in the middle of a fight.")
            return
        if any(o.is_typeclass("typeclasses.monsters.Monster", exact=False) for o in char.location.contents):
            self.msg("Not with an enemy in the room.")
            return
        if (char.hp or 0) >= (char.hp_max or 0):
            self.msg("You are already at full health.")
            return
        wait = REST_SECONDS - (time.time() - (char.ndb.rested_at or 0))
        if wait > 0:
            self.msg(f"You rested a moment ago. Try again in {int(wait) + 1} seconds.")
            return
        char.ndb.rested_at = time.time()
        gain = min(char.hp_max - char.hp, max(1, dice.roll("1d8") + (char.constitution or 0)))  # Knave's rest
        char.hp += gain
        self.msg(f"You rest for a while and recover {gain} health ({char.hp} of {char.hp_max}).")


REST_SECONDS = 20


class CmdAsk(Command):
    """
    Ask someone if they have anything for you.

    Usage:
      ask <person>
    """

    key = "ask"
    help_category = "General"

    def func(self):
        char = self.caller
        who = self.args.strip().lower()
        if who and _here(char, "npc:marta") and who in ("marta", "landlady", "keeper"):
            self.msg("Marta nods at the window. \"The tower? The gate is northeast of the square. Every floor has a guard by the "
                     "stair up, and it won't let you past until you beat it. The higher you go, the worse they get.\"")
        elif who and _here(char, "npc:shop") and who in ("odo", "shopkeeper"):
            self.msg("Odo grins. \"Type 'shop' and I'll show you.\"")
        else:
            self.msg("Ask whom? There is nobody like that here.")


class _ShopCmd(Command):
    help_category = "General"

    def in_shop(self):
        if not _here(self.caller, "npc:shop"):
            self.msg("There is no shop here. Odo's is in the market.")
            return False
        return True


class CmdShop(_ShopCmd):
    """
    See what Odo sells and what he pays.

    Usage:
      shop
    """

    key = "shop"
    aliases = ["wares"]

    def func(self):
        if not self.in_shop():
            return
        self.msg("|wFor sale at Odo's:|n")
        for shown, cost, _key in shop.catalogue():
            self.msg(f"  {shown:<14} {cost:>4} coins")
        self.msg(f"You have {self.caller.coins or 0} coins. 'sell <thing>' pays half what an item is worth.")


class CmdBuy(_ShopCmd):
    """
    Buy something from Odo.

    Usage:
      buy <thing>
    """

    key = "buy"

    def func(self):
        if not self.in_shop():
            return
        self.msg(shop.buy(self.caller, self.args) if self.args.strip() else "Buy what? Type 'shop' to see.")


class CmdSell(_ShopCmd):
    """
    Sell something you carry to Odo.

    Usage:
      sell <thing>
    """

    key = "sell"

    def func(self):
        if not self.in_shop():
            return
        self.msg(shop.sell(self.caller, self.args) if self.args.strip() else "Sell what?")


def _core_id(char):
    account = char.account
    return account.attributes.get("core_id") if account else None


class _BoardCmd(Command):
    help_category = "General"

    def at_board(self):
        boards = _here(self.caller, "board:tavern")
        if not boards:
            self.msg("There is no noticeboard here. It is in the tavern.")
            return False
        self.board = boards[0]
        return True


class CmdBoard(_BoardCmd):
    """
    Read the notes pinned to the tavern noticeboard.

    Usage:
      board
    """

    key = "board"
    aliases = ["notices"]

    def func(self):
        if not self.at_board():
            return
        for line in noticeboard.lines(self.board):
            self.msg(line)


class CmdPost(_BoardCmd):
    """
    Pin a note to the tavern noticeboard.

    Usage:
      post <words>

    Notes are up to 200 characters and one a minute. They stay until they scroll off, or you or a builder take them down
    ('unpost <number>').
    """

    key = "post"

    def func(self):
        if not self.at_board():
            return
        char = self.caller
        try:
            n = noticeboard.post(self.board, _core_id(char), char.key, self.args)
        except noticeboard.NoteError as err:
            self.msg(str(err))
            return
        self.msg(f"You pin your note to the board (#{n}).")
        char.location.msg_contents(f"{char.key} pins a note to the board.", exclude=char)


class CmdUnpost(_BoardCmd):
    """
    Take a note off the tavern noticeboard: your own, or any if you are a builder.

    Usage:
      unpost <number>
    """

    key = "unpost"
    aliases = ["unpin"]

    def func(self):
        if not self.at_board():
            return
        char = self.caller
        try:
            number = int(self.args.strip().lstrip("#"))
        except ValueError:
            self.msg("Which note? Use its number, like 'unpost 3'.")
            return
        try:
            gone = noticeboard.remove(self.board, number, core_id=_core_id(char), force=char.check_permstring("Builder"))
        except noticeboard.NoteError as err:
            self.msg(str(err))
            return
        if gone["core_id"] != _core_id(char):
            audit.moderator_removed("mud.note_removed", _core_id(char), gone)
        self.msg(f"You take note #{number} down.")


class _BookCmd(Command):
    help_category = "General"

    def at_book(self):
        books = _here(self.caller, "book:tavern")
        if not books:
            self.msg("There is no guestbook here. It is on the bar in the tavern.")
            return False
        self.book = books[0]
        return True


class CmdGuestbook(_BookCmd):
    """
    Read the tavern guestbook, newest first, ten to a page.

    Usage:
      guestbook [page]
    """

    key = "guestbook"
    aliases = ["book", "visitors"]

    def func(self):
        if not self.at_book():
            return
        arg = self.args.strip()
        page = int(arg) if arg.isdigit() else 1
        for line in guestbook.lines(self.book, page):
            self.msg(line)


class CmdSign(_BookCmd):
    """
    Sign the tavern guestbook.

    Usage:
      sign <words>

    A line or two, up to 200 characters, one a minute. Take your own down with 'unsign <number>'; builders can remove any.
    """

    key = "sign"

    def func(self):
        if not self.at_book():
            return
        char = self.caller
        try:
            n = guestbook.sign(self.book, _core_id(char), char.key, self.args)
        except guestbook.NoteError as err:
            self.msg(str(err))
            return
        self.msg(f"You sign the guestbook (#{n}).")
        char.location.msg_contents(f"{char.key} signs the guestbook.", exclude=char)


class CmdUnsign(_BookCmd):
    """
    Strike an entry from the tavern guestbook: your own, or any if you are a builder.

    Usage:
      unsign <number>
    """

    key = "unsign"

    def func(self):
        if not self.at_book():
            return
        char = self.caller
        try:
            number = int(self.args.strip().lstrip("#"))
        except ValueError:
            self.msg("Which entry? Use its number, like 'unsign 3'.")
            return
        try:
            gone = guestbook.remove(self.book, number, core_id=_core_id(char), force=char.check_permstring("Builder"))
        except guestbook.NoteError as err:
            self.msg(str(err))
            return
        if gone["core_id"] != _core_id(char):
            audit.moderator_removed("mud.guestbook_removed", _core_id(char), gone)
        self.msg(f"You strike entry #{number} from the book.")

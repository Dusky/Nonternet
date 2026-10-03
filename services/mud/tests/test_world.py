"""The adventure areas, the first quest, the shop, the noticeboard and the weakened effect (docs/18)."""
import time
from unittest.mock import patch

from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest

from commands import world_cmds
from commands.world_cmds import CmdAsk, CmdBoard, CmdBuy, CmdGuestbook, CmdPost, CmdRead, CmdSearch, CmdSell, CmdShop, CmdSign, CmdUnpost, CmdUnsign
from world import audit, guestbook, noticeboard, shop
from world.build_town import build_town
from world.chargen import CharacterSheet

GAME = override_settings(BASE_CHARACTER_TYPECLASS="typeclasses.characters.Character", BASE_ROOM_TYPECLASS="typeclasses.rooms.Room", MAX_NR_CHARACTERS=3)


def room(key):
    return search_tag(f"room:{key}", category="build")[0]


@GAME
class WorldTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        self.account.attributes.add("core_id", "u_TEST")
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account  # as when someone is playing it
        self.hero.coins = 100
        self.hero.move_to(room("square"), quiet=True)

    def says(self, cmd, args, expected):
        """Run a command as the hero and check it said this (anywhere in what it printed)."""
        out = self.call(cmd, args, caller=self.hero)
        self.assertIn(expected, out or "")

    def go(self, key):
        self.hero.move_to(room(key), quiet=True)

    def test_a_new_character_can_afford_a_first_purchase_and_named_people_have_no_article(self):
        from world.chargen import START_COINS

        sheet = CharacterSheet()
        sheet.name = "Fern"
        fresh = sheet.apply(self.account2)
        fresh.db_account = self.account2
        self.assertEqual(fresh.coins, START_COINS)
        fresh.move_to(room("market"), quiet=True)
        self.says2 = lambda cmd, args, expected: self.assertIn(expected, self.call(cmd, args, caller=fresh) or "")
        self.says2(CmdBuy(), "dagger", "You buy a dagger")  # 5 of the 10
        self.go("tavern")
        look = room("tavern").return_appearance(self.hero)
        self.assertIn("Marta", look)
        self.assertNotIn("a Marta", look)
        self.assertNotIn("an Marta", look)

    # ---------------------------------------------------------------- reading and searching
    def test_notes_can_be_read_and_signs_say_so(self):
        from evennia import create_object

        create_object("typeclasses.objects.Readable", key="scrap of paper", aliases=["paper"], location=room("square"),
                      attributes=[("text", "Meet at the gate at dawn.")])
        self.says(CmdRead(), "paper", "Meet at the gate")
        self.says(CmdRead(), "", "Read what?")
        self.says(CmdRead(), "moon", "nothing to read")

    def test_hidden_ways_are_found_by_searching_and_only_by_the_one_who_searched(self):
        from evennia import create_object

        exit_ = create_object("typeclasses.exits.HiddenExit", key="crack", location=room("square"), destination=room("road"))
        exit_.tags.add("hidden", category="world")
        other = CharacterSheet()
        other.name = "Moss"
        other_char = other.apply(self.account2)
        self.assertFalse(exit_.access(self.hero, "view"))
        self.assertFalse(exit_.access(self.hero, "traverse"))  # not usable by name either
        self.says(CmdSearch(), "", "You find a way through: crack")
        self.assertTrue(exit_.access(self.hero, "view"))
        self.assertTrue(exit_.access(self.hero, "traverse"))
        self.assertFalse(exit_.access(other_char, "view"))  # theirs alone
        self.says(CmdSearch(), "", "nothing new")

    def test_marta_points_people_at_the_tower(self):
        self.go("tavern")
        self.says(CmdAsk(), "marta", "The tower?")
        self.says(CmdAsk(), "nobody", "Ask whom?")

    # ---------------------------------------------------------------- the shop
    def test_buying_and_selling_move_coins_and_items(self):
        self.go("market")
        self.says(CmdShop(), "", "For sale at Odo's")
        self.says(CmdBuy(), "dagger", "You buy a dagger for 5 coins")
        self.assertEqual(self.hero.coins, 95)
        self.assertTrue([o for o in self.hero.equipment.all(only_objs=True) if o.key == "dagger"])
        self.says(CmdSell(), "dagger", "pays you 2 coins")  # half of 5, rounded down
        self.assertEqual(self.hero.coins, 97)
        self.says(CmdBuy(), "unicorn", "nothing like that")
        self.hero.coins = 1
        self.says(CmdBuy(), "sword", "costs 10 coins and you have 1")
        self.says(CmdSell(), "moonbeam", "not carrying")

    def test_selling_cannot_make_coins_from_nothing(self):
        self.go("market")
        start = self.hero.coins
        for _ in range(3):
            self.says(CmdBuy(), "club", "You buy")
            self.says(CmdSell(), "club", "pays you")
        self.assertLess(self.hero.coins, start)  # buy at 2, sell at 1

    def test_the_shop_only_works_in_the_market(self):
        self.go("square")
        self.says(CmdShop(), "", "no shop here")
        self.says(CmdBuy(), "dagger", "no shop here")
        self.assertEqual(self.hero.coins, 100)

    # ---------------------------------------------------------------- the noticeboard
    def test_notes_are_pinned_read_and_taken_down(self):
        self.go("tavern")
        self.says(CmdBoard(), "", "board is bare")
        self.says(CmdPost(), "Looking for a group to clear the mine", "You pin your note to the board (#1)")
        self.says(CmdBoard(), "", "Looking for a group")
        self.says(CmdPost(), "again", "moment ago")  # one a minute
        self.says(CmdUnpost(), "1", "take note #1 down")
        self.says(CmdBoard(), "", "board is bare")

    def test_notes_are_short_plain_and_only_from_site_accounts_and_you_cannot_remove_anothers(self):
        board = search_tag("board:tavern", category="build")[0]
        with self.assertRaises(noticeboard.NoteError):
            noticeboard.post(board, "u_X", "A", "x" * 201)
        with self.assertRaises(noticeboard.NoteError):
            noticeboard.post(board, "u_X", "A", "   ")
        with self.assertRaises(noticeboard.NoteError):
            noticeboard.post(board, None, "A", "hello")
        noticeboard.post(board, "u_A", "Ann", "hello |rred|n\nworld", now=1000)
        self.assertNotIn("\n", noticeboard.notes(board)[0]["text"])
        self.assertNotIn("|r", "\n".join(noticeboard.lines(board)).replace("||r", "").replace("|c", "").replace("|w", "").replace("|x", "").replace("|n", ""))  # markup in a note is shown, not run
        with self.assertRaises(noticeboard.NoteError):
            noticeboard.remove(board, 1, core_id="u_B")
        noticeboard.remove(board, 1, core_id="u_A")
        self.assertEqual(noticeboard.notes(board), [])

    def test_only_the_last_thirty_notes_are_kept_and_an_erased_account_takes_its_notes_with_it(self):
        board = search_tag("board:tavern", category="build")[0]
        for i in range(35):
            noticeboard.post(board, f"u_{i}", "x", f"note {i}", now=1000 + i)
        self.assertEqual(len(noticeboard.notes(board)), noticeboard.MAX_NOTES)
        self.assertEqual(noticeboard.notes(board)[0]["text"], "note 5")
        self.assertEqual(noticeboard.remove_all_of(board, "u_34"), 1)
        self.assertNotIn("note 34", [n["text"] for n in noticeboard.notes(board)])

    def test_the_noticeboard_only_works_in_the_tavern(self):
        self.go("square")
        self.says(CmdPost(), "hello", "no noticeboard here")

    # ---------------------------------------------------------------- weakened
    def test_a_weakened_character_rolls_one_lower(self):
        from evennia.contrib.tutorials.evadventure.enums import Ability
        from evennia.contrib.tutorials.evadventure.rules import dice

        self.hero.strength = 0
        with patch.object(type(dice), "roll_with_advantage_or_disadvantage", return_value=16):
            ok, _q, _t = dice.saving_throw(self.hero, bonus_type=Ability.STR)
            self.assertTrue(ok)  # 16 + 0 > 15
            self.hero.db.weakened_until = time.time() + 60
            ok, _q, _t = dice.saving_throw(self.hero, bonus_type=Ability.STR)
            self.assertFalse(ok)  # 16 - 1 = 15, which is not over 15
            self.hero.db.weakened_until = time.time() - 1
            ok, _q, _t = dice.saving_throw(self.hero, bonus_type=Ability.STR)
            self.assertTrue(ok)  # worn off
        # Attacks go through the same roll, so they are weaker too: 16 beats a defence of 15 normally, and ties it when weakened.
        self.char2.armor = 5
        with patch.object(type(dice), "roll_with_advantage_or_disadvantage", return_value=16):
            self.assertTrue(dice.opposed_saving_throw(self.hero, self.char2, defense_type=Ability.ARMOR)[0])
            self.hero.db.weakened_until = time.time() + 60
            self.assertFalse(dice.opposed_saving_throw(self.hero, self.char2, defense_type=Ability.ARMOR)[0])


    # ---------------------------------------------------------------- the guestbook, and telling core about removals
    def test_the_guestbook_is_signed_read_and_struck(self):
        self.go("tavern")
        self.says(CmdGuestbook(), "", "book is empty")
        self.says(CmdSign(), "Lovely stew, kind landlady", "You sign the guestbook (#1)")
        self.says(CmdGuestbook(), "", "Lovely stew")
        self.says(CmdSign(), "again", "moment ago")  # one a minute
        self.says(CmdUnsign(), "1", "strike entry #1")
        self.says(CmdGuestbook(), "", "book is empty")
        self.says(CmdUnsign(), "7", "no entry with that number")

    def test_guestbook_entries_are_short_plain_paged_and_capped_and_erased_with_the_account(self):
        book = search_tag("book:tavern", category="build")[0]
        with self.assertRaises(noticeboard.NoteError):
            guestbook.sign(book, "u_X", "A", "x" * 201)
        with self.assertRaises(noticeboard.NoteError):
            guestbook.sign(book, None, "A", "hello")
        for i in range(guestbook.MAX_ENTRIES + 5):
            guestbook.sign(book, f"u_{i}", "x", f"line {i}", now=1000 + i)
        self.assertEqual(len(guestbook.entries(book)), guestbook.MAX_ENTRIES)
        self.assertEqual(guestbook.entries(book)[0]["text"], "line 5")
        page2 = guestbook.lines(book, 2)
        self.assertIn("page 2 of 10", page2[0])
        self.assertEqual(guestbook.remove_all_of(book, "u_104"), 1)
        guestbook.sign(book, "u_A", "Ann", "hello |rred|n", now=5000)
        self.assertNotIn("|r", "\n".join(guestbook.lines(book)[:2]).replace("||r", "").replace("|c", "").replace("|w", "").replace("|x", "").replace("|n", ""))
        with self.assertRaises(noticeboard.NoteError):
            guestbook.remove(book, guestbook.entries(book)[-1]["id"], core_id="u_B")

    def test_the_guestbook_only_works_in_the_tavern(self):
        self.go("square")
        self.says(CmdSign(), "hello", "no guestbook here")

    def test_a_builder_taking_down_someone_elses_words_is_reported_to_core_but_your_own_is_not(self):
        board = search_tag("board:tavern", category="build")[0]
        book = search_tag("book:tavern", category="build")[0]
        noticeboard.post(board, "u_OTHER", "Other", "buy my stuff", now=1000)
        guestbook.sign(book, "u_OTHER", "Other", "rude words", now=1000)
        guestbook.sign(book, "u_TEST", "Wren", "my own line", now=1000)
        self.go("tavern")
        self.hero.permissions.add("Builder")
        sent = []
        with patch.object(audit, "send", side_effect=sent.append):
            self.says(CmdUnpost(), "1", "take note #1 down")
            self.says(CmdUnsign(), "1", "strike entry #1")
            self.says(CmdUnsign(), "2", "strike entry #2")  # mine: nothing to report
        self.assertEqual([(m["action"], m["actor"], m["target"], m["text"]) for m in sent],
                         [("mud.note_removed", "u_TEST", "u_OTHER", "buy my stuff"), ("mud.guestbook_removed", "u_TEST", "u_OTHER", "rude words")])

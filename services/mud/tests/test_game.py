"""Our rules on top of EvAdventure (docs/18)."""
import time
from unittest.mock import patch

from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest, BaseEvenniaTest

from commands.characters import CmdCharCreate
from typeclasses.characters import Character
from world import duels
from world.build_town import build_town
from world.chargen import CharacterSheet, name_problem


# Evennia's test base resets these to its defaults; the game's own are what we test.
GAME = override_settings(BASE_CHARACTER_TYPECLASS="typeclasses.characters.Character", BASE_ROOM_TYPECLASS="typeclasses.rooms.Room", MAX_NR_CHARACTERS=3)


@GAME
class TownTest(BaseEvenniaTest):
    def test_builds_once_with_a_start_and_a_temple(self):
        self.assertGreater(build_town(), 10)
        self.assertEqual(build_town(), 0)  # nothing left to make
        square = search_tag("start", category="world")[0]
        temple = search_tag("respawn", category="world")[0]
        self.assertEqual(square.key, "Town square")
        self.assertFalse(square.allow_combat)
        self.assertFalse(temple.allow_combat)
        road = search_tag("room:road", category="build")[0]
        self.assertTrue(road.allow_combat)
        self.assertFalse(road.allow_pvp)
        self.assertFalse(road.allow_death)
        self.assertTrue([o for o in road.contents if o.key == "wild dog"])


@GAME
class CharacterTest(BaseEvenniaTest):
    def setUp(self):
        super().setUp()
        build_town()

    def test_character_sheet_makes_our_character_with_its_gear_and_charisma(self):
        sheet = CharacterSheet()
        sheet.name = "Wren"
        sheet.charisma, sheet.wisdom = 3, 1
        char = sheet.apply(self.account)
        self.assertIsInstance(char, Character)
        self.assertEqual(char.db.charisma, 3)  # upstream would have copied wisdom
        self.assertEqual(char.location, search_tag("start", category="world")[0])
        self.assertTrue(char.equipment.all())  # weapon and pack at least
        self.assertTrue(all(o.location == char for o in char.equipment.all(only_objs=True)))
        self.assertNotIn("none", [o.key for o in char.contents])

    def test_names_must_be_fresh_and_not_someone_elses_handle(self):
        self.assertIsNotNone(name_problem("x"))
        self.assertIsNotNone(name_problem("Robert the 2nd"))
        self.assertIsNone(name_problem("Wren"))
        self.assertIsNotNone(name_problem(self.account2.username, self.account))  # another person's handle
        self.assertIsNone(name_problem(self.account.username, self.account))      # your own is fine
        sheet = CharacterSheet()
        sheet.name = "Wren"
        sheet.apply(self.account)
        self.assertIsNotNone(name_problem("wren"))

    def test_defeat_is_never_death(self):
        sheet = CharacterSheet()
        sheet.name = "Moss"
        char = sheet.apply(self.account)
        road = search_tag("room:road", category="build")[0]
        char.move_to(road, quiet=True)
        gear = sorted(o.key for o in char.contents)
        self.assertIn("ration", gear)  # carried, not just listed
        char.hp = 0
        char.at_defeat()
        self.assertEqual(char.location, search_tag("respawn", category="world")[0])
        self.assertGreaterEqual(char.hp, 1)
        self.assertEqual(sorted(o.key for o in char.contents), gear)
        self.assertTrue(char.weakened)
        char.db.weakened_until = time.time() - 1
        self.assertFalse(char.weakened)

    def test_monsters_leave_when_beaten_and_come_back_healed(self):
        road = search_tag("room:road", category="build")[0]
        dog = [o for o in road.contents if o.key == "wild dog"][0]
        with patch("typeclasses.monsters.delay") as later:
            dog.hp = 0
            dog.at_defeat()
        self.assertIsNone(dog.location)
        later.assert_called_once()
        later.call_args[0][1]()  # time passes
        self.assertEqual(dog.location, road)
        self.assertEqual(dog.hp, dog.hp_max)


@GAME
class CharCreateTest(BaseEvenniaCommandTest):
    def test_three_characters_at_most(self):
        for name in ["Ash", "Birch", "Cedar"]:
            if len(self.account.characters.all()) >= 3:
                break
            sheet = CharacterSheet()
            sheet.name = name
            self.account.characters.add(sheet.apply(self.account))
        self.assertEqual(len(self.account.characters.all()), 3)
        self.call(CmdCharCreate(), "", "You already have 3 characters", caller=self.account)


@GAME
class WelcomeTest(BaseEvenniaTest):
    def test_someone_with_no_character_is_told_how_to_make_one(self):
        from typeclasses.accounts import Account

        for char in self.account.characters.all():
            self.account.characters.remove(char)
        with patch.object(self.account, "msg") as msg:
            Account.at_post_login(self.account, session=None)
        self.assertIn("charcreate", msg.call_args_list[0][0][0])

    def test_a_character_never_entered_is_entered_instead_of_an_error(self):
        from evennia import DefaultAccount

        from typeclasses.accounts import Account

        self.account.swap_typeclass(Account, clean_attributes=False)
        self.account.characters.add(self.char1)
        self.account.db._last_puppet = None
        with patch.object(DefaultAccount, "at_post_login") as base:
            self.account.at_post_login(session=None)
        base.assert_called_once()
        self.assertIn(self.account.db._last_puppet, list(self.account.characters.all()))


@GAME
class DuelTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        self.yard = search_tag("room:yard", category="build")[0]
        self.a = self.fighter(self.account, "Ash")
        self.b = self.fighter(self.account2, "Birch")
        self.c = self.fighter(self.account2, "Cedar")

    def fighter(self, account, name):
        sheet = CharacterSheet()
        sheet.name = name
        char = sheet.apply(account)
        char.move_to(self.yard, quiet=True)
        return char

    def says(self, cmd, args, who, expected):
        self.assertIn(expected, self.call(cmd, args, caller=who) or "")

    def test_the_yard_is_the_one_place_for_it_and_everything_else_still_refuses(self):
        from typeclasses.rooms import YardRoom

        self.assertIsInstance(self.yard, YardRoom)
        self.assertTrue(self.yard.allow_pvp)
        self.assertFalse(self.yard.allow_death)
        for key in ("square", "tavern", "temple", "market", "road"):
            self.assertFalse(search_tag(f"room:{key}", category="build")[0].allow_pvp)

    def test_a_yard_built_before_duels_is_upgraded_in_place(self):
        from typeclasses.rooms import YardRoom

        self.yard.swap_typeclass("typeclasses.rooms.Room", clean_attributes=False)
        self.assertNotIsInstance(search_tag("room:yard", category="build")[0], YardRoom)
        self.yard.db.desc = "An old yard."
        build_town()
        yard = search_tag("room:yard", category="build")[0]
        self.assertIsInstance(yard, YardRoom)
        self.assertIn("duel", yard.db.desc)

    def test_attack_is_ours_and_needs_agreement_with_that_very_person(self):
        from commands.duel_cmds import CmdAccept, CmdAttack, CmdDecline, CmdDuel

        from commands.default_cmdsets import CharacterCmdSet

        every = CharacterCmdSet()
        every.at_cmdset_creation()
        self.assertEqual([type(c) for c in every.commands if c.key == "attack"], [CmdAttack])  # ours replaced EvAdventure's
        self.says(CmdAttack(), "Birch", self.a, "only fight someone who has agreed")
        self.says(CmdDuel(), "Birch", self.a, "You challenge Birch")
        self.says(CmdAttack(), "Birch", self.a, "only fight someone who has agreed")  # not until they say yes
        self.says(CmdAccept(), "", self.b, "")
        self.assertTrue(duels.consented(self.a, self.b))
        self.assertFalse(duels.consented(self.a, self.c))
        self.says(CmdAttack(), "Cedar", self.a, "only fight someone who has agreed")  # nobody else can be hit
        self.says(CmdAttack(), "Ash", self.c, "only fight someone who has agreed")  # nor can Cedar join in
        self.says(CmdDecline(), "", self.b, "Nobody is waiting")

    def test_a_challenge_can_be_turned_down_or_lapse_and_only_works_in_the_yard(self):
        from commands.duel_cmds import CmdAccept, CmdDecline, CmdDuel

        self.says(CmdDuel(), "Birch", self.a, "You challenge Birch")
        self.says(CmdDecline(), "", self.b, "You turn Ash down")
        self.says(CmdAccept(), "", self.b, "Nobody is waiting")
        duels.challenge(self.a, self.b, now=1000)
        self.assertIsNone(duels.pending(self.b, now=1000 + duels.CHALLENGE_SECONDS + 1))
        self.says(CmdDuel(), "Ash", self.a, "can't duel yourself")
        self.a.move_to(search_tag("room:temple", category="build")[0], quiet=True)
        self.says(CmdDuel(), "Birch", self.a, "training yard")

    def test_walking_away_or_yielding_ends_it(self):
        from commands.duel_cmds import CmdYield

        duels.challenge(self.a, self.b)
        duels.accept(self.b)
        self.b.move_to(search_tag("room:temple", category="build")[0], quiet=True)
        self.assertIsNone(self.a.ndb.duel_with)
        self.assertIsNone(self.b.ndb.duel_with)
        self.b.move_to(self.yard, quiet=True)
        duels.challenge(self.a, self.b)
        duels.accept(self.b)
        self.says(CmdYield(), "", self.a, "")
        self.assertFalse(duels.consented(self.a, self.b))
        self.says(CmdYield(), "", self.a, "not in a duel")

    def test_losing_a_duel_leaves_you_in_the_yard_sore_but_not_weakened_and_a_real_fight_still_sends_you_to_the_temple(self):
        from evennia.contrib.tutorials.evadventure.combat_turnbased import _get_combathandler

        duels.challenge(self.a, self.b)
        duels.accept(self.b)
        combat = _get_combathandler(self.a, 30, 3)  # the turn-based handler fighting person against person
        combat.add_combatant(self.a)
        combat.add_combatant(self.b)
        self.assertEqual(combat.get_sides(self.a)[1], [self.b])
        gear = sorted(o.key for o in self.b.contents)
        self.b.hp = 0
        combat.check_stop_combat()
        self.assertEqual(self.b.location, self.yard)
        self.assertGreaterEqual(self.b.hp, 1)
        self.assertFalse(self.b.weakened)
        self.assertEqual(sorted(o.key for o in self.b.contents), gear)
        self.assertFalse(duels.consented(self.a, self.b))
        # outside a duel, defeat is as before
        self.c.hp = 0
        self.c.at_defeat()
        self.assertEqual(self.c.location, search_tag("respawn", category="world")[0])
        self.assertTrue(self.c.weakened)


@GAME
class OutOfCharacterScreenTest(BaseEvenniaTest):
    def test_says_who_you_are_and_what_to_type_without_connection_details(self):
        from typeclasses.accounts import Account

        empty = Account.at_look(self.account, target=[], session=self.session)
        self.assertIn("You have no character yet. Type |wcharcreate|n to roll one.", empty)
        self.assertNotIn("websocket", empty)
        self.assertNotIn("chardelete", empty)
        self.char1.key = "Wren"
        some = Account.at_look(self.account, target=[self.char1], session=self.session)
        self.assertIn("Your characters:", some)
        self.assertIn("|wWren|n", some)
        self.assertIn("ic <name>", some)

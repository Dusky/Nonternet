"""Our rules on top of EvAdventure (docs/18)."""
import time
from unittest.mock import patch

from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest, BaseEvenniaTest

from commands.characters import CmdCharCreate
from typeclasses.characters import Character
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

"""What the MUD tells a client besides text: vitals, room info and the area map (docs/09, world/oob.py)."""
from unittest.mock import patch

from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest

from server.conf import inputfuncs
from world import mapdata, oob
from world.build_town import build_town
from world.chargen import CharacterSheet

GAME = override_settings(BASE_CHARACTER_TYPECLASS="typeclasses.characters.Character", BASE_ROOM_TYPECLASS="typeclasses.rooms.Room", MAX_NR_CHARACTERS=3)


def room(key):
    return search_tag(f"room:{key}", category="build")[0]


@GAME
class OobTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account
        self.hero.move_to(room("square"), quiet=True)
        self.sent = []
        self.playing = patch.object(oob, "_playing", lambda _c: True)
        self.playing.start()
        self.msg = patch.object(type(self.hero), "msg", lambda _self, text=None, **kw: self.sent.append(kw))
        self.msg.start()

    def tearDown(self):
        self.msg.stop()
        self.playing.stop()
        super().tearDown()

    def last(self, name):
        found = [kw[name] for kw in self.sent if name in kw]
        return found[-1][1] if found else None

    def test_every_built_room_has_an_area_and_a_place_and_no_two_share_one(self):
        seen = set()
        for key, (area, x, y, z) in mapdata.COORDS.items():
            r = room(key)
            self.assertEqual(r.db.area, area)
            self.assertEqual(list(r.db.coord), [x, y, z])
            self.assertNotIn((area, x, y, z), seen, key)
            seen.add((area, x, y, z))
        from world import build_town as town

        self.assertEqual(set(mapdata.COORDS), set(town.ROOMS))

    def test_a_change_to_hp_or_coins_sends_vitals(self):
        self.hero.coins = 42
        v = self.last("vitals")
        self.assertEqual(v["coins"], 42)
        self.assertEqual(set(v), {"hp", "hp_max", "level", "xp", "xp_next", "coins", "weakened", "in_combat"})
        self.sent.clear()
        self.hero.coins = 42  # no change, nothing sent
        self.assertIsNone(self.last("vitals"))
        self.hero.hp = 1
        self.assertEqual(self.last("vitals")["hp"], 1)

    def test_moving_sends_room_info_with_exits_and_area(self):
        self.hero.move_to(room("tavern"), quiet=True)
        info = self.last("room_info")
        self.assertEqual(info["id"], room("tavern").id)
        self.assertEqual(info["area"], {"key": "town", "name": "Town"})
        self.assertEqual(info["coord"], [1, 0, 0])
        self.assertIn({"name": "west", "aliases": info["exits"][0]["aliases"], "to": room("square").id}, info["exits"])

    def test_a_hidden_exit_shows_only_after_it_is_found(self):
        from evennia import create_object

        hidden = create_object("typeclasses.exits.HiddenExit", key="crack", location=room("market"), destination=room("road"))
        self.hero.move_to(room("market"), quiet=True)
        self.assertNotIn("crack", [e["name"] for e in self.last("room_info")["exits"]])
        self.hero.db.found_exits = [hidden.id]
        oob.send_room(self.hero)
        self.assertIn("crack", [e["name"] for e in self.last("room_info")["exits"]])

    def test_the_area_map_lists_only_rooms_this_character_has_been_in(self):
        for key in ("tavern", "square", "market"):
            self.hero.move_to(room(key), quiet=True)
        m = oob.area_map(self.hero)
        self.assertEqual(m["area"]["key"], "town")
        self.assertEqual({r["id"] for r in m["rooms"]}, {room(k).id for k in ("tavern", "square", "market")})
        self.assertNotIn(room("temple").id, {r["id"] for r in m["rooms"]})  # never been there

    def test_a_tower_floor_is_its_own_area_with_its_own_name(self):
        from world.tower import floors

        self.hero.move_to(floors.entry(2), quiet=True)
        info = self.last("room_info")
        self.assertEqual(info["area"], {"key": "floor2", "name": "Floor 2"})
        self.assertEqual(info["coord"], [0, 0, 0])
        self.assertEqual(oob.area_map(self.hero)["area"]["key"], "floor2")

    def test_the_client_can_ask(self):
        class Session:
            puppet = self.hero
            got = []

            def msg(self, **kw):
                self.got.append(kw)

        s = Session()
        inputfuncs.vitals_get(s)
        inputfuncs.room_get(s)
        inputfuncs.area_map(s)
        self.assertEqual([list(kw)[0] for kw in s.got], ["vitals", "room_info", "area_map"])
        Session.puppet = None
        s.got.clear()
        inputfuncs.vitals_get(s)
        self.assertEqual(s.got, [])

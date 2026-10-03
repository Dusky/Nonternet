"""The tower (docs/18, world/tower): seeded floors, the stair guard, and the way between town and floor 1."""
from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest

from world.build_town import build_town
from world.chargen import CharacterSheet
from world.tower import floors, layout, seed

GAME = override_settings(BASE_CHARACTER_TYPECLASS="typeclasses.characters.Character", BASE_ROOM_TYPECLASS="typeclasses.rooms.Room", MAX_NR_CHARACTERS=3)


def room(key):
    return search_tag(f"room:{key}", category="build")[0]


def exit_named(location, name):
    return [e for e in location.exits if e.key == name][0]


class LayoutTest(BaseEvenniaCommandTest):
    def test_the_same_seed_makes_the_same_floor_and_another_seed_another(self):
        a = floors.plan(7, 1234)
        self.assertEqual(a, floors.plan(7, 1234))
        self.assertNotEqual(a, floors.plan(7, 4321))
        self.assertNotEqual(a, floors.plan(8, 1234))

    def test_every_room_can_be_reached_and_the_stair_is_as_far_as_any(self):
        for floor in range(1, 60):
            cells, stair, rooms = floors.plan(floor, 99)
            self.assertEqual(len(cells), layout.room_count(floor))
            dist = layout.distances(cells)
            self.assertEqual(set(dist), set(cells), floor)  # nothing cut off
            self.assertEqual(dist[stair], max(dist.values()))
            for (x, y), doors in cells.items():  # every doorway has a doorway back
                for d in doors:
                    dx, dy = layout.DIRS[d]
                    self.assertIn(layout.REVERSE[d], cells[(x + dx, y + dy)])

    def test_floors_grow_from_five_rooms_to_nine(self):
        self.assertEqual([layout.room_count(f) for f in (1, 5, 10, 20, 99)], [5, 6, 7, 9, 9])


@GAME
class TowerTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account
        self.hero.move_to(room("gate"), quiet=True)

    def test_the_gate_is_off_the_square_and_up_leads_to_floor_one(self):
        self.assertEqual(exit_named(room("square"), "tower").destination, room("gate"))
        self.assertIsNone(search_tag(f"floor:{seed.current()['season']}:1", category=floors.CAT).first())  # not built yet
        exit_named(room("gate"), "up").at_traverse(self.hero, None)
        first = floors.entry(1)
        self.assertEqual(self.hero.location, first)
        self.assertEqual(first.db.area_name, "Floor 1")
        self.assertEqual(exit_named(first, "down").destination, room("gate"))
        self.assertEqual(floors.progress(self.hero)["best"], 1)

    def test_a_floor_is_built_once_with_its_rooms_stair_and_guard(self):
        made = floors.ensure_floor(3)
        self.assertEqual(made, layout.room_count(3))
        self.assertEqual(floors.ensure_floor(3), 0)
        self.assertEqual(floors.ensure_floor(2), 0)  # the floors below came with it
        stair = floors.stair_room(3)
        guards = [o for o in stair.contents if o.db.warden_floor == 3]
        self.assertEqual(len(guards), 1)
        self.assertIn("stone stair", stair.db.desc)
        self.assertEqual(exit_named(floors.entry(3), "down").destination, floors.stair_room(2))

    def test_the_stair_opens_only_for_those_who_beat_the_guard(self):
        stair_room = floors.stair_room(1)
        up = exit_named(stair_room, "up")
        sheet = CharacterSheet()
        sheet.name = "Moss"
        other = sheet.apply(self.account2)
        self.hero.move_to(stair_room, quiet=True)
        self.assertIn("guarded", up.get_display_name(self.hero))
        up.at_traverse(self.hero, None)
        self.assertEqual(self.hero.location, stair_room)  # still here
        guard = [o for o in stair_room.contents if o.db.warden_floor == 1][0]
        guard.at_death()
        self.assertTrue(floors.has_cleared(self.hero, 1))
        self.assertFalse(floors.has_cleared(other, 1))  # was not there
        self.assertNotIn("guarded", up.get_display_name(self.hero))
        up.at_traverse(self.hero, None)
        self.assertEqual(self.hero.location, floors.entry(2))
        self.assertEqual(floors.progress(self.hero)["best"], 2)
        guard.respawn()  # comes back for the next person
        self.assertEqual(guard.location, stair_room)

    def test_progress_starts_fresh_each_season(self):
        floors.mark_cleared(self.hero, 1)
        s = seed.current()
        from evennia.server.models import ServerConfig

        ServerConfig.objects.conf(seed.KEY, value={"season": s["season"] + 1, "seed": 5})
        self.assertEqual(floors.progress(self.hero), {"season": s["season"] + 1, "cleared": [], "best": 0})

    def test_the_old_woods_and_mine_are_retired_and_whoever_stood_there_goes_to_the_square(self):
        from evennia import create_object

        from world import build_town as town

        old = create_object("typeclasses.rooms.WildRoom", key="Edge of the woods")
        old.tags.add("room:woods_edge", category="build")
        rat = create_object("typeclasses.monsters.Monster", key="wolf", location=old)
        self.hero.move_to(old, quiet=True)
        self.assertEqual(town.retire_old_areas(room("square")), 1)
        self.assertEqual(self.hero.location, room("square"))
        self.assertFalse(search_tag("room:woods_edge", category="build"))
        self.assertIsNone(rat.pk)

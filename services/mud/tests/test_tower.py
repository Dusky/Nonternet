"""The tower (docs/18, world/tower): seeded floors, the stair guard, and the way between town and floor 1."""
from django.test import override_settings
from evennia import search_tag
from evennia.utils.test_resources import BaseEvenniaCommandTest

from world.build_town import build_town
from world.chargen import CharacterSheet
from world.tower import floors, layout, scaling, seed

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


@GAME
class EnemyTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account

    def test_the_same_seed_puts_the_same_enemies_in_the_same_rooms(self):
        cells, stair, _rooms = floors.plan(14, 77)
        a = floors.enemy_plan(14, 77, cells, stair)
        self.assertEqual(a, floors.enemy_plan(14, 77, cells, stair))
        guards = [e for e in a if e[5]]
        self.assertEqual(len(guards), 1)
        self.assertEqual(guards[0][0], stair)
        self.assertEqual(guards[0][1], "bandit chief")  # floors 11-20 are bandits
        self.assertFalse([e for e in a if e[0] == (0, 0)])  # nobody waits at the entry

    def test_boss_floors_have_their_boss_and_floors_past_the_bosses_still_have_a_guard(self):
        for floor, name in ((10, "Rat Mother"), (20, "Captain Hesk"), (30, "Forge Engine")):
            cells, stair, _ = floors.plan(floor, 5)
            guard = [e for e in floors.enemy_plan(floor, 5, cells, stair) if e[5]][0]
            self.assertEqual((guard[1], guard[4]), (name, ("armoured", "hulking")))
        cells, stair, _ = floors.plan(40, 5)
        guard = [e for e in floors.enemy_plan(40, 5, cells, stair) if e[5]][0]
        self.assertEqual(guard[1], "bone knight")
        cells, stair, _ = floors.plan(70, 5)  # past the last family, the list starts again
        self.assertEqual([e for e in floors.enemy_plan(70, 5, cells, stair) if e[5]][0][1], "rat king")

    def test_enemies_get_tougher_with_height(self):
        low, high = scaling.enemy(1), scaling.enemy(60)
        self.assertLess(low["hit_dice"], high["hit_dice"])
        self.assertLess(low["armor"], high["armor"])
        self.assertEqual(low["damage"], "1d4")
        self.assertEqual(scaling.die(5), "2d4")
        self.assertEqual(scaling.enemy(5, traits=("armoured",))["armor"], scaling.enemy(5)["armor"] + 2)

    def test_a_built_floor_has_its_guard_and_named_traits(self):
        floors.ensure_floor(12)
        stair = floors.stair_room(12)
        guard = [o for o in stair.contents if o.db.warden_floor == 12][0]
        self.assertEqual(guard.key, "armoured bandit chief")
        self.assertEqual(guard.db.weapon.damage_roll, scaling.enemy(12, "strong", ("armoured",))["damage"])
        stats = scaling.enemy(12, "strong", ("armoured",))
        self.assertEqual((guard.hit_dice, guard.armor, guard.hp_max), (stats["hit_dice"], stats["armor"], stats["hit_dice"] * stats["hp_multiplier"]))
        self.assertEqual(guard.hp, guard.hp_max)  # starts at full health
        for obj in search_tag(f"season:{seed.current()['season']}", category=floors.CAT):
            if obj.is_typeclass("typeclasses.monsters.Monster", exact=False) and obj.db.traits and not obj.db.proper_name:
                self.assertTrue(obj.key.startswith(obj.db.traits[0]))

    def test_beating_an_enemy_pays_everyone_there_and_levels_them_up(self):
        floors.ensure_floor(1)
        room = floors.stair_room(1)
        self.hero.move_to(room, quiet=True)
        guard = [o for o in room.contents if o.db.warden_floor == 1][0]
        coins = self.hero.coins
        guard.db.xp = 60
        guard.at_death()
        self.assertEqual(self.hero.coins, coins + guard.coins)
        self.assertEqual(self.hero.level, 2)  # 50 xp for level 2
        self.assertGreater(self.hero.hp_max, 0)

    def test_rest_heals_but_not_in_a_fight_or_next_to_an_enemy(self):
        from commands.world_cmds import CmdRest

        self.hero.move_to(room("square"), quiet=True)
        self.hero.hp_max = 40
        self.hero.hp = 1
        out = self.call(CmdRest(), "", caller=self.hero)
        self.assertIn("recover", out)
        self.assertGreater(self.hero.hp, 1)
        self.assertIn("a moment ago", self.call(CmdRest(), "", caller=self.hero))
        floors.ensure_floor(1)
        self.hero.move_to(floors.stair_room(1), quiet=True)
        self.hero.ndb.rested_at = 0
        self.hero.hp = 1
        self.assertIn("enemy in the room", self.call(CmdRest(), "", caller=self.hero))


class BalanceTest(BaseEvenniaCommandTest):
    """The difficulty curve, from the simulator (world/tower/balance.py). If tuning breaks these, look at the table in docs/18."""

    def test_the_first_floors_are_kind_to_a_new_character(self):
        from world.tower import balance

        for floor in (1, 2, 3, 5):
            self.assertGreaterEqual(balance.simulate(floor, trials=400)["win"], 0.8, floor)
            self.assertGreaterEqual(balance.simulate(floor, "guard", trials=400)["win"], 0.75, floor)

    def test_it_gets_harder_but_never_hopeless_before_floor_eighty(self):
        from world.tower import balance

        for floor in (10, 20, 30, 50, 70):
            r = balance.simulate(floor, trials=400)
            self.assertGreaterEqual(r["win"], 0.6, floor)
        self.assertLess(balance.simulate(100, trials=400)["win"], balance.simulate(5, trials=400)["win"])
        self.assertLess(balance.simulate(10, "guard", trials=400)["win"], 0.7)  # a boss is meant to be hard alone


@GAME
class FightTest(BaseEvenniaCommandTest):
    def test_a_real_turn_based_fight_with_a_generated_enemy_ends_in_rewards(self):
        """Through EvAdventure's own combat handler: the enemy's weapon, health and the rewards all work for real."""
        from evennia.contrib.tutorials.evadventure.combat_turnbased import _get_combathandler

        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        hero = sheet.apply(self.account)
        hero.db_account = self.account
        floors.ensure_floor(1)
        room_ = floors.stair_room(1)
        hero.move_to(room_, quiet=True)
        hero.strength, hero.hp_max, hero.hp = 10, 200, 200
        guard = [o for o in room_.contents if o.db.warden_floor == 1][0]
        xp = hero.xp
        combat = _get_combathandler(hero, 30, 3)
        combat.add_combatant(hero)
        combat.add_combatant(guard)
        for _ in range(60):
            if guard.location != room_:
                break
            combat.queue_action(hero, {"key": "attack", "target": guard})
            combat.queue_action(guard, {"key": "attack", "target": hero})
            combat.at_repeat()
        self.assertIsNone(guard.location)  # beaten, out of the world until it comes back
        self.assertGreater(hero.xp, xp)
        self.assertTrue(floors.has_cleared(hero, 1))

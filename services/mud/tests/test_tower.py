"""The tower (docs/18, world/tower): seeded floors, the stair guard, and the way between town and floor 1."""
from unittest.mock import patch

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
        self.assertEqual(floors.progress(self.hero), {"season": s["season"] + 1, "cleared": [], "best": 0, "checkpoint": 0})

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


@GAME
class LootTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account
        self.hero.move_to(room("square"), quiet=True)

    def test_drops_follow_the_floor_and_their_names_say_what_they_are(self):
        import random

        from world.tower import loot, tables

        rng = random.Random(1)
        items = [loot.roll(f, rng) for f in range(1, 200) for _ in range(3)]
        for it in items:
            self.assertLessEqual(len(it["name"].split()), 8, it["name"])
            self.assertLessEqual(len(it["name"]), 48, it["name"])
            for a in it["affixes"]:
                self.assertIn(a.removeprefix("of "), it["name"])
            if it["rarity"] in ("fine", "epic"):
                self.assertTrue(it["name"].startswith("fine "))
            self.assertIn(it["base"], it["name"])
        low = [it for it in items if it["floor"] < 10 and it["kind"] == "weapon"]
        high = [it for it in items if it["floor"] > 150 and it["kind"] == "weapon"]
        self.assertTrue(all("+" in it["name"] for it in high))  # past masterwork, a number counts up
        self.assertLess(max(int(i["damage"].split("d")[0]) for i in low), max(int(i["damage"].split("d")[0]) for i in high))
        # Rarer finds get likelier with height.
        epic_low = sum(loot.rarity(1, random.Random(i)) == "epic" for i in range(2000))
        epic_high = sum(loot.rarity(100, random.Random(i)) == "epic" for i in range(2000))
        self.assertLess(epic_low, epic_high)
        self.assertEqual({a for a in tables.WEAPON_AFFIXES} & {a for a in tables.ARMOUR_AFFIXES}, set())

    def test_a_drop_becomes_a_real_item_in_your_pack_or_waits_in_spoils(self):
        from world.tower import loot

        item = {"kind": "weapon", "base": "maul", "two_handed": True, "damage": "1d10", "desc": "A maul.", "name": "fine heavy iron maul",
                "rarity": "epic", "affixes": ["heavy", "brutal"], "floor": 14, "value": 120}
        obj = loot.give(self.hero, item)
        self.assertEqual(obj.location, self.hero)
        self.assertEqual(obj.damage_roll, "1d10")
        self.assertTrue(obj.db.unbanked)
        self.assertIn("2 more damage", obj.db.desc)
        from world import shop

        self.assertEqual(shop.sell_price(obj), 60)
        # A full pack: it goes to spoils, and comes back with claim once there is room.
        with patch.object(type(self.hero.equipment), "add", side_effect=__import__("evennia.contrib.tutorials.evadventure.equipment", fromlist=["EquipmentError"]).EquipmentError("full")):
            self.assertIsNone(loot.give(self.hero, dict(item, name="spare maul")))
        self.assertEqual([s["name"] for s in self.hero.db.spoils], ["spare maul"])
        self.assertIn("You take spare maul", loot.claim(self.hero, 1))
        self.assertEqual(self.hero.db.spoils, [])
        self.assertIn("no spoil", loot.claim(self.hero, 3))

    def test_every_affix_does_what_it_says(self):
        from evennia import create_object

        from world.tower import loot

        mob = create_object("typeclasses.monsters.Monster", key="dummy", location=room("road"), attributes=[("hit_dice", 10)])
        mob.hp = mob.hp_max
        weapon = loot.make({"kind": "weapon", "base": "sword", "two_handed": False, "damage": "1d6", "desc": "x", "name": "brutal leeching sword",
                            "rarity": "rare", "affixes": ["brutal", "leeching"], "floor": 3, "value": 10}, self.hero)
        self.hero.equipment.add(weapon)
        self.hero.equipment.move(weapon)
        self.hero.hp_max, self.hero.hp = 20, 10
        before = mob.hp
        mob.at_damage(3, attacker=self.hero)
        self.assertEqual(mob.hp, before - 5)  # brutal: 3 + 2
        self.assertEqual(self.hero.hp, 11)  # leeching: +1
        coat = loot.make({"kind": "body", "base": "quilted coat", "armor": 1, "desc": "x", "name": "quilted coat of warding of thorns",
                          "rarity": "epic", "affixes": ["of warding", "of thorns"], "floor": 3, "value": 10}, self.hero)
        self.hero.equipment.add(coat)
        self.hero.equipment.move(coat)
        self.hero.hp = 20
        mob_hp = mob.hp
        self.hero.at_damage(4, attacker=mob)
        self.assertEqual(self.hero.hp, 17)  # warding: 4 - 1
        self.assertEqual(mob.hp, mob_hp - 1)  # thorns

    def test_a_beaten_guard_always_drops_something_for_each_person_there(self):
        floors.ensure_floor(2)
        stair = floors.stair_room(2)
        self.hero.move_to(stair, quiet=True)
        guard = [o for o in stair.contents if o.db.warden_floor == 2][0]
        before = len(self.hero.contents)
        guard.at_death()
        found = [o for o in self.hero.contents if o.db.found_floor == 2]
        self.assertEqual(len(found), 1)
        self.assertEqual(len(self.hero.contents), before + 1)


@GAME
class CheckpointSeasonTest(BaseEvenniaCommandTest):
    def setUp(self):
        super().setUp()
        build_town()
        sheet = CharacterSheet()
        sheet.name = "Wren"
        self.hero = sheet.apply(self.account)
        self.hero.db_account = self.account

    def _find(self, floor=5, name="iron sword"):
        from world.tower import loot

        return loot.give(self.hero, {"kind": "weapon", "base": "sword", "two_handed": False, "damage": "1d6", "desc": "A sword.",
                                     "name": name, "rarity": "common", "affixes": [], "floor": floor, "value": 10})

    def test_beating_a_boss_sets_the_checkpoint_and_makes_finds_safe(self):
        found = self._find()
        floors.ensure_floor(10)
        boss_room = floors.stair_room(10)
        self.hero.move_to(boss_room, quiet=True)
        boss = [o for o in boss_room.contents if o.db.warden_floor == 10][0]
        self.assertEqual(boss.key, "Rat Mother")
        boss.at_death()
        self.assertEqual(floors.progress(self.hero)["checkpoint"], 10)
        self.assertFalse(found.db.unbanked)

    def test_a_defeat_loses_unbanked_finds_in_the_pack_but_not_what_you_wear(self):
        kept_old = self._find(name="old sword")
        kept_old.attributes.remove("unbanked")  # from before the last checkpoint
        worn = self._find(name="new sword")
        self.hero.equipment.move(worn)  # wielded
        lost = self._find(name="spare sword")
        self.hero.move_to(floors.entry(3), quiet=True)
        self.hero.at_defeat()
        names = [o.key for o in self.hero.contents]
        self.assertIn("old sword", names)
        self.assertIn("new sword", names)
        self.assertNotIn("spare sword", names)
        self.assertIsNone(lost.pk)
        self.assertEqual(self.hero.location, search_tag("respawn", category="world")[0])

    def test_ascend_goes_to_the_floor_above_the_checkpoint_but_only_from_the_gate(self):
        from commands.world_cmds import CmdAscend

        self.hero.move_to(room("square"), quiet=True)
        self.assertIn("only ascend from the tower gate", self.call(CmdAscend(), "", caller=self.hero))
        self.hero.move_to(room("gate"), quiet=True)
        self.assertIn("no checkpoint", self.call(CmdAscend(), "", caller=self.hero))
        floors.set_checkpoint(self.hero, 10)
        self.call(CmdAscend(), "", caller=self.hero)
        self.assertEqual(self.hero.location, floors.entry(11))

    def test_the_landing_after_a_boss_has_a_trader_and_a_way_home(self):
        from commands.world_cmds import CmdBuy, CmdShop

        landing = floors.entry(11)
        self.assertTrue([o for o in landing.contents if o.key == "Sela"])
        self.assertEqual([e for e in landing.exits if e.key == "home"][0].destination, room("gate"))
        self.hero.move_to(landing, quiet=True)
        self.hero.coins = 50
        self.assertIn("For sale at Sela's", self.call(CmdShop(), "", caller=self.hero))
        self.assertIn("You buy a dagger", self.call(CmdBuy(), "dagger", caller=self.hero))
        self.assertFalse([o for o in floors.entry(5).contents if o.key == "Sela"])  # only after a boss

    def test_a_new_month_rebuilds_the_tower_keeps_people_and_their_gear_and_remembers_the_leaders(self):
        from evennia.server.models import ServerConfig

        from world.tower import seasons

        sword = self._find()
        floors.ensure_floor(4)
        inside = floors.entry(4)
        self.hero.move_to(inside, quiet=True)
        old = seed.current()
        self.assertFalse(seasons.due())
        ServerConfig.objects.conf(seed.KEY, value=dict(old, month="2000-01"))
        self.assertTrue(seasons.due())
        with patch("evennia.SESSION_HANDLER.announce_all"):
            new = seasons.reset()
        self.assertEqual(new, old["season"] + 1)
        self.assertEqual(self.hero.location, room("gate"))
        self.assertEqual(sword.location, self.hero)  # carried things are never touched
        self.assertFalse(search_tag(f"season:{old['season']}", category=floors.CAT))
        self.assertIsNone(inside.pk)
        history = ServerConfig.objects.conf(seasons.HISTORY_KEY)
        self.assertEqual(history[-1]["leaders"], [{"name": "Wren", "best": 4}])
        self.assertEqual(floors.progress(self.hero)["best"], 0)  # a fresh season
        self.assertEqual(floors.entry(1).db.season, new)  # and a fresh tower
        self.assertFalse(seasons.due())

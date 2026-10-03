"""Core's control endpoints (docs/09)."""
import json
from unittest.mock import patch

from django.test import Client, override_settings
from evennia.utils.test_resources import BaseEvenniaTest

from server.conf.core_auth import CoreBackend

TOKEN = "test-control-token"


@override_settings(MUD_CONTROL_TOKEN=TOKEN)
class InternalApiTest(BaseEvenniaTest):
    def post(self, path, body, token=TOKEN):
        return Client().post(path, json.dumps(body), content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}")

    def make(self, name, core_id, role="user", builder=False):
        with patch("server.conf.core_auth.ask_core", return_value={"success": True, "accountName": name, "user_id": core_id, "role": role, "builder": builder}):
            return CoreBackend().authenticate(None, name, "pw")

    def test_needs_the_token(self):
        self.assertEqual(Client().get("/internal/status").status_code, 403)
        self.assertEqual(Client().get("/internal/status", HTTP_AUTHORIZATION="Bearer wrong").status_code, 403)
        self.assertEqual(self.post("/internal/broadcast", {"text": "hi"}, token="wrong").status_code, 403)

    def test_status_counts_things(self):
        res = Client().get("/internal/status", HTTP_AUTHORIZATION=f"Bearer {TOKEN}")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("sessions", body)
        self.assertGreaterEqual(body["counts"]["accounts"], 1)

    def test_sync_renames_changes_roles_and_disconnects(self):
        ann = self.make("ann", "u_ANN")
        bob = self.make("bob", "u_BOB")
        with patch("web.internal._disconnect", return_value=1) as dropped:
            res = self.post("/internal/accounts/sync", {"accounts": [
                {"core_id": "u_ANN", "handle": "annie", "status": "active", "role": "admin", "builder": False},
                {"core_id": "u_BOB", "handle": "bob", "status": "suspended", "role": "user", "builder": False},
                {"core_id": "u_NOBODY", "handle": "ghost", "status": "active", "role": "user", "builder": False},
            ]}).json()
        self.assertEqual(res, {"renamed": 1, "roles": 1, "disconnected": 1})
        dropped.assert_called_once()
        self.assertEqual(dropped.call_args[0][0].pk, bob.pk)
        ann.refresh_from_db()
        self.assertEqual(ann.username, "annie")
        self.assertEqual(sorted(ann.permissions.all()), ["developer"])

    def test_export_has_each_character_and_deletion_removes_them(self):
        from world.build_town import build_town
        from world.chargen import CharacterSheet

        build_town()
        cat = self.make("cat", "u_CAT")
        sheet = CharacterSheet()
        sheet.name = "Tansy"
        cat.characters.add(sheet.apply(cat))
        out = self.post("/internal/export", {"core_id": "u_CAT"}).json()
        self.assertEqual(out["account"], "cat")
        self.assertEqual([c["name"] for c in out["characters"]], ["Tansy"])
        self.assertEqual(out["characters"][0]["location"], "Town square")
        self.assertTrue(out["characters"][0]["carrying"])
        self.assertEqual(self.post("/internal/export", {"core_id": "u_NOBODY"}).json(), {"account": None, "characters": []})
        # What they pinned to the noticeboard and how far they got on a quest are theirs too, and leave with the account.
        from evennia import search_tag

        from world import noticeboard

        board = search_tag("board:tavern", category="build")[0]
        noticeboard.post(board, "u_CAT", "Tansy", "Looking for a group", now=1000)
        noticeboard.post(board, "u_OTHER", "Someone", "Not hers", now=1000)
        from world import guestbook

        book = search_tag("book:tavern", category="build")[0]
        guestbook.sign(book, "u_CAT", "Tansy", "Thank you for the stew", now=1000)
        guestbook.sign(book, "u_OTHER", "Someone", "Not hers", now=1000)
        cat.characters.all()[0].db.quests = {"ledger": {"step": 2}}
        cat.characters.all()[0].db.tower = {"season": 1, "cleared": [1, 2], "best": 3}
        out = self.post("/internal/export", {"core_id": "u_CAT"}).json()
        self.assertEqual([n["text"] for n in out["noticeboard_notes"]], ["Looking for a group"])
        self.assertEqual([e["text"] for e in out["guestbook_entries"]], ["Thank you for the stew"])
        self.assertEqual(out["characters"][0]["quests"], {"ledger": {"step": 2}})
        self.assertEqual(out["characters"][0]["tower"], {"season": 1, "cleared": [1, 2], "best": 3})
        with patch("web.internal._disconnect", return_value=0):
            res = self.post("/internal/accounts/sync", {"accounts": [{"core_id": "u_CAT", "handle": "deleted-1", "status": "deleted", "role": "user", "builder": False}]}).json()
        self.assertEqual(res["deleted"], 1)
        self.assertEqual(self.post("/internal/export", {"core_id": "u_CAT"}).json()["characters"], [])
        self.assertEqual([n["text"] for n in noticeboard.notes(board)], ["Not hers"])
        self.assertEqual([e["text"] for e in guestbook.entries(book)], ["Not hers"])
        from evennia.objects.models import ObjectDB
        self.assertFalse(ObjectDB.objects.filter(db_key="Tansy").exists())

    def test_characters_lists_every_site_character_with_its_sheet(self):
        from world.build_town import build_town
        from world.chargen import CharacterSheet

        build_town()
        dee = self.make("dee", "u_DEE")
        sheet = CharacterSheet()
        sheet.name = "Rook"
        char = sheet.apply(dee)
        dee.characters.add(char)
        got = [c for c in Client().get("/internal/characters", HTTP_AUTHORIZATION=f"Bearer {TOKEN}").json()["characters"] if c["core_id"] == "u_DEE"]
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["id"], f"c_{char.id}")
        self.assertEqual(got[0]["name"], "Rook")
        self.assertEqual(set(got[0]["abilities"]), {"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"})
        self.assertNotIn("carrying", got[0])
        self.assertNotIn("location", got[0])
        self.assertEqual(Client().get("/internal/characters").status_code, 403)

    def test_broadcast_reaches_everyone(self):
        with patch("evennia.SESSION_HANDLER.announce_all") as announce:
            self.assertEqual(self.post("/internal/broadcast", {"text": "Maintenance at ten"}).json(), {"sent": True})
        announce.assert_called_once_with("|y[Announcement]|n Maintenance at ten")

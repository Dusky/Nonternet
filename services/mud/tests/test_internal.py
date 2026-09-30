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

    def test_broadcast_reaches_everyone(self):
        with patch("evennia.SESSION_HANDLER.announce_all") as announce:
            self.assertEqual(self.post("/internal/broadcast", {"text": "Maintenance at ten"}).json(), {"sent": True})
        announce.assert_called_once_with("|y[Announcement]|n Maintenance at ten")

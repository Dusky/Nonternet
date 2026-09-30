"""The login backend hands every password to core (docs/09)."""
from unittest.mock import patch

from evennia.accounts.models import AccountDB
from evennia.utils.test_resources import BaseEvenniaTestCase

from server.conf.core_auth import CoreBackend


def core_says(**answer):
    return patch("server.conf.core_auth.ask_core", return_value=answer)


class CoreBackendTest(BaseEvenniaTestCase):
    def test_refuses_when_core_says_no_or_is_down(self):
        with core_says(success=False):
            self.assertIsNone(CoreBackend().authenticate(None, "ann", "nope"))
        with patch("server.conf.core_auth.ask_core", return_value=None):
            self.assertIsNone(CoreBackend().authenticate(None, "ann", "anything"))
        self.assertIsNone(CoreBackend().authenticate(None, "ann", ""))
        self.assertFalse(AccountDB.objects.filter(username__iexact="ann").exists())

    def test_creates_the_account_once_keyed_by_core_id_with_no_usable_password(self):
        with core_says(success=True, accountName="ann", user_id="u_01ANN", role="user", builder=False):
            first = CoreBackend().authenticate(None, "ann", "tk1_x")
            second = CoreBackend().authenticate(None, "ANN", "tk1_y")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(first.attributes.get("core_id"), "u_01ANN")
        self.assertFalse(first.has_usable_password())
        self.assertTrue(first.permissions.check("Player"))

    def test_follows_a_rename_by_core_id(self):
        with core_says(success=True, accountName="bob", user_id="u_01BOB", role="user", builder=False):
            bob = CoreBackend().authenticate(None, "bob", "pw")
        with core_says(success=True, accountName="robert", user_id="u_01BOB", role="user", builder=False):
            robert = CoreBackend().authenticate(None, "robert", "pw")
        self.assertEqual(bob.pk, robert.pk)
        self.assertEqual(robert.username, "robert")

    def test_maps_site_roles_and_builders_to_permissions(self):
        with core_says(success=True, accountName="cat", user_id="u_01CAT", role="user", builder=True):
            cat = CoreBackend().authenticate(None, "cat", "pw")
        self.assertEqual(sorted(cat.permissions.all()), ["builder"])
        with core_says(success=True, accountName="cat", user_id="u_01CAT", role="admin", builder=False):
            cat = CoreBackend().authenticate(None, "cat", "pw")
        self.assertEqual(sorted(cat.permissions.all()), ["developer"])
        with core_says(success=True, accountName="cat", user_id="u_01CAT", role="trusted", builder=False):
            cat = CoreBackend().authenticate(None, "cat", "pw")
        self.assertEqual(sorted(cat.permissions.all()), ["player"])

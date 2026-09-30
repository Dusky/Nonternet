"""
Sign-in through core (docs/09). Evennia never checks a password itself: every `connect <handle> <password>`
goes to core, which accepts the person's terminal password or a one-use ticket from the MUD window.
VERIFIED against Evennia 5.0.1 (docs/spikes/m6-evennia.md).
"""
import json
import secrets
import urllib.request

from django.conf import settings
from django.contrib.auth import get_user_model

BACKEND = "server.conf.core_auth.CoreBackend"


def ask_core(username, password):
    """Core's answer, or None if core could not be reached."""
    req = urllib.request.Request(
        f"{settings.CORE_URL}/internal/mud/auth",
        data=json.dumps({"accountName": username, "passphrase": password}).encode(),
        headers={"authorization": f"Bearer {settings.CORE_AUTH_TOKEN}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read())
    except Exception:  # core down or refusing: nobody gets in
        return None


def apply_role(account, role, builder):
    """Site role and builder appointment become Evennia permissions."""
    wanted = "Developer" if role == "admin" else "Builder" if builder else "Player"
    for perm in ("Player", "Builder", "Admin", "Developer"):
        if perm != wanted:
            account.permissions.remove(perm)
    account.permissions.add(wanted)


def find_account(core_id, name):
    from evennia.accounts.models import AccountDB

    for account in AccountDB.objects.filter(db_attributes__db_key="core_id", db_attributes__db_value=core_id):
        return account
    return AccountDB.objects.filter(username__iexact=name).first()


class CoreBackend:
    def authenticate(self, request, username=None, password=None, autologin=None):
        if autologin:  # Evennia's own webclient session autologin
            autologin.backend = BACKEND
            return autologin
        if not username or not password:
            return None
        res = ask_core(username, password)
        if not res or not res.get("success"):
            return None
        account = find_account(res["user_id"], res["accountName"])
        if account is None:
            from evennia.utils.utils import class_from_module

            # The game's own account class (DefaultAccount.create would make a plain DefaultAccount).
            Account = class_from_module(settings.BASE_ACCOUNT_TYPECLASS)
            account, _errors = Account.create(username=res["accountName"], password=secrets.token_urlsafe(32))
            if account is None:
                return None
        elif account.username != res["accountName"]:
            account.username = res["accountName"]  # renamed on the site
        account.set_unusable_password()  # only core ever signs anyone in
        account.save()
        account.attributes.add("core_id", res["user_id"])
        apply_role(account, res.get("role"), res.get("builder"))
        return account

    def get_user(self, user_id):
        return get_user_model().objects.filter(pk=user_id).first()

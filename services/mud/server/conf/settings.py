r"""
Settings for the site's MUD (docs/09, docs/18). Everything that differs between sites comes from the
environment and the site config, so nothing here names the site:

  SITE_CONFIG        path to the site config (the site name becomes the MUD's name)
  MUD_SECRET         shared with core (32+ characters); tokens are derived from it the same way core does
  CORE_URL           where core answers, default http://core:3000
  MUD_DATABASE_URL   postgres://user:pass@host:port/db; without it a local SQLite file is used (dev, tests)
  MUD_TELNET_PORT / MUD_WEB_PORT / MUD_WS_PORT / MUD_AMP_PORT   default 4000 / 4001 / 4002 / 4006
  MUD_UPSTREAM_IPS   comma-separated addresses of the reverse proxy (Caddy); their X-Forwarded-For is trusted.
                     VERIFIED: Evennia 5.0.1 matches these exactly, so give Caddy a fixed address.
  MUD_LOGIN_THROTTLE_LIMIT  failed logins per address before a pause (default Evennia's 5; tests raise it)
"""
import base64
import hashlib
import hmac
import os
from urllib.parse import urlparse

import yaml

from evennia.settings_default import *  # noqa: F401,F403

_site = {}
if os.environ.get("SITE_CONFIG"):
    with open(os.environ["SITE_CONFIG"], encoding="utf8") as f:
        _site = yaml.safe_load(f) or {}
SERVERNAME = (_site.get("site") or {}).get("name") or "MUD"

_secret = os.environ.get("MUD_SECRET", "")
if _secret and len(_secret) < 32:
    raise RuntimeError("MUD_SECRET must be at least 32 characters")


def _derive(purpose):
    # The same derivation as core's mud/secrets.ts: HMAC-SHA256(secret, "mud:<purpose>"), base64url.
    mac = hmac.new(_secret.encode(), f"mud:{purpose}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode()


CORE_URL = os.environ.get("CORE_URL", "http://core:3000").rstrip("/")
CORE_AUTH_TOKEN = _derive("auth") if _secret else ""
MUD_CONTROL_TOKEN = _derive("control") if _secret else ""
SECRET_KEY = _derive("django") if _secret else "dev-only-not-secret"

# Sign-in goes through core; there are no MUD passwords and no sign-up here (docs/09).
AUTHENTICATION_BACKENDS = ["server.conf.core_auth.CoreBackend"]
NEW_ACCOUNT_REGISTRATION_ENABLED = False
GUEST_ENABLED = False

# Up to three characters per account, made in-game (docs/18, decided 2026-09-30).
MAX_NR_CHARACTERS = 3

TELNET_PORTS = [int(os.environ.get("MUD_TELNET_PORT", 4000))]
WEBSERVER_PORTS = [(int(os.environ.get("MUD_WEB_PORT", 4001)), int(os.environ.get("MUD_WEB_INTERNAL_PORT", 4005)))]
WEBSOCKET_CLIENT_PORT = int(os.environ.get("MUD_WS_PORT", 4002))
AMP_PORT = int(os.environ.get("MUD_AMP_PORT", 4006))
UPSTREAM_IPS = [ip.strip() for ip in os.environ.get("MUD_UPSTREAM_IPS", "127.0.0.1").split(",") if ip.strip()]
LOGIN_THROTTLE_LIMIT = int(os.environ.get("MUD_LOGIN_THROTTLE_LIMIT", LOGIN_THROTTLE_LIMIT))
# The web server is only on the private network (Caddy routes nothing to it but the WebSocket).
ALLOWED_HOSTS = ["*"]

if os.environ.get("MUD_DATABASE_URL"):
    _db = urlparse(os.environ["MUD_DATABASE_URL"])
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db.path.lstrip("/"),
            "USER": _db.username or "",
            "PASSWORD": _db.password or "",
            "HOST": _db.hostname or "",
            "PORT": str(_db.port or 5432),
        }
    }

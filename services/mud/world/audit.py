"""
Tell core when a builder or admin takes someone's words down in the game, so it is in the audit log with the
rest of the moderation record (docs/03). Best effort and never blocks play: if core can't be reached it is logged.
"""
import json
import urllib.request

from django.conf import settings
from evennia.utils import logger


def _post(payload):
    req = urllib.request.Request(
        f"{settings.CORE_URL}/internal/mud/audit", data=json.dumps(payload).encode(), method="POST",
        headers={"authorization": f"Bearer {settings.CORE_AUTH_TOKEN}", "content-type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as err:  # the removal already happened; say so in our own log
        logger.log_err(f"could not tell core about {payload['action']}: {err}")


def send(payload):
    """Tests replace this; in the game it runs off the reactor thread."""
    from twisted.internet import reactor, threads

    if reactor.running:
        threads.deferToThread(_post, payload)
    else:
        _post(payload)


def moderator_removed(action, actor_core_id, note):
    """Call only when someone other than the author took it down. `note` is the entry that went."""
    if not actor_core_id:
        return
    send({"action": action, "actor": actor_core_id, "target": note.get("core_id"), "text": note.get("text", "")[:400]})

"""
Core's way in (docs/09): a few JSON endpoints on the MUD's internal web server, which Caddy never routes
from outside. Every call needs the control token derived from MUD_SECRET. Changes to live sessions run
on the reactor thread, because Django views run in a thread pool.
"""
import hmac
import json
from datetime import datetime, timezone

from django.conf import settings
from evennia.utils.dbserialize import deserialize
from django.http import HttpResponseForbidden, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from twisted.internet import reactor, threads

from server.conf.core_auth import apply_role


def _allowed(request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    expected = settings.MUD_CONTROL_TOKEN
    return bool(expected) and hmac.compare_digest(token.encode(), expected.encode())


def guarded(view):
    @csrf_exempt
    def wrapper(request, *args, **kwargs):
        if not _allowed(request):
            return HttpResponseForbidden("not allowed")
        return view(request, *args, **kwargs)
    return wrapper


def on_reactor(fn, *args):
    """Run fn in the reactor thread and wait for it (a no-op wrapper when already there, e.g. in tests)."""
    if not reactor.running:
        return fn(*args)
    return threads.blockingCallFromThread(reactor, fn, *args)


def _session_rows():
    from evennia import SESSION_HANDLER

    rows = []
    for sess in SESSION_HANDLER.get_sessions():
        if not sess.logged_in:
            continue
        account = sess.get_account()
        puppet = sess.get_puppet()
        rows.append({
            "account": account.username if account else None,
            "core_id": account.attributes.get("core_id") if account else None,
            "character": puppet.key if puppet else None,
            "room": puppet.location.key if puppet and puppet.location else None,
            "idle_s": int(sess.cmd_last_visible and (__import__("time").time() - sess.cmd_last_visible) or 0),
            "protocol": sess.protocol_key,
        })
    return rows


@require_http_methods(["GET"])
@guarded
def status(request):
    from evennia.accounts.models import AccountDB
    from evennia.objects.models import ObjectDB

    sessions = on_reactor(_session_rows)
    rooms = {}
    for s in sessions:
        if s["room"]:
            rooms[s["room"]] = rooms.get(s["room"], 0) + 1
    return JsonResponse({
        "name": settings.SERVERNAME,
        "sessions": sessions,
        "rooms": sorted(({"room": k, "people": v} for k, v in rooms.items()), key=lambda r: -r["people"]),
        "counts": {
            "accounts": AccountDB.objects.count(),
            "characters": ObjectDB.objects.filter(db_typeclass_path__contains="haracter").count(),
            "rooms": ObjectDB.objects.filter(db_location__isnull=True, db_destination__isnull=True).count(),
            "objects": ObjectDB.objects.count(),
        },
    })


def _disconnect(account, reason):
    from evennia import SESSION_HANDLER

    dropped = 0
    for sess in account.sessions.all():
        SESSION_HANDLER.disconnect(sess, reason=reason)
        dropped += 1
    return dropped


@require_http_methods(["POST"])
@guarded
def sync_accounts(request):
    """
    Core sends what it knows about each person: [{core_id, handle, status, role, builder}]. Accounts that
    have never played are skipped. Renames, roles and builder appointments are applied, and anyone who is
    no longer active is disconnected at once (core refuses their logins anyway).
    """
    from evennia.accounts.models import AccountDB

    people = {p["core_id"]: p for p in json.loads(request.body or b"{}").get("accounts", [])}
    report = {"renamed": 0, "roles": 0, "disconnected": 0}
    for account in AccountDB.objects.filter(db_attributes__db_key="core_id"):
        p = people.get(account.attributes.get("core_id"))
        if not p:
            continue
        if p["status"] == "deleted":
            # A deleted account takes its characters with it (docs/12); it can't sign in again anyway.
            on_reactor(_disconnect, account, "Your account was deleted.")
            _forget_notes(p["core_id"])
            for char in account.characters.all():
                char.delete()
            account.delete()
            report["deleted"] = report.get("deleted", 0) + 1
            continue
        if p["status"] != "active":
            report["disconnected"] += on_reactor(_disconnect, account, "Your account can't use the MUD right now.")
            continue
        if account.username != p["handle"]:
            account.username = p["handle"]
            account.save()
            report["renamed"] += 1
        before = sorted(account.permissions.all())
        apply_role(account, p.get("role"), p.get("builder"))
        if sorted(account.permissions.all()) != before:
            report["roles"] += 1
    return JsonResponse(report)


def _tavern_board():
    from evennia import search_tag

    found = search_tag("board:tavern", category="build")
    return found[0] if found else None


def _tavern_book():
    from evennia import search_tag

    found = search_tag("book:tavern", category="build")
    return found[0] if found else None


def _forget_notes(core_id):
    """An erased account's pinned notes and guestbook lines go with it (docs/12)."""
    from world import guestbook, noticeboard

    board, book = _tavern_board(), _tavern_book()
    return (noticeboard.remove_all_of(board, core_id) if board else 0) + (guestbook.remove_all_of(book, core_id) if book else 0)


def _sheet(c):
    """What the rest of the site may show about a character (docs/09). Not where they are (that would say
    where the person is right now) and not what they carry."""
    a = c.attributes
    return {
        "id": f"c_{c.id}",
        "name": c.key,
        "created": c.db_date_created.isoformat(),
        "level": a.get("level", 1) or 1, "xp": a.get("xp", 0) or 0,
        "hp": a.get("hp", 0) or 0, "hp_max": a.get("hp_max", 0) or 0, "coins": a.get("coins", 0) or 0,
        "abilities": {k: a.get(k, 0) or 0 for k in ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")},
    }


@require_http_methods(["GET"])
@guarded
def characters(request):
    """Every character of every site account, keyed by core id, for core's copy (docs/09)."""
    from evennia.accounts.models import AccountDB

    out = []
    for account in AccountDB.objects.filter(db_attributes__db_key="core_id"):
        core_id = account.attributes.get("core_id")
        for c in account.characters.all():
            out.append({**_sheet(c), "core_id": core_id})
    return JsonResponse({"characters": out})


def _item(obj):
    return {"name": obj.key, "desc": obj.db.desc or "", "value": obj.attributes.get("value", 0) or 0}


@require_http_methods(["POST"])
@guarded
def export(request):
    """Everything of one person's in the MUD, for their export (docs/12): each character's sheet and belongings."""
    from evennia.accounts.models import AccountDB

    core_id = json.loads(request.body or b"{}").get("core_id")
    account = AccountDB.objects.filter(db_attributes__db_key="core_id", db_attributes__db_value=core_id).first()
    if not account:
        return JsonResponse({"account": None, "characters": []})
    chars = []
    for c in account.characters.all():
        a = c.attributes
        chars.append({
            "name": c.key,
            "created": c.db_date_created.isoformat(),
            "description": a.get("desc", "") or "",
            "abilities": {k: a.get(k, 0) for k in ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")},
            "hp": a.get("hp", 0), "hp_max": a.get("hp_max", 0),
            "level": a.get("level", 1), "xp": a.get("xp", 0), "coins": a.get("coins", 0),
            "location": c.location.key if c.location else None,
            "carrying": [_item(o) for o in c.contents],
            "quests": deserialize(a.get("quests") or {}),  # Evennia hands back its own dict type; send a plain one
            "tower": deserialize(a.get("tower") or {}),  # this season's climb: stairs opened, highest floor
        })
    board = _tavern_board()
    notes = [{"text": n["text"], "pinned": datetime.fromtimestamp(n["at"], timezone.utc).isoformat(), "as": n["author"]}
             for n in (board.db.notes or []) if n["core_id"] == core_id] if board else []
    book = _tavern_book()
    signed = [{"text": e["text"], "signed": datetime.fromtimestamp(e["at"], timezone.utc).isoformat(), "as": e["author"]}
              for e in (book.db.entries or []) if e["core_id"] == core_id] if book else []
    return JsonResponse({"account": account.username, "created": account.date_joined.isoformat(), "characters": chars,
                         "noticeboard_notes": notes, "guestbook_entries": signed})


@require_http_methods(["POST"])
@guarded
def broadcast(request):
    from evennia import SESSION_HANDLER

    text = str(json.loads(request.body or b"{}").get("text", ""))[:1000]
    if not text:
        return JsonResponse({"sent": False})
    on_reactor(SESSION_HANDLER.announce_all, f"|y[Announcement]|n {text}")
    return JsonResponse({"sent": True})

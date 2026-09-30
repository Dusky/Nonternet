# Spike: Evennia for the MUD (M6, V8)

Run 2026-09-30 against **Evennia 5.0.1** (BSD-3-Clause, Python 3.11, Django + Twisted), installed from
PyPI into a virtualenv. A stub stood in for core's auth endpoint. The spike code is not in the repo;
the backend it proved is quoted below.

## Results
| Question | Result |
|---|---|
| Can login be handed to core? | **Yes.** `Account.authenticate()` calls Django's `authenticate()`, so a custom backend in `AUTHENTICATION_BACKENDS` sees every `connect <name> <password>` (telnet and web alike). The backend posts to core; on success it finds or creates the Evennia account, gives it an unusable password, stores core's user id, and sets permissions from core's role. Wrong passwords and a reused one-use ticket were refused; a ticket and a terminal password both worked. |
| Account per user, keyed by stable id? | **Yes.** The core user id is kept on the account (`core_id` attribute); the account name is the handle. Evennia created the default character on first login (`MULTISESSION_MODE` defaults; character limits are a setting). |
| Role mapping | **Yes.** admin → `Developer`, user/trusted → `Player`, applied at each login. Builders would be a separate permission granted from core. |
| Web client protocol | WebSocket, JSON frames `["text", ["…"], {}]`, `["logged_in", …]`. With `client_options raw=true` text arrives as **Evennia markup** (`|c…|n`, `|555`, `|/`), otherwise as HTML. **Not ANSI**, so xterm.js would need a translation layer anyway. |
| Web login without typing a password | **Yes, the IRC way:** the page gets a one-use ticket from core and sends `connect <handle> <ticket>` over the WebSocket. |
| Database | SQLite by default; Django supports PostgreSQL, so it can use its own database on core's Postgres server. |
| Admin hooks | Evennia ships a REST API (`evennia/web/api`) and in-process session handling; a small token-guarded endpoint in the game dir can report sessions and room occupancy and drop a suspended person's sessions. Not built in the spike. |
| Gotchas | `DefaultAccount.create` runs Django's password validators, so `password=None` crashes: create with a random password, then `set_unusable_password()`. The launcher needs the virtualenv's `bin` on `PATH` (it runs `twistd`). First start asks for a superuser (Account #1) unless `EVENNIA_SUPERUSER_*` env vars are set. |

## The backend that worked
```python
class CoreBackend:
    def authenticate(self, request, username=None, password=None, autologin=None):
        if autologin: ...                       # the webclient's Django-session autologin
        res = post(settings.CORE_AUTH_URL, {"accountName": username, "passphrase": password})
        if not res.get("success"): return None
        account = find_by_core_id(res["user_id"]) or find_by_name(res["accountName"])
        if not account:
            account, _ = DefaultAccount.create(username=res["accountName"], password=token_urlsafe(32))
            account.set_unusable_password()
        account.attributes.add("core_id", res["user_id"])
        account.permissions.remove("Player", "Developer")
        account.permissions.add(PERMS[res["role"]])
        return account
```

## Recommendation
Evennia works for us: login through core, stable ids, role mapping and ticket-based web login are all
proven. For the shell window, render the WebSocket's raw markup ourselves into an accessible text log
(as the Chat app does with mIRC codes) rather than xterm.js; no server HTML ever reaches the shell's
origin, and screen readers get real text (V9 stays open for the BBS).

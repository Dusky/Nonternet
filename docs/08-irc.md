# 08 — IRC

With one hosted site, IRC is a single server — no linking or relays needed.

## Server (DECIDED: Ergo 2.19.1)
VERIFIED 2026-09-30 against the Ergo 2.19.1 source and manual: built-in accounts, SASL (PLAIN and
bearer tokens), an **auth-script** hook that hands every password login to an outside program, an
HTTP API (status, channel list, account registration), in-memory message history with
`CHATHISTORY`, and WebSocket listeners. It runs in its own container (`ghcr.io/ergochat/ergo:v2.19.1`).

Ergo's config is **generated from the site config** by `cli irc-config --out ircd.yaml` (a one-shot
compose service runs it before Ergo starts). Nothing in `services/irc/` names the site: the network
name, server name and allowed origins come from `site.*`. One secret, `IRC_SECRET`, is shared by core
and the generated config; core derives the auth-script token, the API token and the bot's password
from it with HMAC, so no derived value gives away another.

## Accounts
- **Nobody registers on IRC.** Ergo's own registration is off. Every SASL PLAIN login goes to
  `services/irc/auth.sh`, which posts it to core at `/internal/irc/auth` (private network only, bearer
  token). Core answers yes or no and gives the canonical handle; Ergo creates the account the first
  time (`autocreate`). Ergo never holds a copy of a password.
- **Nick is handle.** Strict nick reservation and `force-nick-equals-account`; SASL is required for
  every connection, so there are no anonymous nicks.
- **Native clients**: SASL PLAIN with the **terminal password** (`02`), set in Settings → Terminal
  password. The website password never works on IRC.
- **Web client**: the Chat app asks core for a **one-use ticket** (`POST /api/v1/irc/ticket`, valid
  60 s, only its hash is stored) and presents it as its SASL password.
- **Guests** (DECIDED 2026-09-30, Q4): IRC is for confirmed users only. Logged-out visitors and
  accounts whose email isn't confirmed can't connect; the Chat app says why.

## Keeping Ergo in step (as built)
Core runs a **bot** (`sitebot`, a reserved handle) that is an IRC operator. It keeps Ergo matching
core by **reconciling**: core works out what should be true, compares it with `irc_applied` (what it
has already told Ergo) and sends only the difference. Domain events from the bus make a pass happen
within a moment; a pass also runs every 30 s, and a **full** pass that re-sends everything (repairing
drift) runs at connect and every 6 hours. Failures are logged, shown in the console, and retried.

| Core says | Ergo gets |
|---|---|
| official channels (`irc.official_channels`, plus any an admin adds) | registered to the bot; admins get `+o` |
| each active ring | `#ring-{slug}`, topic from the ring; founder and ring ops get `+o`; dropped when the ring is archived or hidden |
| a trusted user's channel | registered to the bot; the owner gets `+q` and manages their own ops |
| suspended user | `NS SUSPEND` (disconnects every session at once) |
| renamed or deleted user | the old handle's account is suspended for the 90-day hold (`02`), then unregistered |

The bot owns every registered channel, so core stays the one place that decides who runs what.
When someone who has never connected needs a mode, the bot creates their Ergo account first (with a
random password nobody knows; they still sign in through core).

**Admins are not IRC opers** (VERIFIED: Ergo opers are fixed in its config by name and password or
certificate, not by account, so they can't follow site roles). Admins get `+o` in the official
channels and moderate IRC from the console through the bot. An operator who wants `/OPER` in a native
client can add a static oper block to the generated config by hand; it is not managed by core.

## Channels
- `#lobby` (everyone lands here; announcements go here) and `#help`, from `irc.official_channels`.
  Admins can add more official channels in the console.
- **Ring channels** `#ring-{slug}`, created automatically (`06`).
- **Trusted users may register channels** (DECIDED 2026-09-30, Q5) within `limits.trusted_channel_quota`
  (default 3, an admin setting). Names are `#` + up to 30 of `a-z 0-9 - _`; `#ring-` is kept for rings.
  Anyone can still join or start an unregistered channel.

## Web client (as built: Chat app)
A small client in the shell built on **irc-framework** (Kiwi IRC's library, MIT), over WebSocket at
`/ws/irc` (Caddy → Ergo). One connection is shared by the Chat window and page. It has a channel list
with the site's registered channels, a people list with op prefixes, scrollback from server history
(`CHATHISTORY LATEST`, 100 lines), `/me`, `/join`, `/part`, `/msg`, `/topic`, mIRC formatting
(colours are drawn toward the theme's text colour so they stay readable), links, unread and mention
badges, and per-channel mute (kept on the device). Your own lines are echoed back by the server
(`echo-message`), so history and live lines never double up.
Added in the polish phase (P4, 2026-10-02):
- **Alerts.** A mention, a highlight word or a private message goes through the site's own alerts (desktop notice and chime when the person turned them on) and adds to the browser tab's count. A muted channel still shows a badge when you are mentioned.
- **Older history.** Scrolling to the top asks for 100 more lines (`CHATHISTORY BEFORE`), keeping your place; "That is everything the server keeps" when there is no more.
- **Private chats** you opened are remembered on the device and refilled from history (`CHATHISTORY LATEST nick`) on the next visit.
- **People.** Each nick has a steady colour from the theme's readable colours. The people list opens a menu (click, Shift+F10 or the Menu key): private message, who is this, ignore; channel operators also get voice, op and kick. People who are away (`away-notify`) are dimmed and marked "(away)".
- **Ignore and highlight words** are kept on the account (`client_settings`, client `chat`; Settings, Chat; exported as `chat/client.json`). Ignoring hides a person's lines in the browser only; it is not a server-side block.
- **Commands** added: `/ignore`, `/unignore`, `/notice`, `/kick`, `/op`, `/deop`, `/voice`, `/devoice` (the server decides who may). Tab finishes nicks, `#channels` and `/commands`.
- **Pasting several lines** asks first, then sends each line on its own, spaced out (at most 10; more is pointed at a board or file).
- mIRC background colours are drawn too, mixed toward the theme's background.
Added in the everyday-apps pass (E7, 2026-10-10): a draft per conversation (kept on the device), channels and private chats in two groups with
mentions and unread first, "Start a private chat", "Start a channel" for trusted people and admins (the `POST /irc/channels` route), "Edit topic" for
channel operators, and "Find in this conversation" over the lines loaded in the window (Ergo has no history search; "Load older" pages further back).
The site's status line and away flag are **not** shown on IRC, and that is decided, not pending. VERIFIED against Ergo 2.19.1's source (`irc/handlers.go`,
`awayHandler`): `AWAY` takes only a message and changes the sending connection's own state; the operator commands are `SAJOIN`, `SANICK` and `SAMODE`, and
NickServ has no away command beyond a person's own `auto-away` setting. So showing it on IRC would mean the sync bot holding a connection per person, which it
deliberately does not. People set `/away` in the Chat app itself, which does reach IRC.

## History
**Decided (Q9, 2026-09-30):** kept for `irc.history_days` (default 30) in Ergo's persistent history, in its own
Postgres database (`ergo_history`, made by `cli irc-config` if missing; `IRC_HISTORY_DATABASE_URL` for both
`irc-config` and core). The site's registered channels and direct messages between logged-in people are
stored (`registered-channels` and `direct-messages: mandatory`, account indexing on); unregistered channels
are not. Ergo deletes what is older than `expire-time` itself. A person's **own** messages (channel and
direct, PRIVMSG and NOTICE) are in their export as `irc/messages.json`; nobody else's are. Deleting an account
has the sync bot send `HISTSERV FORGET` for every handle it had in the window, at once. `cli backup` dumps the
history database too. Core reads Ergo's tables directly (schema version 2, checked; an unknown version fails
the export rather than leaving messages out). Without a history database, history stays in Ergo's memory
and is neither exported nor backed up.
VERIFIED: Ergo 2.19 stores history in MySQL, PostgreSQL or SQLite, but only when built with those tags. The
official image (`make install`, all tags) has them; some release binaries don't, and the history tests skip
there (CI sets `REQUIRE_ERGO_HISTORY`, with the binary taken from the image).

## Presence
The bot lists who is connected every 20 s (`WHO`); `GET /api/v1/online` returns the handles, and the
console shows them. Held in core's memory (one core instance, `01`). Web, MUD and BBS presence are
not built.

## Admin console hooks (as built)
IRC tab: connected count and peak, server version and uptime, live channels with counts and topics,
who is online, add an official channel, **disconnect** someone (`KILL`), and **address bans**
(Ergo `UBAN` on an IP or network, with a duration). Account bans are site suspensions, so they live
in one place. Every action is audited. Announcements can also go to `#lobby`.
Not built: message rates, recent kicks, channel-level bans from the console.

## Operator notes
- `IRC_SECRET` (32+ characters) for core and the `irc-config` service; `IRC_HOST`/`IRC_PORT`
  (default `ergo:6667`) and `IRC_API_URL` (default `http://ergo:8089`) for core. Without
  `IRC_SECRET` chat is off and the Chat app says so.
- Native clients need TLS: set `IRC_TLS_CERT` and `IRC_TLS_KEY` for `irc-config` (for example
  Caddy's certificate for `irc.{domain}`), and it listens on `irc.public_port` (6697). Not yet run
  against a real certificate.
- Ergo's own database (`ircd.db`) is not backed up: everything in it is rebuilt from core by the next
  full pass.

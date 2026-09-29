# 08 — IRC

With one hosted site, IRC is a single server — no linking or relays needed.

## Server (PROPOSED: Ergo)
Modern single-server ircd with built-in accounts, SASL, message history and WebSocket
support (VERIFY each, plus external auth-script support for verifying passwords with core).

## Accounts
- One IRC account per user, provisioned by events; nick enforcement on (your handle is yours).
- Native clients: SASL PLAIN with terminal password.
- Web client: SASL with a short-lived token from core.
- Guests: OPEN — allow guest nicks in `#lobby` only, or require an account.

## Channels
- `#lobby` (auto-join), `#help`, admin-created official channels.
- **Ring channels** created automatically: `#ring-{slug}`; ring ops are channel ops.
- Trusted users may register other channels (OPEN; PROPOSED yes, within quota).
- Admins are IRC opers.

## Web client (PROPOSED: build a minimal one in the shell)
Channel list, nick list, scrollback from server history, mentions → shell notifications,
`/me`, mIRC colour rendering, per-channel mute. Power users use native clients.
(Alternative: embed an existing web client — VERIFY licence/embeddability.)

## Presence
IRC presence feeds site-wide "who's online" with BBS, web and MUD.

## Admin console hooks
Live channel list with user counts, message rates, K-line/ban management, opers, recent
kicks/bans — see `11`.

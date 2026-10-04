# 14 — Core API

JSON over HTTPS under `/api/v1`. Schemas in `packages/shared`. Session cookie (shell) or
bearer token. Errors: `{ "error": { "code", "message" } }`. The admin console uses only these APIs.

## Auth & me
`POST /auth/signup` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/verify-email` · `POST /auth/confirm-email` (new email address, docs/02) · `POST /auth/resend-verification`
`POST /auth/forgot-password` (always 204) · `POST /auth/reset-password`
`GET /me` (401 when signed out) · `GET /session` (public: the same `{user}`, or `{user: null}` with a 200, so a visitor's page load is not an error; the shell uses this) · `PATCH /me` (display name, bio, theme) · `PUT /me/password` (needs the current password) — all built · `PUT /me/terminal-password` · `GET/POST/DELETE /me/ssh-keys`
`POST /me/totp/setup` · `POST /me/totp/enable` (returns the recovery codes, once) · `POST /me/totp/recovery-codes` (regenerate; needs a current code) — all built · `POST /me/totp/disable {password, totp | recovery_code}` · `POST /me/email {password, email}` (link to the new address) · `GET/POST /me/handle` (once every 90 days) — built 2026-10-03
`POST /tickets {service}` → one-time login ticket (bbs | mud)
`POST /me/export` · `GET /me/exports` · `DELETE /me` (after confirm)
Internal (BBS token): `POST /internal/bbs/signup` · `POST /internal/bbs/verify-code` · `POST /internal/bbs/resend-code` (terminal sign-up, `04`)
Admin (docs/02): `GET /admin/applications` · `POST /admin/applications/:id {decision: approve|decline, reason}` · `GET /me/application`
Admin (docs/19): `GET /admin/ops` (agent, version, waiting updates, recent jobs) · `POST /admin/ops {action: check|upgrade|restart, service?, password}` · `GET /admin/ops/:id/log`
`GET /mud/leaderboard` (the tower's highest floors this season, signed in; `18`)
`GET /me/client-settings/:client` · `PUT /me/client-settings/:client {settings}` (client `chat` or `mud`; validated, at most 256 KB; `12`)
`POST /me/import` (the zip as the body; changes nothing, returns a preview) · `POST /me/import/:id/apply {password, parts, replace_homepage}` (docs/12)
OIDC under `/oidc/*`.

## Users (public + admin)
`GET /users/:handle` (public profile) · admin: `GET /admin/users?…`, `GET /admin/users/:id`
(dossier), all built: `GET /admin/users?q=&role=&status=&before=&limit=`, `GET /admin/users/:id` (basic dossier), `GET /admin/invites`, `POST /admin/invites`, `POST /admin/users/:id/role`, `/suspend`, `/unsuspend`,
`GET|POST /admin/users/:id/ops`, `DELETE /admin/users/:id/ops/:opId`. `POST /admin/users/:id/rename` (built). Still to build: `/logout-all`,
`/quota`, `/notes`. Role, suspend and op calls need a `reason` (3–500 characters) and are audited.

## Boards
Settings (built): `GET /admin/settings`, `PUT /admin/settings/:key {value, reason, confirm}` (a risky one answers `{pending, current, next, impact}` until `confirm` is true; `value: null` returns to the file's value), `GET /admin/settings/:key/history`, `POST /admin/settings/:key/rollback {version, reason}`. Announcements: public `GET /announcements`; admin `GET|POST /admin/announcements`, `DELETE /admin/announcements/:id`.
Ownership (built): `POST /me/export`, `GET /me/exports`, `GET /me/exports/:id/download`, `POST /me/delete`, admin `POST /admin/users/:id/delete`. Event `user.deleted`.
Custom domains (built): `GET|POST /homes/me/domains`, `POST /homes/me/domains/:domain/verify`, `DELETE /homes/me/domains/:domain`; internal `GET /internal/tls-ask?domain=&secret=`.
Rings (built): `GET /rings?tag=&q=&sort=newest|active|name`, `GET /rings/random`, `POST /rings`, `GET|PATCH /rings/:slug`, `POST /rings/:slug/{join,leave,invites,transfer}`, `GET /rings/:slug/members?status=`, `POST /rings/:slug/members/:userId/{approve,remove,ban,unban}`, `PUT /rings/:slug/order`, `POST /rings/:slug/ops`, `DELETE /rings/:slug/ops/:opId`, `GET /rings/:slug/snippet?style=`; public nav `GET /ring/:slug/{nav.js,next,prev,random,list}` and `GET /widgets/ring/:slug/nav?member=`; admin `GET /admin/rings`, `POST /admin/rings/:id/{hide,restore}`. Events: `ring.created`, `ring.member_changed`.
Homepages (built): `GET /homes/me`, `PATCH /homes/me`, `PUT|GET|DELETE /homes/me/file?path=`, `POST /homes/me/{folders,move,template,assets}`, `GET /homes/{templates,assets,assets/:id,me/snippets}`, guestbook `GET /homes/me/guestbook`, `PATCH /homes/me/guestbook/:id`, `POST /homes/:handle/guestbook`; public directory `GET /homepages`, `GET /homepages/random`; public widget API `GET|POST /widgets/:handle/{guestbook,counter,hit,status}` (CORS open, no session) and scripts at `/widgets/{name}.js`; reports take `{post_id}`, `{homepage}` or `{guestbook_entry}`; admin `GET /admin/homepages`, `POST /admin/homepages/:id/{hide,restore}`, `POST /admin/guestbook/:id/hide`.
Moderation (built): `POST /mod-actions {action, post_id, reason, to_board?}` (hide, unhide, remove, lock, unlock, move), `POST /mod-actions/:id/undo`, `GET /modlog?board=&before=`, `POST /reports`, `GET /reports?status=&before=`, `POST /reports/:id/resolve`, `GET|POST /boards/:slug/ops`, `DELETE /boards/:slug/ops/:opId`. Event: `mod.action`.
Notifications (built): `GET /notifications?before=&limit=` (with the unread count), `GET /notifications/count`, `POST /notifications/read {ids}` or `{all: true}`.
Built (M2): everything below except `PATCH` of ring boards, plus `PUT|DELETE /boards/:slug/watch`,
`GET|POST /boards/:slug/members`, `DELETE /boards/:slug/members/:userId` (private boards),
`POST /admin/board-categories`, and `read-pointer` takes `{post_id}` or `{all: true}`. Thread lists page
with `before=<last_seq>`, threads with `after=<seq>`, search with `offset`. Events: `board.created`,
`post.created`, `post.deleted`.
`GET /boards` · `POST /boards` (trusted+) · `GET/PATCH /boards/:slug`
`GET /boards/:slug/threads?cursor=` · `GET /boards/:slug/threads/:id`
`POST /boards/:slug/posts {subject, body, reply_to?}` · `POST /boards/:slug/posts/preview`
`DELETE /posts/:id` · `PUT /boards/:slug/read-pointer` · `GET /search?q=&board=`

## Rings
`GET /rings?tag=&sort=` · `POST /rings` (trusted+) · `GET/PATCH /rings/:slug`
`POST /rings/:slug/join` · `POST /rings/:slug/leave`
`GET /rings/:slug/members` · `POST /rings/:slug/members/:userId/{approve|remove|ban}`
`POST /rings/:slug/ops` · Nav: `GET /ring/:slug/nav.js`, `GET /ring/:slug/{next|prev|random|list}?from=`

## Homepages
`GET /homes?sort=&ring=` · `GET/PATCH /homes/me` · `GET/PUT/DELETE /homes/me/files/*path`
`POST /homes/me/domains` · `POST /homes/me/domains/:domain/verify` · `DELETE …`
Guestbook: `GET/POST /homes/:handle/guestbook`, `PATCH /homes/me/guestbook/:id`
Widgets: `GET /w/counter/:handle.svg`, `GET /w/guestbook/:handle`, `GET /w/online/:handle.svg`
Caddy on-demand TLS check: `GET /internal/tls-allowed?domain=`

Landing (`10`, design pass): `GET /landing` (public, cached 30 s): `{ online, threads, rings, homepages }`, where `online` is a count only and every item is already public. `GET /online` rows carry the person's stable `id`.

## Moderation
`POST /reports` · `GET /reports?scope=` · `POST /reports/:id/resolve`
`POST /mod-actions` · `POST /mod-actions/:id/undo` · `GET /modlog?board=&ring=`

## Admin
`GET /admin/status` (tiles) · `GET /admin/metrics?metric=&from=&to=&step=`
`GET /admin/audit?actor=&target_type=&target_id=&action=&origin=&from=&to=&before=&limit=` · `GET /admin/audit/object/:type/:id` — each entry also carries `target_label` (a person's current handle, a board's or ring's name, or "Deleted user") and `target_slug` (boards and rings), looked up when read; the log itself keeps ids
(built: newest first, `?before=` paging with `next_before`, `action=user.*` matches a family)
`GET/PATCH /admin/settings` · `GET /admin/settings/:key/history` · `POST /admin/settings/:key/rollback`
`GET/POST /admin/announcements` · `GET /admin/services/:name` · `GET /admin/jobs`
IRC (`08`): `POST /irc/ticket` · `GET|POST /irc/channels` · `POST /irc/channels/remove` · `GET /online` · `GET|PUT /me/terminal-password` · `POST /me/terminal-password/remove` · `GET /admin/irc` · `POST /admin/irc/channels|disconnect|sync` · `GET|POST /admin/irc/bans` · `POST /admin/irc/bans/remove` · `POST /admin/users/:id/terminal-password/remove` · private: `POST /internal/irc/auth` (Ergo's auth-script, bearer token) · `GET /legal/:slug` · `POST /legal/requests` (public) · `GET|PUT /admin/legal/pages[/:slug]` · `GET /admin/legal/requests` · `POST /admin/legal/requests/:id/resolve` · `POST /admin/backups` · `POST /admin/console {command}` (parses to the calls above)

## OIDC provider (built)
`/oidc/*` is served by the provider itself: `/.well-known/openid-configuration`, `/auth`, `/token`, `/me`,
`/jwks`, `/token/introspection`, `/token/revocation`, `/session/end`. Browser sign-in is completed by
`GET /api/v1/oidc/interaction/:uid` (redirects to the site login when there is no session). These paths
are exempt from the browser Origin check because services call them with their own credentials.
Details and guarantees are in `02`.

Live (`10`, M9): `GET /events` is a server-sent event stream for the signed-in person (private; a visitor gets 401). Events are hints with no content: `notifications`, `mail {thread?}`, `board {slug, thread}`, `announcements`, `presence`. The tab refetches what a hint names, so the usual access checks run then. A hint that names a board goes only to people who may read it (a private board's only to its members, a members-only board's only to confirmed people). A heartbeat comment goes out every 25 s and the stream ends when the session does. At most 5 streams per person; the oldest is closed. One core process holds the connections, like presence.

## Realtime
`GET /events` (SSE or WebSocket): presence, notifications, new posts in watched boards,
admin status/metric updates for admins.

## Internal event bus (Redis streams)
Built. A change and its event are written in **one database transaction** (the `events_outbox`
table), so a crash can't commit one without the other. A relay in core publishes outbox rows to
the Redis stream `events`, oldest first, and several cores can run a relay at once. Delivery is
**at-least-once**, so consumers must be idempotent: skip an event `id` already handled, and use
`role_rev` to ignore a role or ops change older than one already applied. Published rows are kept
a week, then pruned. With no `REDIS_URL`, events wait in the outbox and nothing is lost.

Envelope: `{ id: "e_…", type, at, payload }`. Schemas are in `packages/shared/src/events.ts`.

| Type | Payload |
|---|---|
| `user.created` | `user_id, handle, role` |
| `user.role_changed` | `user_id, role, previous_role, role_rev` |
| `user.ops_changed` | `user_id, ops[], role_rev` (the full list after the change) |
| `user.suspended` / `user.unsuspended` | `user_id` |
| `session.revoked` | `user_id, session_id?, reason` (no `session_id` means every session; also sent when OIDC grants are revoked) |

Consumers read with a **consumer group** (each group sees every event once; consumers in a group
share the work). A new group starts from new events, or from the beginning if asked. An event
whose handler fails is retried after a minute, and after 5 failed tries it moves to the stream
`events:dead` so one bad event can't block or spin forever.

IRC (M5) consumes events with the group `irc-sync`, and the MUD sync (M6) with `mud-sync`; neither publishes any.

Mail (`10`, M7): `GET|POST /mail` · `GET /mail/unread` · `GET /mail/:id` · `POST /mail/:id/messages` · `POST /mail/:id/people` ·
`POST /mail/:id/leave` · `DELETE /mail/:id/messages/:mid` · `POST /mail/:id/messages/:mid/report` · blocks: `GET|POST /me/blocks` · `POST /me/blocks/remove`.
Reports gain the target type `mail_message`.

File areas (`05`, M7): `GET /files` · `GET /files/areas/:slug` · `POST /files/areas/:slug/files?name=&title=&description=` (raw body) ·
`GET /files/:id` · `GET /files/:id/download` · `PATCH|DELETE /files/:id` · `POST /files/:id/report` · `GET /me/files` · admin: `POST /admin/files/areas` ·
`PATCH /admin/files/areas/:slug` · `POST /admin/files/:id/hide|unhide`. Reports gain the target type `file`.

BBS (`04`, M8): `GET /me/qwk` · `POST /me/qwk/packet` (the .QWK) · `POST /me/qwk/reply` (the .REP as the body) · `GET /bbs/motd` · `GET /admin/bbs` · `POST /admin/bbs/disconnect` · `GET /boards/:slug/new?after=` (new posts after the read pointer) · `POST /bbs/ticket` · `GET /bbs/last-callers` · `GET /online` (web, chat and BBS) · `GET|POST /me/ssh-keys` · `DELETE /me/ssh-keys/:id` ·
private, BBS → core (token from `BBS_SECRET`): `POST /internal/bbs/login`, `/login-key`, `/has-keys`, `/logout`, `/nodes`.

Console (`11`, M7): `GET /admin/stats?days=&weeks=` · `GET /admin/stats.csv?kind=days|cohorts|heatmap` · `GET /admin/console/commands` ·
`POST /admin/console {command}`.

Vouching (`03`, M7): `GET /me/vouches` · `POST /vouches` · `POST /vouches/withdraw` · admin: `GET /admin/vouches` ·
`POST /admin/vouches/:userId/confirm` · `POST /admin/vouches/:userId/decline`. The dossier gains `vouching`.

MUD (`09`): `GET /users/:handle` (public profile with characters) · `GET /me/characters` · `PUT /me/featured-character` ·
private, MUD → core: `POST /internal/mud/characters-changed` · `POST /internal/mud/audit` (a builder removed a note or guestbook line; writes the audit row) · `POST /mud/ticket` · `GET /admin/mud` · `GET|POST /admin/mud/builders` · `POST /admin/mud/builders/remove` ·
private, core → MUD (control token): `GET /internal/status`, `POST /internal/accounts/sync`, `POST /internal/broadcast`,
`POST /internal/export` · private, MUD → core (auth token): `POST /internal/mud/auth`. Announcements take `irc` and `mud` flags.

Built since: `user.renamed`, `user.deleted`, `board.created`, `ring.created`, `ring.member_changed`. Planned, not built yet: `bbs.*`, `irc.*`, `mud.*`,
`presence.changed`, `export.*`, `settings.changed`.

## Personal touches (M9-D)
All need a signed-in, confirmed person. `GET /me/personal` (status, away, avatar?, last-seen switch, digest, per-kind choices,
muted boards). `PATCH /me` also takes `status_line`, `away`, `show_last_seen`, `email_digest`. `PUT /me/notification-prefs`
`{kind, enabled}`. `PUT|DELETE /boards/:slug/mute`, `PUT|DELETE /mail/:id/mute`. `PUT /me/avatar` (image bytes),
`DELETE /me/avatar`, `GET /avatars`, `GET /avatars/:id`, admin `DELETE /admin/users/:id/avatar` `{reason}` (audited as
`user.avatar_removed`). `GET /people?q=&role=&offset=`. `GET /users/:handle` gains `status_line`, `away`, `last_seen`,
`homepage`, `recent_posts`. `GET /mail` threads gain `muted`. `GET /mail?q=&unread=1&before=<thread id>&limit=` (limit 1–50, default 30) returns `{threads, unread, next}`: `q` matches subject, people and the latest message you can see; `unread` is the whole-inbox count; `next` is the cursor for the following page. `GET /mail/:id` gains `muted`.

## BBS classics (M9-E)
`GET|POST /oneliners`, `DELETE /oneliners/:id`, admin `POST /admin/oneliners/:id/hide|unhide {reason}`. `GET /bulletins`, `GET /bulletins/:number`
(marks read), admin `POST /admin/bulletins`, `PATCH /admin/bulletins/:number`, `POST /admin/bulletins/:number/hide {reason}`. `GET|POST /polls`,
`GET /polls/:id`, `POST /polls/:id/vote {option_id}`, admin `POST /admin/polls/:id/hide {reason}`. All need a signed-in, confirmed person.
Live hint `classics`.

## Homepage toys (M9-E2)
Public: `GET /widgets/button.svg|png?text=&fg=&bg=`, `GET /rings/:slug/banners`, `GET /rings/:slug/banner/:kind`. Signed in: `POST /homes/:handle/guestbook-ticket {return_to}` → `{redirect}`;
the widget guestbook `POST` also takes `ticket`. Ring ops/admins: `PUT|DELETE /rings/:slug/banner/:kind` (image bytes), `POST /rings/:slug/banner/:kind/hide|restore {reason}`.

## Installable apps (2026-10-04, docs/10)
All need a session. The data routes are what the shell's bridge calls on an app's behalf; an app never calls the API itself (it has no network).
- `GET /api/v1/apps`: apps the site offers, with `installed` and `has_data` for the caller, and each app's `url` on the homes origin.
- `GET /api/v1/me/apps`: the caller's added apps (still offered).
- `PUT /api/v1/me/apps/{id}`: add. `DELETE /api/v1/me/apps/{id}`: remove, keeping data. `DELETE /api/v1/me/apps/{id}/data`: delete what it kept.
- `GET /api/v1/me/apps/{id}/data/{collection}`, `PUT|DELETE /api/v1/me/apps/{id}/data/{collection}/{doc}` (`{ data }`). Refused unless the app is offered, added, and asked for `storage`. 64 KB per document, 5 MB per app per person (`413 too_large`), 120 writes a minute.
- Admin: `GET /api/v1/admin/apps` (with `people` and `present`), `PUT /api/v1/admin/apps/{id}` `{ offered }` (audited).

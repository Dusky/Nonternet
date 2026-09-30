# 14 — Core API

JSON over HTTPS under `/api/v1`. Schemas in `packages/shared`. Session cookie (shell) or
bearer token. Errors: `{ "error": { "code", "message" } }`. The admin console uses only these APIs.

## Auth & me
`POST /auth/signup` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/verify-email` · `POST /auth/resend-verification`
`POST /auth/forgot-password` (always 204) · `POST /auth/reset-password`
`GET /me` · `PATCH /me` (display name, bio, theme) · `PUT /me/password` (needs the current password) — all built · `PUT /me/terminal-password` · `GET/POST/DELETE /me/ssh-keys`
`POST /me/totp/setup` · `POST /me/totp/enable` (returns the recovery codes, once) · `POST /me/totp/recovery-codes` (regenerate; needs a current code) — all built
`POST /tickets {service}` → one-time login ticket (bbs | mud)
`POST /me/export` · `GET /me/exports` · `DELETE /me` (after confirm)
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

## Moderation
`POST /reports` · `GET /reports?scope=` · `POST /reports/:id/resolve`
`POST /mod-actions` · `POST /mod-actions/:id/undo` · `GET /modlog?board=&ring=`

## Admin
`GET /admin/status` (tiles) · `GET /admin/metrics?metric=&from=&to=&step=`
`GET /admin/audit?actor=&target_type=&target_id=&action=&origin=&from=&to=&before=&limit=` · `GET /admin/audit/object/:type/:id`
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

IRC (M5) consumes events with the group `irc-sync` and does not publish any.

Built since: `user.renamed`, `user.deleted`, `board.created`, `ring.created`, `ring.member_changed`. Planned, not built yet: `bbs.*`, `irc.*`, `mud.*`,
`presence.changed`, `export.*`, `settings.changed`.

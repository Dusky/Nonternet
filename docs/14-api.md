# 14 — Core API

JSON over HTTPS under `/api/v1`. Schemas in `packages/shared`. Session cookie (shell) or
bearer token. Errors: `{ "error": { "code", "message" } }`. The admin console uses only these APIs.

## Auth & me
`POST /auth/signup` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/verify-email` · `POST /auth/resend-verification`
`POST /auth/forgot-password` (always 204) · `POST /auth/reset-password`
`GET /me` (built) · `PATCH /me` · `PUT /me/password` · `PUT /me/terminal-password` · `GET/POST/DELETE /me/ssh-keys`
`POST /me/totp/setup` · `POST /me/totp/enable` (returns the recovery codes, once) · `POST /me/totp/recovery-codes` (regenerate; needs a current code) — all built
`POST /tickets {service}` → one-time login ticket (bbs | mud)
`POST /me/export` · `GET /me/exports` · `DELETE /me` (after confirm)
OIDC under `/oidc/*`.

## Users (public + admin)
`GET /users/:handle` (public profile) · admin: `GET /admin/users?…`, `GET /admin/users/:id`
(dossier), `POST /admin/invites` (built), `POST /admin/users/:id/role`, `/ops`, `/suspend`, `/unsuspend`, `/rename`,
`/logout-all`, `/quota`, `/notes`.

## Boards
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
`GET /admin/audit?actor=&target=&action=&from=&to=` · `GET /admin/audit/object/:type/:id`
`GET/PATCH /admin/settings` · `GET /admin/settings/:key/history` · `POST /admin/settings/:key/rollback`
`GET/POST /admin/announcements` · `GET /admin/services/:name` · `GET /admin/jobs`
`POST /admin/backups` · `POST /admin/console {command}` (parses to the calls above)

## Realtime
`GET /events` (SSE or WebSocket): presence, notifications, new posts in watched boards,
admin status/metric updates for admins.

## Internal event bus (Redis streams)
`user.created|role_changed|ops_changed|suspended|renamed|deleted`, `session.revoked`,
`board.created|updated|archived`, `ring.created|updated|member_joined|member_left`,
`board.post.created|hidden|deleted`, `bbs.user.login|logout` (BBS milestone), `irc.*`, `mud.*`, `presence.changed`,
`export.requested|ready`, `settings.changed`. At-least-once; consumers idempotent.

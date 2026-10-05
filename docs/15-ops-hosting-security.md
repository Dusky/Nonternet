# 15 — Ops, Hosting & Security

The site is hosted by its admins (DECIDED). This doc covers running it well.

## Deployment
- `docker compose` on one server to start (PROPOSED: 4 vCPU / 8 GB RAM / 160 GB+ disk as a
  starting point; measure).
- **As built:** `deploy/compose.yaml` (local) with `deploy/compose.prod.yaml` laid over it for production, driven by
  `deploy/sitectl` (`doctor`, `up`, `backup`, `restore-test`, `upgrade`, `tls-reload` (was `irc-reload`), `gemini-fingerprint`, `create-admin`, `logs`,
  `ps`). Configs are rendered at start-up from the site config (Ergo by `cli irc-config`; the BBS and MUD read
  it directly), so there is no separate render step. Step-by-step: `19-operating.md`.

```yaml
site:
  name: Nonternet            # placeholder — change freely
  short_name: nonternet
  domain: example.net
  homes_domain: example-homes.net
signup: { mode: invite, require_email: true }
limits:
  homepage_quota_mb: { user: 50, trusted: 100 }
  trusted_board_quota: 3
  trusted_ring_quota: 2
services: { bbs: false, irc: true, mud: false }   # each turns on as its milestone ships;
                                                    # bbs later takes { telnet: true, ssh: true }
```
DB-backed versioned settings (`11`) override runtime keys; `site.*` only via config + deploy.

### Environment (core)
| Variable | Purpose |
|---|---|
| `SITE_CONFIG` | path to the site config (required) |
| `DATABASE_URL` | Postgres connection string (required); migrations run at startup |
| `APP_SECRET_KEY` | 32 random bytes, base64 (required). Encrypts TOTP secrets and keys IP hashes. Back it up with the database |
| `REDIS_URL` | the event bus. Optional: without it, events are kept in the database outbox and published once it is set |
| `OIDC_SECRET_<CLIENT_ID>` | one per confidential OIDC client in the site config, at least 32 characters, e.g. `OIDC_SECRET_MUD_SERVER` |
| `PUBLIC_URL` | base of emailed links; default `https://{site.domain}` |
| `SMTP_URL`, `MAIL_FROM` | outgoing mail. Without `SMTP_URL`, mail is written to the log |
| `TRUST_PROXY=1` | set when core is behind Caddy, so client addresses are read correctly |
| `NODE_ENV` | `production` drops the localhost origins that development allows |
| `MIGRATION_DATABASE_URL` | the database owner, for migrations (and backups); with it, `DATABASE_URL` can be a lesser role |
| `DB_RUNTIME_ROLE`, `DB_RUNTIME_PASSWORD` | the role core runs as: made if missing, granted everything except changing the audit log |
| `IRC_HISTORY_DATABASE_URL` | Ergo's chat history database, read for exports and dumped by backups (Q9) |
| `BBS_SECRET` | shared with the BBS (32+ characters); turns it on |
| `APPS_DIR` | installable app packages, one folder per app with its `manifest.json` (docs/10); default `./data/apps`, `/app/apps` in the image. Core reads it at start to update the catalog; the homes server serves from it |

## Hosting costs & quotas
- Budget drivers: homepage storage, bandwidth, backups, email sending.
- Enforce quotas everywhere (homepages, uploads, exports, posts/min).
- OPEN: funding model — free only, free + optional supporter tier (extra quota, badge), donations.

## Legal & abuse (hosting other people's content)
Not legal advice — get proper advice for your jurisdiction. Plan for:
- Terms of service, privacy policy, acceptable use policy, visible at signup.
- A takedown/copyright process and contact address (e.g. DMCA agent registration in the US).
- Handling illegal content, including mandatory reporting obligations for child sexual abuse
  material where they apply; admin tooling to preserve evidence and remove content fast.
- Minimum age: DECIDED — a configurable tick-box at signup (see `02`); legal advice still needed on the right number for your jurisdiction.

**As built (M4):** four pages (`terms`, `privacy`, `acceptable-use`, `takedown`) served at `/legal/:slug`, editable by admins in the console's Legal tab; every save is a version with a reason and an audit entry. Until edited, each shows built-in placeholder text with a notice saying it is placeholder text. The content is not legal advice and must be replaced. The takedown page carries a public form (`POST /api/v1/legal/requests`, signed-out allowed, 5/hour/IP, good-faith statement required); requests appear in the Legal tab for an admin to mark acted-on or declined with a note, both audited. Preserving evidence and mandatory reporting workflows are not built; decide them with counsel.
- Data protection: export and deletion (`12`), hashed IPs, retention periods documented.

## IRC (as built, M5)
Set `BBS_SECRET` (32+ characters) in `deploy/.env` for the BBS (docs/04); compose passes it to core and the `bbs` service,
which publishes telnet on 2323 and SSH on 2222 locally (23 and 22 in production). Back up the `bbs-data` volume: it holds the SSH host key.

Set `IRC_SECRET` (32+ characters, `openssl rand -base64 32`) in `deploy/.env`; compose passes it to core
and to the one-shot `irc-config` service, which writes Ergo's config into the `ircd-data` volume before
Ergo starts. Caddy sends `/ws/irc` to Ergo's WebSocket listener; core reaches Ergo's plain listener and
HTTP API on the private network only. For native clients, give `irc-config` `IRC_TLS_CERT` and
`IRC_TLS_KEY` and publish `irc.public_port` (6697). IRC history lives in Ergo's memory; `ircd.db` is not
backed up because core rebuilds it (`08`).

## MUD (as built, M6)
Set `MUD_SECRET` (32+ characters) in `deploy/.env`; compose passes it to core and the `mud` service. The MUD
(Evennia, `services/mud/Dockerfile`) keeps its world in its own Postgres database, `mud`, which it creates on
first start. Caddy sends only `/ws/mud` to it; its internal web server (core's control API) is private. Telnet
for native clients is published on `mud.public_port` (4000). Caddy has a fixed address on the compose network
(172.30.0.10) passed as `MUD_UPSTREAM_IPS`, because Evennia only trusts forwarded client addresses from exact
proxy addresses; without it every web player would share one address for login throttling. Core has
`MUD_DATABASE_URL` too, so `cli backup` dumps the world with everything else and `cli restore-test` restores it
and checks its counts. Not yet run against a real deployment.

## Backups
Nightly: pg_dump, homes, MUD data (once it exists), config, keys. Encrypted, off-site copy, 30 days retention (PROPOSED). Monthly automated
**restore test** to a scratch environment, result shown in the admin console.

**As built:** the operator runs `node cli.cjs backup --dir /backups` nightly and `node cli.cjs restore-test --dir /backups`
monthly (cron or a systemd timer on the host, `docker compose exec core ...`). A backup is a `pg_dump` custom-format dump
plus a tar of the homes directory, a tar of the file-area uploads (`FILES_DIR`, M7) and the config, streamed through AES-256-GCM with `BACKUP_KEY` (`cli backup-key` makes one),
with a manifest of hashes and row counts. The restore test decrypts the newest backup into a scratch database and compares
counts, then records the result in `backup_runs`. The console warns when there is no good backup for 26 hours or no passing
restore test for 35 days. A brand-new site is given time first: until its first account is 2 days old (backup) or 14 days old (restore test)
the console says "None yet" instead of warning (PROPOSED, `17`); a failed restore test is never excused. Copying `/backups` off-site is the operator's job (rsync/rclone). `APP_SECRET_KEY` and `BACKUP_KEY`
are deliberately not in the backups: store them separately. The core image includes `pg_dump` and `tar`.
There is no "run backup now" button; backups are run on the host.

## Upgrades
Pinned versions of Ergo and the MUD engine; integration suite must pass before bumping.
`sitectl upgrade`: backup → pull → migrate → health check → rollback instructions on failure.

## Security checklist
- Homepages on a separate origin; shell cookies host-only, Secure, HttpOnly, SameSite=Lax.
- Strict CSP on the shell; CSRF protection on state-changing requests.
- Rate limits: login, signup, posts, guestbook, ring joins, tickets, exports, custom domains.
- `RATE_LIMIT=off` turns off login and signup rate limits for the end-to-end suite. Core exits at start-up if it is set with `NODE_ENV=production`.
- Telnet is cleartext → separate terminal password; SSH encouraged; telnet can be disabled.
- Internal APIs and service hooks only on the private network with shared secrets.
- Secrets at rest (TOTP secrets, the OIDC signing keys, private keys) encrypted with `APP_SECRET_KEY`
  (from Docker secrets in production). Change it and core can no longer read them, and says so at startup.
- Audit log append-only: database triggers refuse UPDATE, DELETE and TRUNCATE for every role. In
  production also run core as a database role with INSERT and SELECT on `audit_log` only, so the
  guarantee doesn't rest on a trigger alone (set up with the production compose file, later).
- Two-factor is optional; a site can require it for admin accounts (`security.require_admin_2fa`, recommended for a public site).
- Custom domains: TXT verification before on-demand TLS; allowlist endpoint for Caddy.

### Launch review (2026-09-30)
- **Private by default:** core refuses a request with no session on every route not listed in
  `apps/core/src/public-routes.ts` (each entry says why it is public), before the route's code runs.
  `/internal/*` (service tokens), `/oidc` (client auth) and the widget API (reads no session) have their own
  checks. `security.test.ts` walks every registered route (about 200) and fails if one answers a visitor.
- **Headers:** Caddy sends HSTS (production), `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options: DENY` and the shell's CSP (`default-src 'self'`; scripts only from the site; inline styles
  allowed for the editor and terminal; the studio's preview frame may load the homes domain; nothing may frame
  the site). `vite preview` sends the same, so the end-to-end suite runs under it; a test keeps the copies equal.
- **Terminal passwords:** after 10 wrong answers in 15 minutes an account refuses terminal logins (IRC, MUD,
  BBS alike), even with the right password, until the window passes.
- **Uploads that unpack:** a REP packet is refused if its `.MSG` would unpack past 8 MB; nothing else in it is
  unpacked (zip bombs). File-area and homepage uploads are stored as sent, never unpacked.
- **No server-side fetches of user-supplied URLs** (checked): core only calls Ergo, the MUD and its own
  services. SQL is parameterised; the few interpolations are fixed fragments or validated names (checked).
- **Dependencies:** `pnpm audit --prod` is clean and runs in CI; dev-tool advisories (Vite, Vitest, esbuild)
  were fixed by upgrading.
- **WebSockets:** the Terminal and MUD windows sign in with one-use tickets, not cookies, so a foreign page
  opening them gets only a login prompt; Ergo checks the Origin of chat connections.

## Observability
Structured JSON logs; `/healthz` per service; metrics rolled up into `metrics_rollup` for the
admin console; alerting (email/webhook) on service down, disk > 80%, backup failure,
report SLA breaches.

## Exports
- `EXPORTS_DIR` (default `./data/exports`) holds finished archives for 7 days; it needs a volume and is part of what to back up only if you want exports to survive a restore (they are short-lived). The worker runs inside core.

## Homes server and custom domains
- `homes-main.cjs` runs beside core (same image, port 3100, `HOMES_DIR` volume mounted read-only). It serves `{handle}.{homes_domain}` and verified custom domains and holds no cookies. In production it sits behind Caddy on-demand TLS (`deploy/caddy/Caddyfile.prod`).
- `TLS_ASK_SECRET` (optional) is shared between core and Caddy's `ask` URL. `/internal/*` must not be reachable from outside.
- `HOMES_PUBLIC_PORT` is only for local runs where homepage addresses carry a port.

## Installable apps (built 2026-10-04, docs/10)
- **Where they run.** Packages are served by the homes server at `{homes_domain}/apps/{id}@{version}/…` from `APPS_DIR` (the core image builds `packs/apps/*` into `/app/apps`), only while the site offers the app. Never on the shell's origin.
- **Sandbox.** The shell frames an app with `sandbox="allow-scripts allow-forms"` and no `allow-same-origin`, so it has an opaque origin: no cookies, no storage, no access to the shell's page. Every app response also carries `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors {site}`, so the same holds if someone opens the address directly, and the app can't fetch anything or be framed by another site. Responses send `Access-Control-Allow-Origin: *` because a sandboxed frame's module scripts load with an opaque origin; the files are public and immutable (the address carries the version).
- **Bridge.** The app reaches the account only through the shell (`shell/AppHost.tsx`, Penpal over `postMessage`). The shell listens to that frame's window alone, then both sides use a private `MessageChannel`. Each call is checked against the manifest's permissions (`storage`, `profile:read`, `notify`), and arguments are type- and length-checked. Data routes in core check again: the app must be offered, added by this person, and have asked for storage. Limits: 64 KB per document, 5 MB per app per person, 120 writes a minute.
- **Certificates.** Caddy's `ask` now approves the bare `homes_domain` (it also carries the stable `/u/{id}/` homepage links, which could not get a certificate before). The shell's CSP allows framing `https://{homes_domain}` as well as `https://*.{homes_domain}`.
- **Known limits (first-party apps only for now).** A sandboxed frame can still navigate itself, so a hostile app could carry data out in a URL; CSP has no way to stop that. Before outside authors can publish apps (Q18), apps need review and signing, and this needs a further control (for example, no navigation permission once browsers offer one). The site's fonts are not loaded inside apps (font-src 'self' on the homes origin); apps get the theme's font names and fall back to generic families.

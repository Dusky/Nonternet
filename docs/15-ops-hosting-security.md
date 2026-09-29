# 15 — Ops, Hosting & Security

The site is hosted by its admins (DECIDED). This doc covers running it well.

## Deployment
- `docker compose` on one server to start (PROPOSED: 4 vCPU / 8 GB RAM / 160 GB+ disk as a
  starting point; measure).
- `site.yaml` + `.env` secrets → `sitectl render-config` produces Caddy, Ergo, MUD (and later BBS) configs.
- `sitectl doctor` checks DNS, TLS, ports, health; `sitectl backup|restore|upgrade`.

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
services: { bbs: false, irc: false, mud: false }   # each turns on as its milestone ships;
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
- Minimum age: OPEN (13+ with COPPA/GDPR considerations is common).
- Data protection: export and deletion (`12`), hashed IPs, retention periods documented.

## Backups
Nightly: pg_dump, homes, MUD data (once it exists), config, keys. Encrypted, off-site copy, 30 days retention (PROPOSED). Monthly automated
**restore test** to a scratch environment, result shown in the admin console.

## Upgrades
Pinned versions of Ergo and the MUD engine; integration suite must pass before bumping.
`sitectl upgrade`: backup → pull → migrate → health check → rollback instructions on failure.

## Security checklist
- Homepages on a separate origin; shell cookies host-only, Secure, HttpOnly, SameSite=Lax.
- Strict CSP on the shell; CSRF protection on state-changing requests.
- Rate limits: login, signup, posts, guestbook, ring joins, tickets, exports, custom domains.
- Telnet is cleartext → separate terminal password; SSH encouraged; telnet can be disabled.
- Internal APIs and service hooks only on the private network with shared secrets.
- Secrets at rest (TOTP secrets, the OIDC signing keys, private keys) encrypted with `APP_SECRET_KEY`
  (from Docker secrets in production). Change it and core can no longer read them, and says so at startup.
- Audit log append-only: database triggers refuse UPDATE, DELETE and TRUNCATE for every role. In
  production also run core as a database role with INSERT and SELECT on `audit_log` only, so the
  guarantee doesn't rest on a trigger alone (set up with the production compose file, later).
- Admin accounts require 2FA.
- Custom domains: TXT verification before on-demand TLS; allowlist endpoint for Caddy.

## Observability
Structured JSON logs; `/healthz` per service; metrics rolled up into `metrics_rollup` for the
admin console; alerting (email/webhook) on service down, disk > 80%, backup failure,
report SLA breaches.

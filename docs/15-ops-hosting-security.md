# 15 — Ops, Hosting & Security

The site is hosted by its admins (DECIDED). This doc covers running it well.

## Deployment
- `docker compose` on one server to start (PROPOSED: 4 vCPU / 8 GB RAM / 160 GB+ disk as a
  starting point; measure).
- `site.yaml` + `.env` secrets → `sitectl render-config` produces Enigma, Caddy, Ergo, MUD configs.
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
services: { bbs: { telnet: true, ssh: true }, irc: true, mud: false }
```
DB-backed versioned settings (`11`) override runtime keys; `site.*` only via config + deploy.

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
Nightly: pg_dump, Enigma data (SQLite backup API or brief pause), homes, MUD data, config,
keys. Encrypted, off-site copy, 30 days retention (PROPOSED). Monthly automated
**restore test** to a scratch environment, result shown in the admin console.

## Upgrades
Pinned versions of Enigma, Ergo, MUD engine; integration suite must pass before bumping.
`sitectl upgrade`: backup → pull → migrate → health check → rollback instructions on failure.

## Security checklist
- Homepages on a separate origin; shell cookies host-only, Secure, HttpOnly, SameSite=Lax.
- Strict CSP on the shell; CSRF protection on state-changing requests.
- Rate limits: login, signup, posts, guestbook, ring joins, tickets, exports, custom domains.
- Telnet is cleartext → separate terminal password; SSH encouraged; telnet can be disabled.
- Bridges and internal APIs only on the private network with shared secrets.
- Secrets at rest (TOTP, private keys) encrypted with a key from Docker secrets.
- Audit log insert-only at the DB permission level.
- Admin accounts require 2FA.
- Custom domains: TXT verification before on-demand TLS; allowlist endpoint for Caddy.

## Observability
Structured JSON logs; `/healthz` per service; metrics rolled up into `metrics_rollup` for the
admin console; alerting (email/webhook) on service down, disk > 80%, backup failure,
report SLA breaches.

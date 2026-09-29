# 07 — Homepages

Every user gets a homepage: a static site they fully control.

## v1 features
- **URL**: `https://{handle}.{homes_domain}/` (PROPOSED subdomain per user for isolation).
  Stable fallback `https://{homes_domain}/u/{user_id}/` redirects to the current handle.
- **Homepage studio** (shell app): file manager (upload, folders, rename, delete), HTML/CSS
  editor with live preview, starter templates, drag-drop uploads.
- **Asset library**: original or properly licensed classic-style GIFs — dividers, buttons,
  backgrounds, "under construction", 88×31 buttons. (VERIFY licences for any bundled assets.)
- **Widgets** (embeddable snippets served by core): guestbook, hit counter, last-updated
  stamp, online indicator, ring nav bars (`06`).
- **Directory**: recently updated, by ring, random homepage, search by title/description.
- **Quota** (PROPOSED): 50 MB per user, trusted 100 MB, file ≤ 10 MB; admin-configurable per user.
- **Custom domains** (DECIDED as ownership feature): user adds `mydomain.com`, sets a CNAME/A
  record, core verifies via TXT record, Caddy issues TLS on demand. Their URL outlives the account.

## Guestbooks
Sign with name/URL/message; logged-in users auto-filled; page owner can hide entries;
reportable; rate-limited; optional owner approval before showing.

## Security (critical)
- Homepages served from `homes_domain`, a different origin from the shell (PROPOSED separate
  registrable domain). Shell cookies are host-only on `site.domain`.
- Per-user subdomains isolate users from each other.
- **JavaScript: OPEN.** PROPOSED: allowed (authentic), given origin isolation and a CSP that
  blocks requests to `site.domain` API. Caddy injects a tiny footer/report link (OPEN:
  inject vs require a visible badge).
- Uploads: type sniffing, size limits, no server-side execution, `nosniff`.

## Storage
Files on a volume at `/data/homes/{user_id}/` (keyed by ID, not handle). core stores metadata:
title, description, size, last_updated, custom domain, hidden flag. PROPOSED later: WebDAV
or SFTP with terminal password; git push deploys.

## Acceptance tests
- New user picks a template → live page within 2 minutes.
- Homepage JS cannot read shell cookies or call the shell API as the viewer.
- Rename handle → old subdomain redirects for 90 days.
- Custom domain verifies and serves over HTTPS.

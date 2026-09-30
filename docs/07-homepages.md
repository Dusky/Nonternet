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
- **JavaScript: DECIDED (2026-09-30): allowed**, made safe by origin isolation rather than by
  blocking it: pages run on their own subdomain of `homes_domain`, which has no cookies of ours, and
  the API is not readable cross-origin (no CORS on it, cookies are `SameSite=Lax`, and state-changing
  calls must come from a known origin). The homes server injects a small fixed "Report this page"
  link into every HTML page (DECIDED, same day).
- Uploads: type sniffing, size limits, no server-side execution, `nosniff`.

## Storage
Files on a volume at `/data/homes/{user_id}/` (keyed by ID, not handle). core stores metadata:
title, description, size, last_updated, custom domain, hidden flag. PROPOSED later: WebDAV
or SFTP with terminal password; git push deploys.

## As built (M3, part 1: files and serving)
- **Two processes, one image.** `main.cjs` is core (accounts, API, studio). `homes-main.cjs` is the
  homes server: it only reads files and the database, sets no cookies, and is meant to sit behind its
  own hostnames (`*.homes_domain`). Files are under `HOMES_DIR/{user_id}/`.
- **Files:** an allowlist of types (`MIME` in `homes/files.ts`), names of letters, digits and
  `_ . ~ ( ) + -` (no spaces, no leading dot), 7 folders deep, 500 files, `homepage_file_max_mb`
  (10) per file, quota per role (50 or 100 MB). One change at a time per person, so uploads made at the
  same moment cannot pass the quota together. Writes go to a temporary file and are renamed.
  Symbolic links are never followed or listed.
- **Upload API:** `PUT /homes/me/file?path=` with the file itself as the body (no multipart).
- **Serving:** `{handle}.{homes_domain}`; folders serve `index.html` (and get a trailing-slash
  redirect); the person's own `404.html` is used if they have one; ranges and conditional requests work
  (`send`); every response has `nosniff` and a `frame-ancestors` policy that lets only the site frame it;
  every HTML page gets the report link. Hidden pages give 410, suspended or deleted people 404.
  `{homes_domain}/u/{user_id}/` redirects to the current handle. Old handles redirect for 90 days
  (`handle_history`, filled by the future rename call).
- Per-user quota overrides (docs say admin-configurable) are not built; the role quotas are.

## Acceptance tests
- New user picks a template → live page within 2 minutes.
- Homepage JS cannot read shell cookies or call the shell API as the viewer.
- Rename handle → old subdomain redirects for 90 days.
- Custom domain verifies and serves over HTTPS.

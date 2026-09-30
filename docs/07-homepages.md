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
- **Studio** (`Homepage studio` app, `/studio`): pick a template (three, written for this project), then
  files (create, upload by button or drag and drop, rename or move, delete, folders), the CodeMirror
  editor with a preview of the saved page, the asset library, and title and description. The preview
  frames the real homepage address, so it is exactly what visitors get.
- **Asset library:** 13 SVGs drawn for this project (dividers, five 88x31 buttons, three backgrounds, a sign) so there
  is nothing to license (V10 does not apply to them). Adding one copies it into the person's own
  `assets/` folder, so it is theirs and will be in their export. Classic animated GIFs are not included.
- **Isolation is tested in a real browser:** a script on a homepage sees no cookies, cannot read the
  shell API, and a forged cross-site logout does not sign the visitor out (`studio.spec.ts`).
- **Widgets** are scripts a person pastes in (the studio's Widgets tab has the lines to copy):
  `guestbook.js`, `counter.js`, `updated.js`, `online.js`, each with `data-user="{handle}"`. They run on the
  homepage's origin and use the public widget API (`/api/v1/widgets/{handle}/…`), which answers any
  site (`Access-Control-Allow-Origin: *`, no credentials), never looks at a session, and is exempt from
  the origin check for that reason. Scripts build their output with `textContent` only (a test refuses
  `innerHTML`), so nothing a visitor types becomes markup.
- **Guestbook:** anyone can sign from the widget (name, optional http(s) address, message up to 500
  characters), with a hidden field that quietly drops bots and 5 signings per address per hour. Signing
  from the site (`/homepages/guestbook/{handle}`) while logged in uses the account's own name. The owner
  chooses open, approval or closed, approves or hides entries in the studio, and entries can be reported.
- **Counter:** one count per visitor per day (hashed address and browser), total kept apart from the daily records.
  **Online** means seen on the site in the last 5 minutes (PROPOSED until real presence exists).
- **Directory** (`Homepages` app, `/homepages`, public): recently updated or by name, search of title,
  description and handle, and a random page. Pages without a front page, hidden pages and suspended people are left out.
- **Reporting:** the footer's link goes to `/report/homepage/{handle}` (login first). Reports about pages and
  guestbook entries go to admins only; hiding a page or entry closes them. Admins hide and restore pages
  from the console (Homepages tab) with a reason, audited as `homepage.hidden` and `homepage.restored`.
- Not built yet: a "sign with your account" autofill inside the widget itself (it is on the site page),
  and the ring nav bar widget (with rings).
- **Custom domains** (`Domains` tab in the studio): add a name (up to `homes.max_domains`, 3), put a TXT record at
  `_home-verify.{name}` with `home-verify={token}` in DNS, and point the name at the homes server (a CNAME to
  `{handle}.{homes_domain}`, or an A record to `homes.public_ip` for a bare domain). "Check now" looks the TXT up. Only a
  verified name is served or given a certificate; several people may ask for a name, and the one who proves it gets
  it (the others' requests are dropped). Each name (with and without `www`) is added and verified on its own.
  Caddy asks `GET /internal/tls-ask?domain=` (never routed by the front door; optional `TLS_ASK_SECRET`) before it
  issues a certificate: 200 only for a real person's homepage name or a verified custom domain. `deploy/caddy/Caddyfile.prod`
  has the on-demand TLS setup; it has **not** been run against a real domain (V11 stays open until it is).
  A verified domain stops working when the person removes it, is suspended, or their page is hidden. Keeping a URL
  after an account is deleted is not built (account deletion arrives with the export, M4).
- Per-user quota overrides (docs say admin-configurable) are not built; the role quotas are.

## Acceptance tests
- New user picks a template → live page within 2 minutes.
- Homepage JS cannot read shell cookies or call the shell API as the viewer.
- Rename handle → old subdomain redirects for 90 days.
- Custom domain verifies and serves over HTTPS.

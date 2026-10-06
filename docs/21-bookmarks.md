# 21 — Bookmarks (personal hub)

DECIDED (owners, 2026-10-06): people save links on the site, like Linkding or Linkwarden, and the signed-in front page
works as a personal hub that can be set as the browser homepage. Each bookmark is private, public or shared into a
ring. The site keeps the link, title, description and a small icon; it does not keep a copy of the page. People save
links by typing or pasting one, with a bookmarklet, or from the phone's Share menu.

## Why built in
Bookmarks are the person's own content but can be shared, so they follow the rules for boards and posts, not apps:
they live in core's Postgres, are in the export, are removed with the account, and public ones can be reported.
Apps (`10`) are for a person's own data only.

## The hub
- Signed in, `/` already shows the home panel. It gains a "Bookmarks" section: pinned bookmarks first, then the newest.
- A person sets their browser homepage to the site's address. Nothing to build for that beyond the section above.
- The Bookmarks app has its own window and route (`/bookmarks`), like the other apps.

## What a bookmark is
`url`, `title`, `description` (plain text), `tags` (same rule as ring tags: up to 5), `pinned`, `visibility`
(`private` | `public` | `ring`) with `ring_id` when shared into a ring, `favicon` (a small WebP kept by core), `created_at`.
- **Adding:** type or paste an address. Core fetches the page once through `safe-fetch.ts` to fill in the title,
  description and icon. If the fetch fails the bookmark is still saved with the address as its title. Everything the
  fetch finds is stored as plain text, trimmed and stripped of control characters.
- **No page copies.** Nothing from the other site is stored but text and a re-encoded icon, so no third-party HTML or
  script ever sits on our origin. Page archives and readable copies are a possible later phase, kept as text only.
- **Duplicates:** saving an address you already have opens the existing bookmark. Addresses are compared after dropping
  the fragment and common tracking parameters; what is stored is what the person gave.
- **Check links:** an optional "check this link" that records whether it still answers, never automatic.
- **Only http and https** addresses. No credentials in the address (same rule as the wallpaper fetch).

## Sharing
- **Private** (default): only the owner.
- **Public:** shown on the person's profile and in `/feeds/people/{handle}/bookmarks.atom`, and readable without signing
  in. Reportable like any public content, with the existing person report path; hidden by admins with a reason.
- **Ring:** visible to members of that ring (and public rings' readers), listed on the ring page. The owner must be in
  the ring; leaving the ring turns those bookmarks back to private.
- Suspended and deleted people's public and ring bookmarks disappear with them.

## Capture
- **Add form** in the app and the command palette ("Save a link").
- **Bookmarklet:** a link in the Bookmarks app that opens `/bookmarks/add?url=…&title=…` in a small window. It only
  prefills the form; the person confirms, so a page can't save anything by itself. Signed-out visitors are sent to log in
  first and return to the form.
- **Share target:** the web app manifest (`site/manifest.webmanifest`) declares a `share_target`, so the installed site
  appears in the phone's Share menu and opens the same form.
- **Import:** the usual browser bookmarks HTML file, and a Linkding/Linkwarden JSON export if the format is stable
  (VERIFY before relying on it). **Export** is required (below).
- A browser extension is out of scope for now.

## Ownership, export, deletion
- `bookmarks.json` in the export holds every bookmark (all visibilities), with tags and ring names; favicons are not
  needed. Import restores them.
- Account deletion removes them. The export coverage test must list the new table.

## Moderation and audit
- Public and ring bookmarks can be reported (new report target kind `bookmark`, a migration on the reports check
  constraint, as for `wiki_page`). Admins and ring ops can hide one with a reason; audit `bookmark.hidden` and
  `bookmark.restored`. A person's own saving, editing and deleting is private and not audited.

## Data model (migration 0044)
`bookmarks(id, user_id, url, url_key, title, description, pinned, visibility, ring_id, favicon, checked_at, link_ok,
created_at, updated_at, hidden_at, hidden_reason)` and `bookmark_tags(bookmark_id, tag)`. Unique `(user_id, url_key)`.
Search is a generated `tsvector` over title, description, url and tags, as for posts.

## API (`/api/v1/bookmarks`)
`GET` list (filters: tag, ring, visibility, pinned, `q`), `POST` add (`{url, title?, description?, tags?, visibility?,
ring?}`), `GET/PATCH/DELETE /:id`, `POST /:id/check`, `GET /tags`, `POST /import`, `GET /public/:handle`. Limits: 20
adds a minute (the fetch is the costly part), 10,000 bookmarks per person.

## Phases
- [ ] **B1:** core: table, routes, safe-fetch of title and icon, search, limits, export, import, deletion, tests.
- [ ] **B2:** the Bookmarks app and home panel section, add form, tags, pins, bookmarklet, palette entry, e2e.
- [ ] **B3:** sharing: public on profiles and feed, ring sharing, reports and hiding, audit.
- [ ] **B4:** share target, import of browser files, link checking.

## Left open
- Page copies or archives (text-only readable copies first), and a browser extension. Not decided.

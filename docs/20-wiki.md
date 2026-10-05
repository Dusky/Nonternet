# 20 — Wiki

DECIDED (owners, 2026-10-05): one wiki for the site, plus a wiki each ring can switch on. It is built into the site
like boards, not an installable app. Trusted people and up edit it. Pages use light markup plus `[[links]]`.

## Why built in
Apps only keep each person's own data (`app_data` is keyed by user). A wiki is shared and moderated, and it needs
search. Built in, its pages live in core's Postgres like posts, and get:
- history, reports, audit, export and deletion;
- readers in the BBS, Gopher, Gemini and feeds.

## No made-up content
- Nothing is seeded or generated. An empty wiki says "This wiki has no pages yet." and offers to start the first page.
- There are no summaries and no "AI" anything.
- Interface text follows the writing rule in `10`.

## Markup
- What is stored is exactly what the person typed (after `normalizeBody`).
- `packages/shared/src/wikitext.ts` parses the text into blocks and inline pieces. The result is data, never HTML, and
  the web, the BBS, Gopher and Gemini all use the same parser.
- Blocks:
  - `#`, `##`, `###` headings;
  - `-` / `*` / `1.` lists;
  - `>` quotes;
  - triple-backtick code;
  - paragraphs.
- Inline:
  - `*em*`, `**strong**`, `` `code` ``;
  - `[text](url)` and bare URLs, but only http, https, gemini and gopher become links;
  - `[[Page name]]` and `[[Page name|shown text]]`.
- Anything that doesn't parse stays as literal text, so the raw text reads well in a terminal.
- A page name maps to a slug, ignoring case ("Getting Started" → `getting-started`). Titles keep their case.

## Rules
- **Reading:**
  - Anyone can read the site wiki, and the wiki of any ring that has one switched on.
  - A ring wiki that is switched off is a 404, except to the people who could switch it on.
  - Hidden and deleted pages show only to admins and to that wiki's ops.
- **Editing:**
  - The site wiki: trusted people and admins.
  - A ring wiki: its trusted members, its ops and admins.
  - Protected pages: admins, plus that ring's ops for a ring wiki.
  - Guests, users, suspended people and limited sessions can't edit.
- **Conflicts:**
  - A save names the revision it started from. If someone saved in between, the reply is
    `409 edit_conflict` with `details.current`.
  - The shell then shows both texts to merge by hand. Nothing is overwritten and nothing is merged automatically.
- **Limits:**
  - 100,000 characters per page;
  - titles up to 120 characters, summaries up to 200;
  - 120 edits an hour per person.
  - A save that changes nothing makes no revision.
- **History:**
  - Every save is a revision.
  - Putting an old version back makes a new revision that says so.
  - Renaming leaves the old slug as a redirect.
  - Deleting is soft and can be undone.
- **Moderation:**
  - Admins and the wiki's ops can protect, hide, delete and restore pages, and hide the text of an old revision (not
    the current one).
  - Hiding needs a reason.
  - The audit log records `wiki.page_*`, `wiki.revision_hidden`/`_shown` and `wiki.enabled`/`disabled`.
  - Reports use the target kind `wiki_page` and go to admins. Hiding or deleting a page closes its open reports.
  - Ordinary edits are public history and are not audited, like posts.
- **Live:** a save sends `{type:'wiki', wiki, slug}` to open pages.

## Where it shows
- **Web:** the Wiki app (`10`).
  - The site wiki is at `/wiki/…`, a ring's at `/wiki/r/{ring}/…`.
  - Screens: page, edit (live preview, a tab on phones, drafts kept on the device), history, compare (line diff,
    marked by text as well as colour), recent changes, all pages, wanted pages, what links here and search.
  - Ring pages get a "Wiki" link, and ops get the switch.
- **BBS** (`04`), read only: main menu key `K` (in the art pack).
  - A page is wrapped to the screen, with each wiki link shown as `text[n]` and listed at the foot. Type the number to
    follow it.
  - Also: all pages, search and recent changes.
  - A ring's wiki opens from its ring screen (`W`).
- **Gopher and Gemini** (`05`): the site wiki at `/wiki/`, `/wiki/{slug}` and `/wiki/changes`.
  - Gopher shows a page as a menu: the wrapped text, then the numbered links as menu items.
  - Gemini shows gemtext with each block's links listed after it. A link to a page that doesn't exist yet is plain
    text. An old name redirects (`31`).
- **Feeds:** `/feeds/wiki/changes.atom`, and `/feeds/wiki/rings/{ring}/changes.atom` for a ring wiki that is switched
  on. There is one entry per revision, and none for hidden or deleted pages.

## Ownership (`12`)
- **Export:** `wiki/revisions.json` (every revision the person wrote) and `wiki/pages-started.json`.
- **Account deletion:**
  - "keep": revisions stay, credited to a deleted account.
  - "erase": their revision texts are replaced. A page whose current text is theirs goes back to the latest revision by
    someone else, or is deleted if there is none.

## Code
- `apps/core/src/wiki.ts` and `routes/wiki.ts`, with migration `0042_wiki.sql`.
- `apps/shell/src/apps/wiki/`.
- `apps/bbs/src/screens/wiki.ts`.
- The wiki parts of `gopher/server.ts`, `gemini/server.ts` and `feeds.ts`.
- Tests: `wikitext.test.ts`, `wiki.test.ts`, the BBS, Gopher, Gemini and feed tests, and `e2e/tests/wiki.spec.ts`.

# 22 — Memos (private microblog)

DECIDED (owners, 2026-10-06): a feed of short posts, like Memos or a microblog, that is private by default. Built in,
not an installable app, because memos can be shared, replied to and reported.

## What a memo is
Short text (up to 2,000 characters) with `#tags` found in the text, a `pinned` flag and a `visibility`: `private` (the
default), `public` or `ring` (with `ring_id`, the owner being a member).
- **Text** is stored as typed (after `normalizeBody`) and shown through the shared light-markup parser (`wikitext.ts`,
  the safe, data-not-HTML one): emphasis, code, quotes, lists and links. Bare addresses become links; only http,
  https, gemini and gopher do.
- **Tags** are `#word` in the text (same shape as ring tags). They are indexed so a person can filter by one.
- **Editing** keeps no public history. A public memo shows "edited" with the time. Deleting is immediate and has Undo
  for a short while (the shell's undo pattern).
- **Images** are not in the first version (OPEN: if added, re-encoded like avatars, EXIF removed, same visibility as
  the memo).

## The feed and the hub
- The Memos app is a timeline: write box at the top (Ctrl+Enter posts), newest first, filter by tag or visibility,
  pins first, search.
- The signed-in home panel shows the newest few memos and a quick-write box, so the hub is also where you jot things down.
- Public memos appear on the person's profile and in `/feeds/people/{handle}/memos.atom`, readable without signing in.
- Ring memos appear on the ring page for members.

## Memos and your .plan
Memos connect the things that already overlap (the status line, `.plan`, profiles) instead of adding a fourth place to
write:
- The `.plan` text (`users.plan`, `05`) stays what it is: a short note you edit by hand.
- Your newest public memos (up to three) are shown under it everywhere the plan shows: finger, the profile, and the
  Gemini `/~handle` page. With no plan text, finger shows just the memos; with neither, "No plan." as now.
- The status line stays a one-liner and is not a memo.
- Private and ring memos never reach finger, Gemini or the profile (the mirrors read as a logged-out visitor).

## Replies and reactions (public and ring memos only)
- People who can see a memo can reply, as short memos linked to it. Replies take the visibility of the memo.
- Reactions reuse the post reactions (`reactions`).
- A private memo has neither: nobody else can see it.
- Notifications for replies and reactions use the existing notification kinds and mute rules.
- OPEN: following people (a timeline of the people you follow). Not built; boards, rings and profiles are how people
  find each other for now.

## Privacy
Private is the default, shown with a lock. Changing a memo to public asks once and can be undone. Level-A protection
applies (see `15`, "Personal content"): one visibility check on every read path, the Gopher, Gemini, BBS and feed
mirrors never show anything but public items, and a test per path proves it. Encryption beyond that is not built:
decided 2026-10-06 that the baseline is enough, with locked end-to-end encrypted memos recorded as a possible later
option (`17`).

## Ownership, export, deletion
- `memos.json` in the export holds every memo (all visibilities) with tags, replies the person wrote, and ring names.
  Import restores them. Account deletion removes them; the export coverage test lists the new tables.

## Moderation and audit
Public and ring memos and replies can be reported (new report target kind `memo`, a migration on the reports check
constraint). Admins and ring ops can hide one with a reason: audit `memo.hidden` and `memo.restored`. A person's own
writing, editing and deleting is not audited.

## Data model (migration 0045, after bookmarks' 0044)
`memos(id, user_id, body, visibility, ring_id, pinned, reply_to, body_tsv generated, created_at, edited_at, hidden_at,
hidden_reason, deleted_at)` and `memo_tags(memo_id, tag)`. Limits: 2,000 characters, 60 writes an hour, 50,000 memos per
person.

## Phases
- [x] **M1:** core: tables, routes, search, tags, limits, export, import, deletion, tests (private everywhere).

  As built:
  - Migration **0052** (bookmarks took 0044's slot), tables `memos` and `memo_tags`. Sharing, reactions and the report kind
    come in 0053 with M3.
  - `#tags` are read from the text (2 to 20 lowercase letters, digits and hyphens; up to five; none inside addresses, code
    or entities) and re-read on every edit. "Edited" is set only when the text really changes.
  - The list shows pinned memos first on the first page, then newest first by cursor. It searches the text and filters by tag.
  - Import brings every memo back **private**, keeping when it was written; replies to other people's memos can't come back.
  - Routes: `GET /memos` (`q`, `tag`, `pinned`, `before`, `limit`), `GET /memos/hub`, `GET /memos/tags`, `POST /memos`
    (60 an hour), `GET|PATCH|DELETE /memos/:id`.
- [x] **M2:** the Memos app and the home panel box, e2e.

  As built:
  - The Memos app is a built-in app (`apps/shell/src/apps/memos/`). The write box is the shared `Editor`, so it has the
    character count, Ctrl+Enter to post, and a draft kept on the device.
  - Memos render through the shared safe text renderer (`RichText`): emphasis, lists, quotes, code and links, with only http,
    https, gemini and gopher addresses clickable. `#tags` stay as typed in the text and also show as chips that filter.
  - Each memo has Pin, Edit (in place) and Delete (act now, with Undo). A lock badge says it is private.
  - The home panel has a Memos box with the same write box and the newest three. The palette has "Write a memo".
- [x] **M3:** public and ring memos, replies, reactions, feeds, profile, reports and hiding, audit; newest public memos under the plan in finger, Gemini and the profile.

  As built (migration 0053):
  - **Who can see a memo** is set when writing or editing: Only me, Anyone, or the members of one of my rings. Making a private
    memo visible to others asks once; going back to private never does. Changing the sharing back to private takes the memo, its
    replies and reactions out of view for everyone else straight away.
  - **One read rule** in core (`sharedWhere`) gates every read of someone else's memo: shared, not hidden, the writer active and
    not a guest, and for a ring memo the ring not hidden and the reader a member. A ring's memos are for its members only.
  - **Replies** have no sharing of their own: they are stored private and readable only while the memo they answer is. An answer
    to a reply goes into the same thread. A memo's writer can remove replies under it; a reply's writer can remove their own.
  - **Reactions** are the same six words as on posts, on shared memos and replies.
  - **Notifications:** `memo_reply` and `memo_reaction`, which follow the Settings choices for replies and reactions. They show
    as a badge on the Memos icon (not Boards) and link to the thread. A hidden memo's notifications disappear.
  - **Where public memos show:** the profile (with a Feed link), `/feeds/people/{handle}/memos.atom`, and the newest three
    under the plan in finger and on the Gemini page. The mirrors read as a logged-out visitor.
  - **Reports** (kind `memo`) go to the ring's ops for a ring memo, and to admins for a public one. Admins, and a ring's ops for
    its memos, hide and restore with a reason (`memo.hidden`, `memo.restored`, audited), which closes the open reports. The
    writer still sees a hidden memo, marked with the reason; sharing it again does not bring it back.
  - **Leaving a ring**, or being removed or banned, makes the person's ring memos private (a trigger on `ring_members`).
  - **Export** gains `memos-reactions.json` (reactions they left on others' memos). Account deletion removes memos, replies and
    reactions, and the notifications about them.
  - Not built: push for memo notifications.

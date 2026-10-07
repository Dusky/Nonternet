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
- [ ] **M1:** core: tables, routes, search, tags, limits, export, import, deletion, tests (private everywhere).
- [ ] **M2:** the Memos app and the home panel box, e2e.
- [ ] **M3:** public and ring memos, replies, reactions, feeds, profile, reports and hiding, audit; newest public memos under the plan in finger, Gemini and the profile.

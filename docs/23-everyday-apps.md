# 23 — Everyday apps: making boards, mail and the rest feel finished

DECIDED (owners, 2026-10-07): the web apps people use every day get a depth pass, in the order below. The BBS, MUD
and chat servers are out of scope here; the web chat window gets a review first. Images in posts and mail are wanted,
but late. Notifications come straight after readable text.

## Where things stand (checked 2026-10-07)
| App | Has | Thin |
|---|---|---|
| Boards | threads, replies, edit history, pins, reactions, mentions, watch a board, mute, search, lock / move / hide, mod log, drafts | posts render as plain preformatted text (no formatting, no clickable links, no images); no following one thread; no quote-reply; no thread sorting or unanswered view; no polls in threads |
| Mail | 1:1 and small groups, add people, leave, delete, report, block, mute, search | plain-text body; no archive or star; group conversations can't be renamed; no attachments |
| Notifications | replies, mentions, watched boards | three kinds only, and the table needs a post and a board on every row (`0007_notifications.sql`), so nothing else can notify; no grouping, filters or "mark one read" |
| People | directory, who's online, profile with status, `.plan`, homepage link, feed | no activity on profiles (posts, rings, wiki edits); no links or optional fields |
| Homepages directory | list, random | no sorting by recently updated, no tags, no "new this week" |
| Chat (web) | channels, mentions, history, away, private chats | not reviewed for this pass |

## Phases
Each phase is tested and pushed on its own. Bookmarks (`21`) and memos (`22`) fit after E1, because memos use the
same formatting.

### E1 — Readable text (built 2026-10-07)
- Board posts, mail and post previews render through the shared, safe parser (`packages/shared/src/wikitext.ts`, as
  the wiki does): emphasis, lists, quotes, code, and links (http, https, gemini, gopher only). A `#` line reads as a
  bold line.
  Data, never HTML. `[[wiki links]]` are not active outside the wiki.
- Outside links open with `rel="noopener noreferrer"`.
- Quote-reply: select text in a post and press Reply to start with just that text quoted (the boards' `AB>` style);
  the composer's "Quote the post" still quotes all of it.
- Stored text does not change, so the BBS, QWK, Gopher, Gemini and feeds keep showing the raw text, which already reads
  well in a terminal.

### E2 — Notifications that cover the site
- Migration: notifications get `target_type` / `target_id` (and a `group_key`) instead of requiring a post and board.
  Existing rows are converted.
- New kinds: mail (new message in a conversation, honouring mutes), reactions to your posts (grouped), ring invites,
  join requests (for ops) and approvals, vouches for you, the outcome of a report you made, changes to wiki pages you
  started or edited (opt-in), a reply in a thread you follow (E3).
- Grouping: "3 replies in …", "Ada and 4 others reacted …".
- Per-kind choices in Settings → Notifications (on the site, by push, off), building on the existing preferences and
  push subscriptions. Quiet by default for the noisy kinds (reactions, wiki).
- The app: filter by kind, mark one or all read, jump to the thing.
- Everything a notification links to is checked against what the person can still see.

### E3 — Boards depth
- Follow a thread (notifications for replies), separate from watching a board.
- Thread lists: sort by latest activity, newest, most replies; an "unanswered" view; a "since your last visit" marker.
- Polls inside a thread (reuse the voting booth's tables): one question, up to 10 options, closes on a date.
- Board pages: rules text and a short description shown above the threads.

### E4 — Mail depth
- Archive and star per person (not shared with the others in the conversation); an Archive view; unread filter.
- Rename a group conversation (any member; shown to all, noted in the conversation).
- Mark unread.

### E5 — Profiles and directories
- Profiles show recent public activity: posts on public boards, rings, wiki pages edited, homepage updates. Only what a
  logged-out visitor could see anyway, through the same visibility check.
- Optional fields: up to 4 links, pronouns, location. All plain text, all in the export.
- Homepages directory: sort by recently updated, "new this week", filter by ring.

### E6 — Images in posts and mail
- Upload an image while writing; it is re-encoded (as avatars are), metadata removed, capped in size and pixels, and
  stored with a stable id.
- It inherits the post's or conversation's visibility; it is reported and hidden with the post; deleted with it; and
  in the export with the post. Account deletion removes it.
- Per-person storage quota counted with file-area uploads. Off-site images are never hot-linked (content policy stays
  `img-src 'self'`).
- The BBS and mirrors show a text placeholder with the image's address.

### E7 — Chat check-up
Review the web chat window against the other apps (channel list and joining, topics, the people list, search in
history), then plan its pass here.

## Rules for every phase
- New user content is in the export, import where it applies, and account deletion.
- Moderation actions are audited; a person's own reading, starring and archiving are not.
- Interface text follows the writing rule in `10`.

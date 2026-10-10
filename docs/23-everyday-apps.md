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

### E2 — Notifications that cover the site (built 2026-10-08: mail, reactions, ring news)
- Migration: notifications get `target_type` / `target_id` (and a `group_key`) instead of requiring a post and board.
  Existing rows are converted.
- New kinds: mail (new message in a conversation, honouring mutes), reactions to your posts (grouped), ring invites,
  join requests (for ops) and approvals (all built). Still to do: vouches for you, the outcome of a report you made,
  changes to wiki pages you started or edited (opt-in), a reply in a thread you follow (E3), and push for the new kinds.
- Grouping: "3 replies in …", "Ada and 4 others reacted …".
- Per-kind choices in Settings → Notifications (on the site, by push, off), building on the existing preferences and
  push subscriptions. Quiet by default for the noisy kinds (reactions, wiki).
- The app: filter by kind, mark one or all read, jump to the thing.
- Badges on app icons (built 2026-10-09): desktop icons, the Apps menu, taskbar buttons, the phone grid and tab bar show
  what is waiting. Mail: conversations with something new. Boards: things aimed at you (replies, @mentions, reactions,
  new threads on watched boards), in a stronger colour when one is a mention. Rings: invites, requests and joins.
  Chat: mentions and direct messages. Admin: open reports (admins only). Counts cap at 99+, and an icon's accessible
  name says "Boards, 3 unread". Right-click an icon for "Mark these read". A background window that gets more
  waiting nudges its taskbar button (not with reduced motion), and the installed app's own badge follows the total.
  Not yet: badges for wiki, files and the MUD, and a switch to hide badges.
- Everything a notification links to is checked against what the person can still see.

### E3 — Boards depth (built 2026-10-09: E3a follow, sort/filter, rules; E3b polls; the last-visit marker is still to do)
- Follow a thread (notifications for replies), separate from watching a board.
- Thread lists: sort by latest activity, newest, most replies; an "unanswered" view; a "since your last visit" marker.
- Polls inside a thread (reuse the voting booth's tables): one question, up to 10 options, closes on a date.
- Board pages: rules text and a short description shown above the threads.
- Built (E3a): following a thread (writing in a thread follows it; replies come as ordinary "reply" notifications, so
  the Settings choice and the Boards badge cover them), sort by latest activity / newest / most replies, filters for
  "no replies yet" and "unread" (remembered per device), and board rules edited in board settings and audited.
  Follows are in the export and cleared on account deletion. Still to do from this list: the "since your last visit"
  marker.
- Built (E3b): a thread can carry one poll, added when the thread is started (2 to 10 choices, optional closing in days).
  It uses the voting booth's tables and the same rules (one vote each, tally after you vote or when it closes), is
  readable and votable only by people who can read the board, and goes with the thread when it is hidden. The author or a
  board moderator can close it early (a moderator doing it is audited). Thread polls are not in the site-wide voting booth
  list, the BBS or the mirrors yet.

### E4 — Mail depth (built 2026-10-09)
- Archive and star per person (not shared with the others in the conversation); an Archive view; unread filter.
- Rename a group conversation (any member; shown to all, noted in the conversation).
- Mark unread.
- Built: Inbox / Starred / Archived views, star and archive on each row and in the conversation (archiving is at once, with
  an Undo note; a new message from someone else brings an archived conversation back, and archived ones don't count in the
  unread number), mark unread, and rename for conversations of three or more people (leaves a "renamed this conversation"
  line for everyone; the BBS shows it too). Archive and star are in the export as lists of conversation ids and are not
  restored on import, because the conversations themselves stay with the people in them.

### E5 — Profiles and directories (built 2026-10-09)
- Profiles show recent public activity: posts on public boards, rings, wiki pages edited, homepage updates. Only what a
  logged-out visitor could see anyway, through the same visibility check.
- Optional fields: up to 4 links, pronouns, location. All plain text, all in the export.
- Homepages directory: sort by recently updated, "new this week", filter by ring.
- Built: pronouns (40 characters), location (60) and up to four links (http, https, gemini or gopher addresses only, with an
  optional name) in Settings → Profile; plain text everywhere, links open in a new tab with `noopener noreferrer nofollow`.
  Profiles show "Recent activity" (public-board posts, site-wiki pages edited, and the homepage being updated), only what a
  logged-out visitor could see. finger and the Gemini profile list the new fields as plain lines. The directory has a "New
  this week" filter and a ring filter. The fields are in `profile.json` in the export, restored on import, and cleared on
  account deletion. Not built: wiki pages edited in ring wikis (ring-private) and "rings joined" as activity items.

### E6 — Images in posts and mail (built 2026-10-09)
- Upload an image while writing; it is re-encoded (as avatars are), metadata removed, capped in size and pixels, and
  stored with a stable id.
- It inherits the post's or conversation's visibility; it is reported and hidden with the post; deleted with it; and
  in the export with the post. Account deletion removes it.
- Per-person storage quota counted with file-area uploads. Off-site images are never hot-linked (content policy stays
  `img-src 'self'`).
- The BBS and mirrors show a text placeholder with the image's address.
- Built: in the text a picture is `![what it shows](image:i_…)` (a description is required in the editor). Upload
  (`POST /images`, 8 MB in, 25 megapixels) is drawn again as a WebP at most 1600 px on a side, metadata gone, a GIF as its
  first frame; up to four pictures in a post or message, 30 uploads an hour, counted in the same file space as file-area
  uploads. A picture is its owner's alone until a post or message that names it is saved; then whoever can read that post
  or message can see it (pictures on public boards load for visitors), and hiding or deleting the post takes it away.
  Admins can hide one picture (`image.hidden` in the audit log). Unused uploads older than a day are deleted whenever
  someone uploads. In the export (`images/` with a list of where each was used); not restored on import; erased with the
  account when "erase my posts" is chosen. The BBS, QWK packets, Gopher, Gemini and feeds show `[picture: description]` and
  the address. Wiki pages do not take pictures yet.

### E7 — Chat check-up (reviewed and passed 2026-10-10)
Review the web chat window against the other apps (channel list and joining, topics, the people list, search in
history), then plan its pass here.

## Rules for every phase
- New user content is in the export, import where it applies, and account deletion.
- Moderation actions are audited; a person's own reading, starring and archiving are not.
- Interface text follows the writing rule in `10`.

### E7 review and pass (2026-10-10)
Reviewed the Chat window against the other apps. Kept as is: unread and mention badges, the "new messages" line, history on open and on
scroll-up, away dimming, the person menu, ignore and highlight words, per-channel mute, Tab completion, the paste guard and alerts.
Found and fixed: the message box was shared by every conversation (a half-written line could go to the wrong place and nothing
survived a reload); channels and private chats were one flat list; there was no way to find a word; trusted people could not start a
channel from the web (the route existed; only the admin console used it) and channel operators could only set a topic with `/topic`.
Built: a draft per conversation (kept on the device, cleared when sent), "Channels" and "Private chats" groups with mentions and unread
first, "Start a private chat" by handle, "Start a channel" for trusted people and admins, "Edit topic" for channel operators, and
"Find in this conversation" (over the lines loaded here, with next, previous and "Load older", because Ergo cannot search history).
Not done: push for direct messages and mentions (still listed in docs/10), and showing pictures in chat.

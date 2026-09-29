# 05 — Boards

Boards are stored in core's Postgres and shown through the web reader and composer. When the
terminal BBS ships (`04`, last milestone) it reads and writes the same posts through the core
API, so a post from either side appears in the other immediately.

## v1 features
- Board list grouped by category, with ring boards grouped under their rings; unread counts.
- Thread view: threaded and flat; keyboard nav (j/k, n next unread, r reply).
- Composer with **plain-text preview** showing exactly what terminal users will see (79-col wrap).
- Read pointers per user and board, kept in core.
- Logged-out reading of public boards.
- Search (Postgres full-text), notifications (replies, @mentions, watched boards).
- Board creation for trusted users; board settings for owners and board ops.
- Moderation inline for ops.

## Visibility
| Visibility | Read | Post |
|---|---|---|
| public | anyone, including guests and logged-out visitors | user+ |
| members | user+ | user+ |
| ring | anyone (read) / ring members (post) — PROPOSED default for ring boards | ring members |
| private | listed members | listed members |

Ring boards are ordinary boards with `ring_id` set (see `06`). Board metadata (owner, ring,
visibility, ops) and posts are in the same database, so access checks are one query.

## Text-first rule (DECIDED principle, adapted)
**Plain text is canonical**, so the terminal BBS can show every post and boards stay ready
for future federation (`12`).
- Stored body is plain text (UTF-8). Light markdown may be *rendered* on the web but must
  read naturally as raw text in a terminal.
- Subject ≤ 71 chars, wrapped body, initials-style quoting (`ZC> text`) on reply.
- Characters a classic (CP437) terminal can't show are flagged in the preview.

## As built (M2, backend)
- Boards, categories, private-board members, watches, read pointers, threads, replies, deletes by
  the author (a tombstone, text erased) and full-text search work through `/api/v1` (see `14`).
- Not found and not allowed look the same for boards you cannot read: a 404 with the same body.
- Private boards are for listed members only. Admins are not members by default (PROPOSED; the
  console will get an audited way to look, later).
- Search is Postgres `websearch_to_tsquery` (English stemming), limited to boards the viewer can
  read. Match markers in the snippet are the control characters U+0002 and U+0003, which post text
  can never contain, so a client never has to treat a snippet as HTML.
- Post text is cleaned on the way in (control and direction characters removed, tabs become 4
  spaces, line endings become `\n`). The preview is computed by the server from the same code, so
  it is exactly what is stored, plus how a 79-column terminal wraps it and which characters CP437
  cannot show. Libraries: `wrap-ansi` (wrapping), `iconv-lite` (CP437).
- Quotas: `limits.trusted_board_quota` (default 3) counts a user's boards that are not archived;
  admins have none.
- Ring boards cannot be created yet (M3). Until then a `ring` board takes no posts.

## As built (M2, Boards app)
- The Boards app is public: `/boards` opens without an account, with a login link in place of the
  account menu, and the login page sends the visitor back to where they were.
- Screens: board list (by category, unread counts), threads, thread (flat or threaded), composer
  with the server preview, new board, board settings (rename, visibility, archive, private members),
  search. Keys: j and k move, r replies, n jumps to the next unread thread.
- Reading a thread moves your read pointer to the last post you loaded. "Mark all read" moves it to
  the newest post in the board.
- Replies quote with the author's initials (`ZC> `), wrapped to 79 columns.
- Post text is shown as plain text (`white-space: pre-wrap`). Light markdown rendering is not built;
  if it is added it must render safely from the stored text without changing what is stored.

## Later (local extras, web-only)
Reactions, edits with history, image attachments — labeled as web-only; terminal users see
a text fallback ("[image: filename]").

## Edits and deletes
- Authors can delete their own posts (shows "deleted by author") within board rules.
- Edits: later; when added, keep history and show "edited".

## Routes (PROPOSED)
```
/boards                       all boards
/boards/:slug                 thread list
/boards/:slug/t/:threadId     thread
/boards/:slug/new             new thread
/boards/new                   create (trusted+)
/boards/:slug/settings        owner/board op/admin
```

## Acceptance tests
- A post made on the web is stored once, with the right author, board and thread.
- Read pointers update unread counts on the web.
- (BBS milestone) Web post → visible in terminal within 2 s with correct author, and vice
  versa; reading in the terminal updates web unread counts.
- Logged-out visitors see only public boards (and ring boards set to public read).
- Preview text equals stored body byte-for-byte.

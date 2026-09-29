# 05 — Boards Web View

A modern web reader/composer over **the same message base** as the terminal BBS (DECIDED).
A post from either side appears in the other immediately.

## v1 features
- Board list grouped by category, with ring boards grouped under their rings; unread counts.
- Thread view: threaded and flat; keyboard nav (j/k, n next unread, r reply).
- Composer with **plain-text preview** showing exactly what terminal users see (79-col wrap).
- Read pointers synced with Enigma.
- Logged-out reading of public boards.
- Search (core read index), notifications (replies, @mentions, watched boards).
- Board creation for trusted users; board settings for owners and board ops.
- Moderation inline for ops.

## Text-first rule (DECIDED principle, adapted)
Boards are shared with terminal users, so **plain text is canonical**.
- Stored body is plain text (UTF-8). Light markdown may be *rendered* on the web but must
  read naturally as raw text in the terminal.
- Subject ≤ 71 chars, wrapped body, initials-style quoting (`ZC> text`) on reply.
- Characters that don't render in CP437 are shown in the preview with a warning (VERIFY how
  Enigma handles UTF-8 for terminal users).
- This also keeps boards ready for future FTN federation (`12`).

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
- Web post → visible in terminal within 2 s with correct author; and vice versa.
- Reading in the terminal updates web unread counts.
- Logged-out visitors see only public boards (and ring boards set to public read).
- Preview text equals stored body byte-for-byte.

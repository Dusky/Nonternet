# 12 — Ownership & Export

Users own their stuff (DECIDED), without having to run a server.

## v1 commitments
1. **Full export** — one button, one archive, everything the user made.
2. **Stable identity** — user ID + keypair, independent of handle.
3. **Custom domains** for homepages (`07`).
4. **Open formats** — no proprietary blobs.
5. **Deletion** — users can delete their account after exporting.

## Export archive (PROPOSED format)
`{handle}-{date}.zip`:
```
manifest.json            # format version, user id, handle, export date, file list + hashes
manifest.sig             # Ed25519 signature by the user's key
profile.json             # handle, display name, bio, join date, rings, role history
homepage/                # all homepage files exactly as uploaded
guestbook.json           # entries on their homepage
posts/
  posts.json             # every post they wrote: board, thread, subject, body, date, reply-to
  posts.mbox             # same posts as mbox for mail/news tools (PROPOSED)
rings/                   # for rings they founded/op: profile, member list, settings
boards/                  # for boards they own: metadata (messages by others are NOT included)
irc/                     # their own messages from server history, if retained (OPEN)
mud/                     # characters: descriptions, stats, inventory as JSON
keys/public.key          # public key; private key only if user opts in with password protection
README.txt               # human explanation of the archive
```
- Exports are built by a worker, emailed/notified when ready, expire after 7 days.
- Rate limit: one export per 24 h.
- **Rule:** any new kind of user content must be added here; CI has a test that fails if a
  content table has no exporter registered.

## Whose content is it?
- A user's export includes **what they authored**. Others' posts in their threads are not
  included (PROPOSED), except as quoted context in thread files if we add that later (OPEN).
- Ring founders get ring metadata and member lists (public info), not members' content.

## Future: the path out (designed for, not built)
- **Import**: a future self-hosted node or another instance can import the archive; the
  signature proves it's the same person.
- **Identity portability**: user key signs a statement "I moved to X"; the site can publish
  a redirect for the homepage and profile.
- **Points / self-hosting / federation**: hub-and-spoke with this site as hub, desktop
  "point" apps, or full self-hosted nodes. Boards stay plain-text so FTN federation remains
  possible. See `17-decisions.md` future items.

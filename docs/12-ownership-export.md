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
profile.json             # handle, display name, bio, join date, rings, role history, theme and Terminal screen colour, and the application if they applied to join
homepage/                # all homepage files exactly as uploaded
guestbook.json           # entries on their homepage
posts/
  posts.json             # every post they wrote: board, thread, subject, body, date, reply-to
  posts.mbox             # same posts as mbox for mail/news tools (PROPOSED)
rings/                   # for rings they founded/op: profile, member list, settings
boards/                  # for boards they own: metadata (messages by others are NOT included)
irc/messages.json        # their own chat messages from the last irc.history_days (Q9): time, channel or person, text
mud/                     # characters: descriptions, stats, inventory as JSON
mail/conversations.json  # each conversation: subject, people, and only the person's own messages (M7)
mail/blocked.json        # handles they have blocked
files/{area}/{name}      # every file they uploaded to the file areas, as uploaded, plus files.json (M7)
vouches.json             # vouches they gave
                         # QWK replies are ordinary posts, so they are in posts/ already: for whom, their note, and what came of it (M7)
keys/public.key          # public key; private key only if user opts in with password protection
README.txt               # human explanation of the archive
```
- Exports are built by a worker, emailed/notified when ready, expire after 7 days.
- Rate limit: one export per 24 h.
- **Rule:** any new kind of user content must be added here; CI has a test that fails if a
  content table has no exporter registered.

## As built (M4, export and deletion)
- **Request** (`POST /me/export`, password again; optional private key locked with that password) queues a job;
  a worker in core builds it (polls every 5 s), mails a link, and keeps the archive 7 days (`EXPORTS_DIR`), then deletes
  the file. One export a day; a failed one does not use up the day. Download is only for the owner, `no-store`, audited.
- **Format** is `export-v1`: `manifest.json` (every file with size and SHA-256), `manifest.sig` (base64 Ed25519 over the exact
  manifest bytes), `keys/public.key` (PEM), `profile.json`, `homepage/` and `homepage.json`, `guestbook.json` (entries on the
  page, and entries the person signed elsewhere), `posts/posts.json` (with `edited_at`) and `posts/posts.mbox` (mboxrd, one `Newsgroups:` per board), `posts/revisions.json` (what your own posts said before each edit; erased with the post) and `posts/reactions.json` (reactions you left),
  `rings/{slug}/` for rings founded or run, `boards/{slug}.json` for boards owned, `README.txt` with the OpenSSL check.
  A deleted post appears in `posts.json` as an empty tombstone and not in the mbox. The private key file is JSON:
  scrypt (N=2^15) then AES-256-GCM.
- **Keys:** every account gets an Ed25519 key at signup (older accounts on their first export). The private half is
  encrypted with `APP_SECRET_KEY`.
- **The rule is enforced:** `exports/exporters.test.ts` reads every table from a migrated database and fails unless
  it is claimed by an exporter or listed in `EXEMPT` with a reason, and fails on stale entries.
- **Not included** (Q9, still OPEN and left at the PROPOSED default): other people's posts in your threads, and IRC
  history (kept in Ergo's memory for a few days, `08`). Private-board posts by the person are included, since they wrote them.
- **Added since:** `irc/channels.json` (channels the person registered, M5) and `mud/characters.json` (each MUD character:
  sheet, abilities, HP, level, coins, location, belongings, M6). The MUD's data comes from the MUD itself; if it is set up
  but not answering, the export fails and can be asked for again. Deleting an account deletes its MUD characters.
- **Deletion** (`POST /me/delete`, or an admin on request with a reason): as hard as logging in (password, handle typed
  out, and a current 2FA or recovery code). The person chooses what happens to their posts and guestbook entries: keep
  them without a name (default, matching `posts.author_id null = deleted user`) or erase them to tombstones. Homepage,
  files, domains, exports, keys, memberships, notifications and watches are deleted; boards they own are archived; the account
  row stays, emptied (`status deleted`, handle `deleted-…`, no email), and the old handle is held for 90 days. A ring founder
  must hand over or archive the ring first, and the last admin cannot be deleted. Announced as `user.deleted`.

## As built (polish phase)
`chat/client.json` and `mud/client.json`: the settings the Chat and MUD clients keep on the account (highlight words and ignored nicks; the MUD client's aliases, triggers, timers, keys, buttons, variables, saved command history and options). They come back with "Bring back an export" (the part "Your chat and MUD client settings") and are erased with the account.

## Whose content is it?
- A user's export includes **what they authored**. Others' posts in their threads are not
  included (PROPOSED), except as quoted context in thread files if we add that later (OPEN).
- Ring founders get ring metadata and member lists (public info), not members' content.

## Bringing back an export (built 2026-10-02)
Settings, Your data, "Bring back an export". Upload the zip, see a preview, then bring it back with your password.
- **What comes back**: only what is yours alone (and, since the polish phase, your chat and MUD client settings):
  - your name, bio and theme;
  - your status line, notification choices and muted boards;
  - your picture;
  - your homepage files and settings;
  - your files in file areas that exist here;
  - your SSH keys.

  Each goes through the same checks as doing it by hand: quotas, file types, upload rights, the 500-file cap and safe paths. So a file that doesn't fit is reported and the rest still comes back. Homepage files already here are kept unless you tick "replace".
- **What stays in the archive**: posts, mail, guestbook entries, rings, boards, chat, MUD characters, vouches, and wall lines, polls and votes. They involve other people or the site's own records. The preview lists them with counts.
- **Never changed**: handle, email, role, ops, custom domains, anything of anyone else.
- **Checks**:
  - Every file the manifest lists must be present with the right size and SHA-256, and nothing else may be in the zip.
  - It may unpack to at most `limits.import_max_mb` (default 200 MB) and 5000 entries.
  - An archive made here must be for you and signed with your own key; one made for another account here is refused.
  - An archive from another site is checked against the key inside it, which proves nothing changed but not who made it. The preview says so plainly.
  - One archive can be brought back once.
  - Uploads not brought back within an hour are deleted.
  - Each import is audited (`import.applied`, with the archive's hash and counts).

## Future: the path out (designed for, not built)
- **Import elsewhere**: a self-hosted node could take the same archive; proving origin across sites needs the source site's
  record of the key, or the person unlocking `keys/private.key.json`.
- **Identity portability**: user key signs a statement "I moved to X"; the site can publish
  a redirect for the homepage and profile.
- **Points / self-hosting / federation**: hub-and-spoke with this site as hub, desktop
  "point" apps, or full self-hosted nodes. Boards stay plain-text so FTN federation remains
  possible. See `17-decisions.md` future items.

## As built (M9-D)
`settings.json` holds the status line, away flag, last-seen and digest choices, per-kind notification choices, muted boards and
muted mail conversations. `avatar.webp` is the stored picture, if there is one. Device-only preferences (chat, boards,
terminal, drafts) live in the browser, are not on the site, and so are not exported. Erasing an account deletes the picture,
the choices and the mutes.

## As built (M9-E1)
`classics.json`: your oneliners, the votes you cast (poll and choice) and the polls you asked. Bulletins are site documents and not exported.
Erasing an account deletes its oneliners, votes and bulletin read-marks; polls it asked and bulletins it wrote stay, without a name.

## As built (M9-E2)
Ring banners go in the export of the people who run the ring (`rings/<slug>/banner-468x60.png`, `banner-88x31.png`). Guestbook passes are security state, not content.

## As built (M9-E3)
`mud/characters.json` also holds each character's quest progress `noticeboard_notes` (the text, when it was pinned and the name it was pinned under) and `guestbook_entries` (the text, when it was signed and the name). Erasing the account removes the notes and guestbook lines from the tavern.

## As built (tower, T1)
`mud/characters.json`: each character also carries `tower`, this season's climb (the floors whose stairs you opened and your highest floor).

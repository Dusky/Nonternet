# 06 — Rings

Rings are the unit of community on the site (DECIDED). They're modeled on old webrings,
extended so a ring is a small group with its own spaces.

## What a ring has
| Part | Details |
|---|---|
| **Profile** | name, slug, short description, long "about" (plain text / light markdown), banner (e.g. 468×60 or 88×31 button), topic tags |
| **Members** | users who joined; list is public by default |
| **Ring board** | one board owned by the ring (created automatically) |
| **Ring channel** | one IRC channel, e.g. `#ring-synths`, created automatically; founder and ring ops are channel ops (`08`) |
| **Nav bar** | prev / next / random / list — embeddable on members' homepages |
| **Ring page** | a public page on the site: about, members, latest posts, member homepages |
| **Ops** | founder is first ring op; can appoint more |

**Not included:** MUD rooms or zones. The MUD is one shared world with nothing owned by
rings (DECIDED). PROPOSED: an optional ring tag after a player's name in `who` output only.

## Lifecycle
- **Found**: trusted users (quota: 2 rings, PROPOSED). Choose name, slug, description,
  join policy. Board and (later) channel are created.
- **Join policy** (ring op setting): open | approval | invite.
- **Leave**: any time; their homepage nav bar is removed automatically.
- **Membership limit**: users can join any number of rings (old pages wore many ring banners).
  PROPOSED soft cap 20 to limit spam.
- **Hide/archive**: ring ops can archive (read-only); admins can hide/delete.
- **Transfer**: founder can hand the ring to another op; inactive rings prompt admins after 180 days.

## Ring ops can
Approve/remove members, moderate the ring board and channel, edit the ring profile and
banner, reorder the nav sequence, pin posts, ban a user from the ring (with reason, logged).

## The nav bar
- Snippet: `<script src="https://{site.domain}/ring/{slug}/nav.js" data-member="{user_id}">` plus
  a no-JS fallback `<a>` block and image-map banner — both provided.
- Links go through `/ring/{slug}/next?from={user_id}` etc., so order changes and removed
  members never break pages.
- Dead-link checker: members whose homepage is empty or missing the nav bar are flagged to
  ring ops (not auto-removed).
- Classic styles offered (table-based bar, button row, banner with arrows); members may style
  their own.

## Discovery
- Ring directory: by tag, newest, most active (posts + new members this week), random ring.
- A user's profile shows their rings.
- The terminal BBS (last milestone) will have a Rings menu listing rings and their boards.

## Relationship to standalone boards
Trusted users can still create **standalone boards** (site-wide topics). A ring board is a
board with `ring_id` set. Ring board visibility defaults: public read, members post (PROPOSED).

## As built (M3, rings)
- **Founding** makes the ring, its board (`ring-{slug}`, visibility `ring`: anyone reads, members post) and
  the founder's membership and first op grant, in one transaction. Quota `limits.trusted_ring_quota` (2); admins
  have none. Ring boards do not count toward the board quota. A ring address is up to 24 characters.
- **Joining:** open (at once), approval (a request ops approve) or invitation (ops invite by handle; the person
  accepts). Up to 20 rings per person (`MAX_RING_MEMBERSHIPS`). The founder cannot leave; they hand the ring on
  (to a trusted member, within that person's quota) or archive it. Archiving the ring archives its board.
- **Ops:** the founder and admins choose them (ring members only); an op can step down. Ring ops moderate the ring board
  like board ops (hide, remove, lock, reports go to them), approve, remove, ban and unban with a reason (audited, and
  `ring_bans` keeps the reason), invite, reorder the bar and edit the profile.
- **Nav bar:** `/ring/{slug}/nav.js` with `data-member` and `data-style` (bar, buttons or banner), and plain links for
  visitors without scripts (the snippet includes a `<noscript>` block). `/ring/{slug}/{next|prev|random|list}?from=`
  redirect, wrapping around, skipping members with no front page, hidden pages and anyone no longer a member. A person
  who is not a member (any more) still lands somewhere and their bar says so.
- **Dead-link check:** the bar reports itself when it runs on a member's own page (the request's `Origin` matches
  their homepage), recorded as `nav_detected_at`. Ops see flags in the member list: `no_homepage`, and `no_nav_bar`
  when it has not been seen for 30 days. Nobody is removed automatically.
- **Directory:** newest, most active this week (posts plus new members), name; tag and search; random ring.
  Admins hide and restore rings (the board goes with them), audited.
- Banner upload was built in M9-E2 (below) and profiles list a person's rings since M5.

## Acceptance tests
- Trusted user founds a ring → ring page, board and nav script exist.
- Another user joins (open ring) → can post in ring board; nav bar works on their homepage.
- Ring op removes a member → member's nav bar shows "not a member" state, prev/next skip them.
- User (non-trusted) cannot found a ring; trusted user blocked at quota.

## As built (M9-E2): banners
A ring can have a 468×60 and an 88×31 banner (PNG, JPEG, WebP or GIF up to 1 MB, drawn again as PNG at the exact size, a GIF becoming its first frame), uploaded by
the ring's ops or an admin and kept in `FILES_DIR/ring-banners/`. Anyone can see ones that are showing (`GET /rings/:slug/banner/:kind`, public so member pages can
embed them). Ops can remove one; an admin or op can take one down with a reason (audited `ring.banner_hidden` / `ring.banner_restored`), after which visitors see
nothing and ops see it marked. They are in the export of the people who run the ring.

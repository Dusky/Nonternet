# 06 — Rings

Rings are the unit of community on the site (DECIDED). They're modeled on old webrings,
extended so a ring is a small group with its own spaces.

## What a ring has
| Part | Details |
|---|---|
| **Profile** | name, slug, short description, long "about" (plain text / light markdown), banner (e.g. 468×60 or 88×31 button), topic tags |
| **Members** | users who joined; list is public by default |
| **Ring board** | one board owned by the ring (created automatically) |
| **Ring channel** | one IRC channel, e.g. `#ring-synths` (created automatically once IRC ships) |
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

## Acceptance tests
- Trusted user founds a ring → ring page, board and nav script exist.
- Another user joins (open ring) → can post in ring board; nav bar works on their homepage.
- Ring op removes a member → member's nav bar shows "not a member" state, prev/next skip them.
- User (non-trusted) cannot found a ring; trusted user blocked at quota.

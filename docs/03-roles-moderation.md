# 03 — Roles & Moderation

## Site roles (DECIDED tiers, renamed to plain vocabulary)
| Role | Can |
|---|---|
| **guest** | Read public boards, browse homepages and rings. No posting. |
| **user** | Post, chat, play the MUD, own a homepage, join rings, sign guestbooks. |
| **trusted** | Everything a user can, plus create boards and found rings (within quotas). |
| **admin** | Everything, including the admin console. |

One `role` field, carried in the SSO token, read by every service. (DECIDED)

## Ops (scoped moderators)
Ops are layered on top of roles and scoped to one thing:
- **board op** — moderate one board
- **ring op** — manage one ring (members, its board, its channel, its nav bar)
- **channel op** — IRC channel operator

A ring's founder is its first ring op and can appoint others. Any user (not just trusted)
can be an op if appointed. Stored in `scoped_roles`; carried in the token's `ops` claim.

## Becoming trusted
- **Admin grant** (DECIDED for v1).
- **Eligibility hints** in the admin console (PROPOSED defaults: account ≥ 30 days, ≥ 25
  posts, no moderation actions in 60 days). Never auto-promotes.
- **Vouching** later (OPEN): two trusted users sponsor; sponsors flagged if the vouchee is
  demoted for abuse soon after.

## Guardrails
- **Quotas** (PROPOSED): trusted users may own 3 boards and found 2 rings; admin-configurable.
- **Inactive owners**: after 180 days away, admins are prompted to reassign or archive.
- **Demotion** blocks new creation; existing boards and rings stay.
- **Audit log** for everything below.

## Moderation tools
- Actions: hide post, lock/move thread, delete, warn, mute (timed, per service or site-wide),
  suspend, ban.
- Scope: board ops act on their board; ring ops on their ring's board/channel/membership and
  nav listing; admins everywhere.
- **Reports**: any user can report a post, homepage, guestbook entry, ring, chat message or
  MUD player. Reports route to the relevant op first, escalate to admins after 24 h or on
  request.
- **Mod log**: public per-board/ring log of actions (admin toggle; PROPOSED on).
- **Appeals**: suspended users get a one-message appeal form to admins.

## Audit log
Append-only. Actor, action, target, before/after JSON, origin (web, terminal, IRC, MUD,
system), IP, time. Viewable and scrubbable in the admin console (`11`). Never purged for
role changes, suspensions, deletions.

Minimum audited actions: user.created, user.role_changed, user.ops_changed, user.suspended,
user.renamed, user.deleted, board.*, ring.*, homepage.hidden, mod.*, report.resolved,
settings.changed, export.requested, custom_domain.*.

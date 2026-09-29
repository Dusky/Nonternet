# 11 — Admin Console

The admin console is where over-engineering is welcome (DECIDED: admins love admin panels).
The core stays boring; the console can be as deep as we like, **as long as it only reads
from and calls into well-tested core APIs** — it never gets private back doors into services.

## Design principles
- **Everything live.** Presence, rates and health update in real time (SSE/WebSocket).
- **Everything drillable.** Every number links to the list behind it; every list item to a detail page.
- **Everything has history.** Charts over time for every metric; audit timeline for every object.
- **Everything reversible where possible.** Config is versioned with diffs and rollback;
  moderation actions have an undo where the underlying action allows it.
- **Two ways to do everything.** Every action is a button *and* a console command.
- **Ops get a slice.** Board ops and ring ops get the same console UI scoped to what they manage.

## Sections

### 1. Status board (home)
Live tiles with sparklines: users online per service (web, BBS nodes, IRC, MUD), posts/hour,
signups today, open reports, queue depths (export jobs, reconcile issues), disk use (Postgres,
Enigma, homes, backups), service health (up/down/latency per container), last backup age,
TLS certificate expiries.

### 2. Users
- Searchable, filterable table (role, status, joined, last seen, eligible-for-trusted, rings,
  quota usage).
- **User dossier**: profile, role/ops history, ring memberships, boards owned, homepage stats,
  recent posts across boards, IRC/MUD activity summary, reports by/against, moderation
  history, sessions and devices, login history (IP hashed or shown per privacy setting),
  exports requested, admin notes (private, append-only).
- Actions: promote/demote, appoint/remove ops, suspend/unsuspend, rename, force logout,
  reset terminal password, adjust quota, delete.

### 3. Timeline (audit replay)
Scrubbable timeline of the audit log, filterable by actor, target, action, service.
"Replay" view shows how an object (user, board, ring) changed step by step with diffs.

### 4. Boards & rings
All boards and rings with activity charts, owners, ops, membership, quota use, report counts,
inactive-owner flags. Actions: reassign, archive, hide, merge boards (later), edit ACS.

### 5. Moderation queue
Reports with context (the item, surrounding thread, reporter and target dossiers), SLA timers,
escalations from ops, bulk actions, canned reasons, mod log preview.

### 6. Services
One detail page per service:
- **BBS**: live nodes (who, where in the menus, connected via), message rates per area,
  bridge health, reconcile report, art pack in use.
- **IRC**: channels, users, opers, bans/K-lines, message rates.
- **MUD**: connected players, room occupancy heatmap, builder activity, object counts.
- **Homepages**: storage by user, top pages by hits, recently updated, custom domains and
  their verification/TLS status.
- **Caddy**: request rates, error rates, certificate status.

### 7. Config
Every setting (signup mode, quotas, limits, themes, MOTD, feature flags) in forms, backed by
**versioned settings**: each change stored with author, reason and diff; one-click rollback;
"pending changes" preview for risky settings. `site.name`/domain shown here as read-only
(changed via deploy config).

### 8. Announcements & MOTD
Compose once, publish to: shell banner, BBS login screen/MOTD, IRC `#lobby` notice, MUD
broadcast. Schedule, expire, preview per channel.

### 9. Stats
Historical charts: users (signups, active daily/weekly/monthly), content (posts, homepages
updated, rings founded), service usage, retention cohorts. Export CSV.

### 10. Backups & jobs
Backup history, sizes, verify-restore results, run backup now; background jobs with status,
retries, logs.

### 11. Command console
A terminal-style panel inside the console: `user promote zerocool trusted --reason "…"`,
`ring archive synths`, `bbs who`, `announce --all "…"`. Commands map 1:1 to API calls,
with tab completion and history. Every command is audit-logged like the button equivalent.

## Ring op / board op view
Same components, scoped: their members, their reports queue, their board/ring stats,
their mod log, their settings.

## Build order
v1: status board, users + dossier, moderation queue, boards & rings, config (versioned),
announcements, audit timeline (list form). Later: replay diffs, stats cohorts, heatmaps,
command console. The console should grow continuously; plan for it.

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

> **Built (M4, settings and announcements):** the Settings tab lists the settings an admin may change without a deploy
> (sign-up mode, minimum age, trusted board and ring quotas, homepage space, custom domains per person, the public mod
> log). The site name and addresses are shown read-only. Each change needs a reason, is saved as a new version (who, when,
> why, old and new value), takes effect at once, and is audited as `settings.changed`. A *risky* setting (sign-up mode,
> minimum age, homepage space) first shows a preview with how many people or pages a lower limit would touch, and only
> changes when confirmed. Any earlier version can be brought back (as a new version), and "use the file's value again" undoes an
> override. Saved values are loaded over the config file when the server starts. The per-file limit is not a setting: it is
> fixed when the server starts. The Announcements tab writes notices for the shell (title, message, notice or warning,
> optional start and end, preview, end early); everyone sees the live ones as a dismissible banner, signed in or not. Other
> channels (BBS, IRC, MUD) are added with those services.
>
> **Built (M3):** a Homepages tab (every homepage with size and last change, totals, hide and restore
> with a reason). The Reports tab also shows reports about homepages and guestbook entries, with hide and dismiss.
>
> **Built (M2):** a Reports tab (the moderation queue across all boards) and a Boards tab (every
> board you can read, with owner, who can read it, thread count and last post).
>
> **Built (M1, v0):** users list with search and filters, a dossier (role, suspend and
> unsuspend, ops, history), invites, and the audit log. Every change asks for a reason. The rest
> of this doc is still to build.

## Sections

### 1. Status board (home)
Live tiles with sparklines: users online per service (web, IRC, MUD, and BBS nodes once shipped), posts/hour,
signups today, open reports, queue depths (export jobs, reconcile issues), disk use (Postgres,
homes, backups), service health (up/down/latency per container), last backup age,
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
- **BBS** (last milestone): live nodes (who, where in the menus, connected via), post rates
  per board, art pack in use.
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
Compose once, publish to: shell banner, BBS login screen/MOTD (once shipped), IRC `#lobby`
notice, MUD broadcast. Schedule, expire, preview per channel.

### 9. Stats
Historical charts: users (signups, active daily/weekly/monthly), content (posts, homepages
updated, rings founded), service usage, retention cohorts. Export CSV.

### Legal tab (as built)
Takedown and legal requests queue (act / decline with a note) and the editable legal pages with version history.

### 10. Backups & jobs
**As built (M4):** Status and Backups tabs; per-service user counts, TLS expiry and a run-now button are not built yet; there are no background jobs beyond exports.
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

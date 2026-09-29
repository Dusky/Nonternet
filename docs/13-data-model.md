# 13 — Data Model (core, PostgreSQL)

PROPOSED. IDs are prefixed ULIDs (`u_`, `b_`, `r_` …). All tables have `created_at`,
`updated_at`. Enums match `packages/shared`.

## Accounts & roles
```sql
users (
  id text pk,                       -- u_…
  handle text not null,             -- unique index on lower(handle)
  display_name text, bio text,
  email text unique not null, email_verified_at timestamptz,
  password_hash text not null,
  terminal_password_hash text,
  totp_secret_enc bytea,
  public_key text, private_key_enc bytea,
  role text not null default 'guest',   -- guest|user|trusted|admin
  role_rev int not null default 0,
  status text not null default 'active',-- active|suspended|deleted
  quota_bytes bigint,               -- null = role default
  theme text, last_seen_at timestamptz
)
handle_aliases (handle text pk, user_id fk, expires_at)
ssh_keys (id, user_id fk, public_key, fingerprint unique, label)
sessions (id, user_id fk, refresh_hash, user_agent, ip_hash, expires_at, revoked_at)
login_tickets (id, user_id fk, service, expires_at, used_at)      -- 60 s, single use
invites (code pk, created_by fk, used_by fk null, expires_at)
applications (id, email, handle, answer, status, reviewed_by, reviewed_at)
scoped_roles (id, user_id fk, role text, scope_type text, scope_id text, granted_by fk)
                                   -- role: board_op|ring_op|channel_op|mud_builder
admin_notes (id, user_id fk, author_id fk, body)                   -- append-only
```

## Boards
```sql
board_categories (id, name, sort)
boards (
  id text pk, slug text unique, name, description,
  category_id fk null, ring_id fk null,
  owner_id fk users,
  enigma_area_tag text unique not null,       -- derived from id
  visibility text not null,                   -- public|members|ring|private
  archived_at, hidden_at
)
board_members (board_id, user_id)             -- private boards
message_index (enigma_message_id pk, board_id fk, author_id fk null, subject,
               body_tsv tsvector, posted_at, thread_root, hidden bool)
watches (user_id, board_id)
read_state_cache (user_id, board_id, last_read_id)  -- mirror of Enigma pointers for unread counts
```

## Rings
```sql
rings (id pk, slug unique, name, description, about, banner_path, tags text[],
       founder_id fk, join_policy text, -- open|approval|invite
       board_id fk, irc_channel text, archived_at, hidden_at)
ring_members (ring_id fk, user_id fk, status text, -- pending|member|banned
              position int, joined_at, nav_detected_at, flagged_dead bool)
ring_bans (ring_id, user_id, reason, by_id, created_at)
```

## Homepages
```sql
homepages (user_id pk fk, title, description, size_bytes, last_updated_at,
           hidden_at, hit_count bigint default 0)
custom_domains (domain pk, user_id fk, verify_token, verified_at, status)
guestbook_entries (id, homepage_user_id fk, author_id fk null, author_name, author_url,
                   body, ip_hash, status)   -- pending|visible|hidden
```

## Moderation, audit, notifications, ops
```sql
reports (id, reporter_id, target_type, target_id, reason, status, assigned_scope,
         escalated_at, resolved_by, resolution)
mod_actions (id, actor_id, action, target_type, target_id, reason, expires_at, undone_at)
audit_log (id bigserial pk, actor_id null, actor_kind, action, target_type, target_id,
           before jsonb, after jsonb, origin, ip_hash, created_at)   -- app role: INSERT only
settings (key pk, value jsonb, version int)
settings_history (id, key, version, value jsonb, changed_by, reason, created_at)
announcements (id, body, channels text[], starts_at, ends_at, created_by)
notifications (id, user_id, kind, payload jsonb, read_at)
exports (id, user_id, status, path, size_bytes, expires_at)
jobs (id, kind, status, attempts, payload jsonb, result jsonb, run_at)
metrics_rollup (metric, bucket timestamptz, value double precision)  -- console charts
```
Presence lives in Redis: `presence:{user_id}` → services + since.

## Invariants (enforce and test)
- Board/ring ownership requires `trusted` or `admin` at creation; quotas checked at creation.
- Every ring has exactly one board (`rings.board_id` not null after creation).
- `audit_log` and `admin_notes` have no UPDATE/DELETE grants for the app role.
- Every content table is registered with an exporter (`12`).

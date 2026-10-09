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
  totp_secret_enc text,             -- AES-256-GCM with APP_SECRET_KEY; set at setup, live once totp_enabled_at is set
  totp_enabled_at timestamptz,
  totp_last_step bigint,            -- last accepted 30 s TOTP step; older or equal steps are refused
  public_key text, private_key_enc bytea,
  role text not null default 'guest',   -- guest|user|trusted|admin
  role_rev int not null default 0,
  status text not null default 'active',-- active|suspended|deleted
  quota_bytes bigint,               -- null = role default
  theme text,                       -- webring|after-dark|terminal|platinum|aqua, null = site default
  theme_variant text,               -- Terminal screen colour (amber, green, …), null otherwise
  last_seen_at timestamptz
)
handle_aliases (handle text pk, user_id fk, expires_at)   -- built as handle_history (migration 0009)
ssh_keys (id, user_id fk, public_key, fingerprint unique, label)
webauthn_credentials (id, user_id fk, credential_id unique, public_key, counter, transports, backed_up, name, created_at, last_used_at)  -- passkeys (02)
webauthn_challenges (id, user_id null for sign-in, purpose register|login, challenge, expires_at)  -- one use, five minutes
users.plan (text, up to 2000 characters; finger, profile and Gemini show it)
push_subscriptions (id, user_id fk, session_id, endpoint unique, p256dh, auth, kinds[], label, created_at, last_used_at, failures)  -- push devices (10); pushes stop when the session ends
sessions (id, user_id fk, token_hash unique, user_agent, ip_hash, limited bool, expires_at, revoked_at)
                                   -- token_hash = sha256 of the cookie value; limited = admin still setting up TOTP while the site requires it
email_verifications (token_hash pk, user_id fk, expires_at, used_at)   -- 24 h, single use
password_resets (token_hash pk, user_id fk, expires_at, used_at)       -- 1 h, single use, newest wins
recovery_codes (code_hash pk, user_id fk, used_at)                     -- 10 per user, single use, hashed
login_tickets (id, user_id fk, service, expires_at, used_at)      -- 60 s, single use (bbs|mud)
invites (code pk, created_by fk, used_by fk null, used_at, expires_at)
applications (id, email, handle, answer, status, reviewed_by, reviewed_at)
scoped_roles (id, user_id fk, role text, scope_type text, scope_id text, granted_by fk)
                                   -- role: board_op|ring_op|channel_op|mud_builder; unique per user and scope
                                   -- scope_id has no FK until boards and rings exist (M2, M3)
admin_notes (id, user_id fk, author_id fk, body)                   -- append-only
```

## Boards
```sql
board_categories (id, name, sort)
boards (
  id text pk, slug text unique, name, description,
  category_id fk null, ring_id fk null,
  owner_id fk users,
  visibility text not null,                   -- public|members|ring|private
  archived_at, hidden_at
)
board_members (board_id, user_id)             -- private boards
posts (id text pk,                             -- p_…
       board_id fk, author_id fk null,          -- null = deleted user
       thread_root_id fk null, reply_to_id fk null,
       subject text, body text not null,        -- plain UTF-8 (see 05)
       body_tsv tsvector, posted_at timestamptz,
       edited_at timestamptz null, hidden_at timestamptz null, deleted_at timestamptz null)
watches (user_id, board_id)
images (id, owner_id, post_id, mail_message_id, alt, width, height, bytes, hidden_at)   -- E6; bytes in <files dir>/images/<id>.webp
users.pronouns, users.location, users.links (jsonb)   -- E5; optional profile fields
mail_participants.archived_at, .starred_at            -- E4; one person's own view
polls.post_id                                         -- E3b; set when the poll belongs to a thread
thread_follows (user_id, thread_id, created_at)      -- E3a; replies to a followed thread notify as 'reply'
boards.rules text                                     -- E3a; plain text shown above the threads
mod_actions (id m_…, board_id, actor_id, action hide|unhide|lock|unlock|remove|move, post_id, reason, detail, created_at, undone_at, undone_by)
reports (id rp_…, target_type post, target_id, scope_type board, scope_id, reporter_id, category, note, status open|actioned|dismissed, resolved_by, resolved_at, resolution_note)
                                                -- one open report per (reporter, target); migration 0008
posts also has locked_at (thread starts only) and deleted_by (author|moderator).
notifications (id n_…, user_id, kind reply|mention|watch|mail|reaction|ring_invite|ring_request|ring_joined, post_id?, board_id?, actor_id, ref?, count, created_at, read_at;
  `ref` is the thing a mail, reaction or ring notification is about; while one is unread, more of the same add to `count` (0044))
                                                -- unique per (user, post); migration 0007
read_state (user_id, board_id, last_read_seq)   -- read pointers; source of unread counts
```
As built (migration 0006): `posts.seq` is an identity column that gives every post a total order,
so read pointers and thread order use `seq`, not the ULID (two ULIDs from the same millisecond can
sort either way). The root post of a thread also carries `reply_count` and `last_seq`, kept in the
same transaction as each reply, so the thread list is one indexed read. A deleted post keeps its
row as a tombstone (`deleted_at` set, subject and body erased) so replies keep their place.
```sql
```

## Rings
Built (migration 0011): `ring_members.status` also has `invited`; `ring_members.nav_detected_at` records when the nav
bar was last seen on the member's page; `rings.board_id` is set as the ring is founded; `banner_path` is not built yet;
`flagged_dead` is computed from `nav_detected_at` and the homepage, not stored.
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
audit_log (id bigserial pk, actor_id null, actor_kind,   -- user|system|cli
           action, target_type, target_id,
           before jsonb, after jsonb, origin, ip_hash, created_at)   -- app role: INSERT only
settings (key pk, value jsonb, version int)
settings_history (id, key, version, value jsonb, changed_by, reason, created_at)
announcements (id, body, channels text[], starts_at, ends_at, created_by)
notifications (id, user_id, kind, payload jsonb, read_at)
exports (id, user_id, status, path, size_bytes, expires_at)
imports (id, user_id, sha256, created_at, applied_at, summary)   -- uploaded archives; brought back once
jobs (id, kind, status, attempts, payload jsonb, result jsonb, run_at)
oidc_payloads (id, type, payload jsonb, grant_id, user_code, uid, account_id, expires_at, consumed_at)
                                   -- the OIDC provider's own records; pk (id, type); account_id lets a suspension revoke them
oidc_keys (kid pk, alg, private_jwk_enc, created_at)   -- signing keys, encrypted; newest signs
events_outbox (id bigserial pk, event_id unique, type, payload jsonb, created_at, published_at)
                                   -- written with the change, published to Redis by a relay (docs/14)
metrics_rollup (metric, bucket timestamptz, value double precision)  -- console charts
```
Presence lives in Redis: `presence:{user_id}` → services + since.

M7 tables (migrations 0021–0024):
```
mail_threads (id mt_, subject, created_by, created_at, last_message_at)
mail_participants (thread_id, user_id, joined_at, left_at, last_read_at)   -- newcomers read from joined_at
mail_messages (id mm_, thread_id, author_id?, kind message|joined|left, body, created_at, deleted_at)
user_blocks (user_id, blocked_id, created_at)
vouches (id vo_, candidate_id, voucher_id, note, created_at, withdrawn_at, outcome confirmed|declined, decided_at, decided_by)
sponsor_flags (id sf_, vouch_id unique, voucher_id, candidate_id, reason demoted|suspended, created_at)
file_areas (id fa_, slug, name, description, visibility public|members, upload_role user|trusted|admin, archived_at)
files (id f_, area_id, uploader_id?, name, title, description, size_bytes, sha256, downloads, hidden_at, deleted_at)
                                   -- the bytes are FILES_DIR/{id}
activity_days (user_id, day, services[])   -- stats only; one row per person per day (0024)
mud_characters gains tower_season, tower_best, tower_checkpoint (0035)   -- the tower climb, copied from the MUD (`18`)
client_settings (user_id, client chat|mud, data jsonb, updated_at; PK user_id+client)
                                   -- a client's account-kept settings, validated by zod in @app/shared (0034); exported, imported, erased
```

## Installable apps (0037, docs/10)
- `app_catalog(app_id, version, manifest, offered, present)`: the packages in `APPS_DIR`, synced at start. Not anyone's content.
- `app_installs(user_id, app_id, installed_at)`: who added what.
- `app_data(user_id, app_id, collection, doc_id, data jsonb, bytes)`: everything any app keeps for a person, keyed by stable user id; exported, imported and erased with the account.

## Studio preview (0038, docs/07)
- `home_previews(user_id pk, token, path, body, updated_at)`: the unsaved text being previewed. Ten minutes of life, one row per person.

## Wiki (0042, docs/20)
- `wikis(id, scope_type site|ring, ring_id, enabled)`: one site row (`wk_site`), at most one per ring.
- `wiki_pages(id, wiki_id, slug, title, body, body_tsv, revision, protected, created_by, updated_by, hidden_at, deleted_at)`, unique `(wiki_id, slug)`.
- `wiki_revisions(id, page_id, revision, editor_id, title, body, summary, reverted_to, text_hidden_at)`: every save; `editor_id` becomes null when the account is deleted.
- `wiki_redirects(wiki_id, slug, page_id)` and `wiki_links(page_id, target_slug, target_title)`: derived, rebuilt on save and rename.
- `reports.target_type` gains `wiki_page`.

## Wallpaper (0043, docs/10)
- `users.wallpaper` holds a pattern name, `preset:{id}` or `own`; NULL means never chosen, which shows the site's
  default (`ui.default_wallpaper`). A preset the operator has taken out of `ui.wallpapers` also shows the default.
- `users.wallpaper_fit` is `cover`, `tile` or `center`.
- `users.wallpaper_at` is when their own picture was set (NULL when there is none). The file is
  `{filesDir}/wallpapers/{user id}.webp`.
- `users.wallpaper_url` is where the picture was copied from, if it came from a web address.

## Invariants (enforce and test)
- Board/ring ownership requires `trusted` or `admin` at creation; quotas checked at creation.
- Every ring has exactly one board (`rings.board_id` not null after creation).
- `audit_log` is append-only: triggers refuse UPDATE, DELETE and TRUNCATE (see `15` for the
  matching database grants). `admin_notes` will follow the same rule when it exists.
- Every content table is registered with an exporter (`12`).

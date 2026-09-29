# 02 — Accounts & Identity

## Goals
- One account per person, used by every service.
- Identity that survives renames and, later, a move to self-hosting.
- Works for web users and for native clients (telnet, SSH, IRC, MUD).

## Identity model
- **User ID** — stable, permanent, internal (`u_` + ULID). Everything a user owns is keyed
  by this, never by handle. (DECIDED principle: stable IDs.)
- **Handle** — unique, case-insensitive, 2–20 chars `[A-Za-z0-9_-]`, starts with a letter.
  Max 20 fits IRC nick limits.
- **Display name** — optional, freeform.
- **User keypair** (PROPOSED) — Ed25519, generated at signup, private key held by the site
  (encrypted) with an option to download it. Used to sign exports and, later, to prove
  "same person" after moving to a self-hosted node or federated network. See `12`.
- **Reserved handles**: admin, root, sysop, guest, all, postmaster, abuse, support, service
  bot names, the site short name.
- **Renames**: user can rename once per 90 days (PROPOSED); old handle kept as a redirecting
  alias for 90 days and then released. IRC and MUD are renamed via events; boards and the BBS read handles from core.

## Signup
- Modes (admin setting): **open**, **invite** (PROPOSED default at launch), **application**
  (short "why do you want in", admin/op review — very BBS).
- Email required (reset, abuse contact). Minimum age: OPEN (legal — see `15`).
- New accounts start as **guest** until email verified and (if application mode) approved,
  then become **user**.
- Password: argon2id, 10–128 characters, no composition rules (length is what counts).
  TOTP is optional for users and **required for admins** (below). Passkeys later.
- **Invite codes**: `XXXX-XXXX-XXXX`, single use, 14 days by default, created by admins.
  Unknown, used and expired codes all give the same error so codes can't be probed.
- **Application mode is not built yet.** It needs the review queue in the admin console;
  until then the API says so plainly.
- Signup tells you when an email is already registered (`email_taken`). That lets someone probe
  for accounts, which is acceptable while signup is invite-only; revisit before opening signup.

## Sessions, CSRF and admin 2FA (built in M1)
- **Sessions**: a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when the
  site is served over https), valid 30 days. Only its sha256 is stored. Logout, suspension and
  `reset-totp` revoke sessions server-side. IPs are stored only as keyed hashes.
- **CSRF**: a state-changing request whose `Origin` isn't the site is refused, and so is a
  cookie-bearing one with no `Origin` at all. Plain API clients with no cookie are unaffected.
- **Rate limits**: login (per address and account), signup, verification and TOTP calls.
  In-memory for now, so they are per instance; move to Redis before running more than one core.
- **Admin 2FA**: an admin who has no TOTP gets a *limited* session that can only reach `/me`
  and the TOTP setup calls. Once they confirm a code the limit is lifted. Every later login needs
  a code. The TOTP secret is encrypted at rest with `APP_SECRET_KEY`.
- **Bootstrap and recovery** are operator commands run on the server (`apps/core` `cli`):
  `create-admin --handle … --email …` (password from `ADMIN_PASSWORD`, or generated and shown
  once) and `reset-totp --handle …` (clears TOTP and signs the admin out everywhere).
- **TOTP is single-use.** The 30-second time step of each accepted code is stored, and a code
  from that step or an earlier one is refused (`totp_reused`). This holds under concurrent
  requests: two logins with one code, only one succeeds.
- **Recovery codes.** Turning on TOTP shows 10 single-use codes (`k3m9x-2qf7a`) once. Only
  hashes are stored. A code can be used in place of a TOTP code at login (`recovery_code`).
  Regenerating a set needs a current authenticator code and voids the old set. `/me` reports
  how many are left.
- **Password reset.** `forgot-password` always answers 204, whether or not the email has an
  account, and the mail is sent in the background so timing doesn't give it away. The link works
  for 1 hour and once; only the newest link works. Resetting signs the user out everywhere,
  sends a "your password was changed" notice, and does **not** turn off two-factor: an admin
  who resets their password still needs their code (or a recovery code) to log in.
- **Not built yet**: changing your password while logged in (`PUT /me/password`), and
  disabling TOTP by choice.

## Single sign-on
core is an **OIDC provider** (PROPOSED: `node-oidc-provider`). Token claims:
```json
{
  "sub": "u_01J…",
  "handle": "zerocool",
  "display_name": "Dade",
  "role": "trusted",          // guest | user | trusted | admin
  "role_rev": 7,              // increments on any role/op change
  "ops": ["board:b_12", "ring:r_3", "channel:#synths"]
}
```
Short-lived access tokens (15 min), rotating refresh tokens.

## How each service authenticates
| Service | Web (in the shell) | Native client |
|---|---|---|
| Shell / boards / homepage studio | OIDC code + PKCE, session cookie | — |
| BBS (last milestone, `04`) | one-time **login ticket** redeemed against core on WebSocket connect | telnet/SSH with **terminal password** or **SSH key** |
| IRC | web client SASL with short-lived token | SASL PLAIN with terminal password |
| MUD | login ticket on WebSocket connect | `connect <handle> <terminal password>` |

### Terminal password (PROPOSED)
A separate password for native clients, because telnet sends it in cleartext. Leaking it
doesn't expose the web account or email. Set in Settings. SSH keys for BBS SSH.
core exposes a private `verify` endpoint; services never store their own copy.

## Provisioning into services
| Event | BBS | IRC | MUD |
|---|---|---|---|
| `user.created` | nothing (reads core) | create account | create account |
| `user.role_changed` / `user.ops_changed` | live sessions pick up the new role | oper / channel access | permission level |
| `user.suspended` | drop sessions | lock + kill | lock + disconnect |
| `user.renamed` | nothing (reads core) | rename account | rename |
| `user.deleted` | drop sessions | drop | archive |

The BBS holds no copy of users, so it has nothing to provision. IRC and MUD hooks are
idempotent; a nightly **reconcile** job compares core users with each of them and fixes
drift, reporting to the admin console.

## Account deletion
User can export (`12`) then delete. Posts remain but author shows as "deleted user"
(PROPOSED) unless the user chose "remove my posts" where technically possible (local boards
only — posts already mirrored off-site in future federation can't be recalled).

## Acceptance tests
- Sign up in the shell → open the Chat window → logged in with no prompt. (BBS and MUD
  windows are covered by their own milestones' tests.)
- Admin promotes a user → IRC and MUD reflect it within 5 s.
- Suspend → sessions in all services drop within 5 s.
- Rename → old handle redirects; all services show the new handle.

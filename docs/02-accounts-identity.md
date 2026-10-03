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
  Built 2026-10-03:
  - **Settings → Email and handle**, `POST /me/handle {password, handle}`, using the admin rename underneath.
  - Renames someone makes themselves are marked in `handle_history.by_user`, and only those count toward the 90 days. An admin's rename doesn't, and a change of letter case never does.
  - `GET /me/handle` says when the next change is possible.

## Signup
- Modes (admin setting): **open**, **invite** (PROPOSED default at launch), **application**
  (short "why do you want in", admin/op review — very BBS).
- Email required (reset, abuse contact). Minimum age: DECIDED (2026-09-30) — `signup.minimum_age` (default 16, an admin setting; 0 turns it off). Signup shows a tick-box "I am at least N years old"; the server refuses without it and records `users.age_confirmed_at` and the minimum in force (also in the `user.created` audit entry). No birthdate is collected.
- New accounts start as **guest** until email verified and (if application mode) approved,
  then become **user**.
- Password: argon2id, 10–128 characters, no composition rules (length is what counts).
  TOTP is optional for everyone; a site can require it for admins (below, decided 2026-10-02). Passkeys later.
- **Invite codes**: `XXXX-XXXX-XXXX`, single use, 14 days by default, created by admins.
  Unknown, used and expired codes all give the same error so codes can't be probed.
- **Application mode is not built yet.** It needs the review queue in the admin console;
  until then the API says so plainly.
- **From the terminal** (built 2026-10-02, `04`):
  - Type `new` at the BBS handle prompt, or log in over SSH as the user `new`.
  - The rules are the same as the web: mode, invite, the age question, handle, email and password. The terms of service can be read as text, and the caller must agree to them and the privacy policy.
  - The terminal password is set at the same time and must differ from the website one.
  - Telnet callers are told plainly that what they type is not encrypted.
  - The confirmation email carries a six-digit code as well as the link. The code is stored hashed, works for 24 hours, and stops working after 5 wrong tries.
  - Typing the code confirms the account and signs the caller in. A new code can be sent, three an hour.
  - Three new accounts an hour per caller address. The `user.created` audit entry has origin `bbs`.
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
- **Admin 2FA** (optional since 2026-10-02): two-factor is optional for admins too, unless the site turns on
  `security.require_admin_2fa` in the console (off by default; turning it on shows how many admins it affects). When it
  is on, an admin who has no TOTP gets a *limited* session that can only reach `/me`
  and the TOTP setup calls. The admin status page mentions admins without two-factor either way. Once they confirm a code the limit is lifted. Every later login needs
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
- **Changing your password** (`PUT /me/password`) needs the current one, signs out every *other*
  session, ends the grants services hold, audits it and sends a notice. This session stays signed in.
- **Turning two-factor off** (built 2026-10-03): `POST /me/totp/disable` needs the password and a current code or a recovery code.
  - It clears the secret and the recovery codes, signs out the other sessions, audits `user.totp_disabled` and emails the person.
  - An admin can't turn it off while the site requires admin two-factor (`totp_required_here`).
- **Changing your email** (built 2026-10-03): `POST /me/email {password, email}` stores the change in `email_changes` and mails a link to the new address (24 hours, once; only the newest works).
  - The old address is told, with the new one masked (`n•••@example.org`).
  - Nothing changes until the link is opened (`POST /auth/confirm-email`, which works signed in or not), so a typo can't lock anyone out.
  - Audited as `user.email_change_requested` and `user.email_changed`, with masked addresses.

## Roles, ops and `role_rev` (built in M1)
- An admin changes a role with a reason (`POST /admin/users/:id/role`). Role, ops and suspension
  changes are audited with before and after, and they publish an event (`14`).
- `role_rev` goes up on **any** role or ops change, so a service holding an old claim can tell it
  is stale. Events carry it too, and consumers should ignore one that is older than what they have.
- Guardrails: an admin cannot change their own role or suspend themselves (so the site can't be
  left without an admin), and `trusted` or `admin` needs a confirmed email address.
- Roles are read from the database on every request, so a change applies to sessions that are
  already logged in. When the site requires admin two-factor, someone promoted to admin mid-session is *limited* until they set up TOTP.
- Ops (`scoped_roles`) are granted by admins for now, to any user, not only trusted ones. They
  show up as `ops` claims like `board:b_…`, `ring:r_…`, `channel:#synths`. Existence checks for
  boards and rings arrive with M2 and M3; until then only the ID's shape is checked.

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

### The provider (built in M1)
core runs the provider at `{site.domain}/oidc` (`node-oidc-provider`, discovery at
`/oidc/.well-known/openid-configuration`). Nothing consumes it until IRC (M5), but the contract is fixed now.
- **Flow**: authorization code with **PKCE (S256) required for every client**. The implicit and
  hybrid flows, dynamic client registration and the device flow are off.
- **Clients** are the site's own services, listed under `oidc.clients` in the site config and
  all first-party, so there is no consent screen. A public client (a browser app) has no
  secret; a confidential client (a server) authenticates with `OIDC_SECRET_<CLIENT_ID>` from the
  environment. Core refuses to start if a confidential client's secret is missing or short.
- **Scopes**: `openid`; `profile` (`handle`, `display_name`); `site` (`role`, `role_rev`, `ops`);
  `offline_access` for a refresh token (send `prompt=consent` with it).
- **Tokens**: the ID token holds the claims, so a service can verify it offline against `/oidc/jwks`
  (ES256; keys are created once, stored encrypted, and rotation is not built yet). Access tokens
  are opaque and last 15 minutes; `/oidc/me` returns the same claims **fresh from the database**,
  and confidential clients can introspect at `/oidc/token/introspection`. Refresh tokens last 30 days
  and **rotate**: using an old one again ends the whole grant.
- **Signing in** happens on the site, not at the provider. The provider sends the browser to
  `/api/v1/oidc/interaction/:uid`; with a site session it is confirmed, without one the browser goes to
  `/login?return_to=…` and comes back. A limited session (admin without TOTP) does not count.
- **One person per browser**: a sign-in is re-confirmed whenever the site session is missing or is a
  different account from the provider's own browser session. Someone who logs out and lets another
  person log in is not silently signed in to IRC as the first person. When the account changes, the
  provider ends the old browser session (and revokes its grant) through `/oidc/session/end`.
- **Revocation**: suspending a user, resetting their password or resetting their TOTP also deletes
  every OIDC grant and token they hold (and publishes `session.revoked`). Plain logout from the
  site does **not**: leaving the website shouldn't disconnect IRC. `findAccount` refuses a
  non-active user independently, so a suspended user can't refresh even if a grant survived.
- **Not enforced yet**: `prompt=login` and `max_age` from a client are ignored; the site session
  is the login and there is no re-authentication step (Q16 in `17`).

## How each service authenticates
| Service | Web (in the shell) | Native client |
|---|---|---|
| Shell / boards / homepage studio | OIDC code + PKCE, session cookie | — |
| BBS (last milestone, `04`) | one-time **login ticket** redeemed against core on WebSocket connect | telnet/SSH with **terminal password** or **SSH key** |
| IRC | web client SASL with short-lived token | SASL PLAIN with terminal password |
| MUD | login ticket on WebSocket connect | `connect <handle> <terminal password>` |

### Terminal password (DECIDED, built in M5)
A separate password for native clients, because telnet sends it in cleartext. Leaking it
doesn't expose the web account or email. Set in Settings → Terminal password (needs the website
password; it must differ from it; argon2id; set and remove are audited; an admin can remove one with
a reason). SSH keys for BBS SSH come with the BBS.
core exposes a private `verify` endpoint (`/internal/irc/auth` for IRC); services never store their own copy.

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

**IRC as built (M5, `08`):** there is no per-event handler. Ergo creates an account at first login
(core checks the password); a suspension or a rename's held old handle becomes `NS SUSPEND`, which
drops every session at once; roles and ops become channel modes. All of it is one reconcile that events
trigger within a moment and that also runs every 30 s (fully every 6 hours). Admins are not IRC opers
(Ergo cannot map opers to accounts); they get channel ops and moderate from the console.

**MUD as built (M6, `09`):** Evennia creates the account at first login (core checks the password or MUD
ticket) and keys it by core's user id. Core pushes every person's handle, status, role and builder flag on
relevant events and every five minutes: renames and roles apply, suspended people are disconnected at once,
and a deleted person's account and characters are deleted.

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

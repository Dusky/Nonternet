# 02 — Accounts & Identity

## Goals
- One account per person, used by every service.
- Identity that survives renames and, later, a move to self-hosting.
- Works for web users and for native clients (telnet, SSH, IRC, MUD).

## Identity model
- **User ID** — stable, permanent, internal (`u_` + ULID). Everything a user owns is keyed
  by this, never by handle. (DECIDED principle: stable IDs.)
- **Handle** — unique, case-insensitive, 2–20 chars `[A-Za-z0-9_-]`, starts with a letter.
  Max 20 fits IRC nick limits and FTN name fields.
- **Display name** — optional, freeform.
- **User keypair** (PROPOSED) — Ed25519, generated at signup, private key held by the site
  (encrypted) with an option to download it. Used to sign exports and, later, to prove
  "same person" after moving to a self-hosted node or federated network. See `12`.
- **Reserved handles**: admin, root, sysop, guest, all, postmaster, abuse, support, service
  bot names, the site short name.
- **Renames**: user can rename once per 90 days (PROPOSED); old handle kept as a redirecting
  alias for 90 days and then released. Enigma/IRC/MUD renamed via events.

## Signup
- Modes (admin setting): **open**, **invite** (PROPOSED default at launch), **application**
  (short "why do you want in", admin/op review — very BBS).
- Email required (reset, abuse contact). Minimum age: OPEN (legal — see `15`).
- New accounts start as **guest** until email verified and (if application mode) approved,
  then become **user**.
- Password: argon2id. Optional TOTP. Passkeys later.

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
| BBS | one-time **login ticket** redeemed by the bridge on WebSocket connect | telnet/SSH with **terminal password** or **SSH key** |
| IRC | web client SASL with short-lived token | SASL PLAIN with terminal password |
| MUD | login ticket on WebSocket connect | `connect <handle> <terminal password>` |

### Terminal password (PROPOSED)
A separate password for native clients, because telnet sends it in cleartext. Leaking it
doesn't expose the web account or email. Set in Settings. SSH keys for Enigma SSH.
core exposes a private `verify` endpoint; services never store their own copy.

## Provisioning into services
| Event | Enigma bridge | IRC | MUD |
|---|---|---|---|
| `user.created` | create user, map role → groups | create account | create account |
| `user.role_changed` / `user.ops_changed` | update groups/ACS | oper / channel access | permission level |
| `user.suspended` | disable + kick | lock + kill | lock + disconnect |
| `user.renamed` | rename (VERIFY supported) | rename account | rename |
| `user.deleted` | disable + anonymize (keep message history) | drop | archive |

Bridges are idempotent; a nightly **reconcile** job compares core users with each service
and fixes drift, reporting to the admin console.

## Account deletion
User can export (`12`) then delete. Posts remain but author shows as "deleted user"
(PROPOSED) unless the user chose "remove my posts" where technically possible (local boards
only — posts already mirrored off-site in future federation can't be recalled).

## Acceptance tests
- Sign up in the shell → open the BBS window → logged in with no prompt.
- SSH with a registered key → same Enigma account, same read pointers.
- Admin promotes a user → Enigma, IRC and MUD reflect it within 5 s.
- Suspend → sessions in all services drop within 5 s.
- Rename → old handle redirects; all services show the new handle.

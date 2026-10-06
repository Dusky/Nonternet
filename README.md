# Nonternet

> **"Nonternet" is a working title.** We'll pick the real name once we know which domain we can get. The name and
> domain live in one place, the site config, and nothing else is allowed to hard-code them (see `CLAUDE.md`).

Remember when the internet was a handful of places you actually hung out? A BBS you dialled into, an IRC channel that
was always on, a MUD where your friends were, a homepage you built yourself out of tiles and a visitor counter. This is
that, all in one site, with one login.

You get boards, chat, a MUD, a terminal BBS, a wiki and your own homepage, all inside a web desktop that feels a bit
like an old OS (windows, a taskbar, themes) but works fine on a phone. People gather in **rings**, named after
webrings: each ring has its own board, chat channel and a nav bar that links its members' homepages together.

Whatever you make here is yours. One click exports all of it in plain, open formats, and you can bring an export back
in. Nobody has to run a server to join; one team runs the site for everyone.

![The desktop: the BBS in a Terminal window next to a board](docs/screenshots/desktop.webp)

![The front page for visitors who aren't signed in](docs/screenshots/front.webp)

## What's in it

- **The desktop.** Apps open as windows you can drag, snap and resize. There's a command palette (Ctrl+K), five
  themes, a wallpaper of your own, and a proper phone layout. It installs as an app and can send push notifications.
- **Boards and rings.** Threaded boards with editing, pins, reactions and search, updating live. Rings bundle a board,
  a chat channel and a homepage nav bar.
- **Homepages.** Your own little website, Geocities style, with an editor that previews as you type, widgets,
  guestbooks, an 88×31 button maker and custom domains. Homepages run on their own domain, so nothing on them can touch
  your account.
- **Chat.** A real IRC server (Ergo) that knows your account, and a chat window in the site.
- **The MUD.** A tower that's generated fresh every season, with floors to climb, gear to find and a leaderboard.
  Built on Evennia; you can play from the site or any MUD client.
- **The BBS.** Telnet, SSH or the Terminal window: oneliners, bulletins, polls, door games and QWK offline mail.
- **Wiki.** One for the site, and one for any ring that wants it, with history, diffs and edit-conflict handling.
- **The old protocols.** Read-only Gopher and Gemini mirrors of the public parts, finger with your `.plan`, and Atom
  feeds.
- **Mail and people.** Private messages and small group threads, profiles, a directory and notifications.
- **Apps.** Add small extras to your desktop (there's a to-do list to start with). They run sandboxed and keep only
  their own data.
- **Sign-in.** Passwords, passkeys and optional two-factor. One account works for the site, chat, the MUD and the BBS.
- **Running it.** An admin console (status, users, moderation, audit log, backups, updates) and `deploy/sitectl` for
  installing, backing up, testing restores and upgrading.

**Coming next:** bookmarks (save and share links, like Linkding) and a private-by-default memo feed, so the signed-in
front page can be your browser's home page. The plans are in `docs/21-bookmarks.md` and `docs/22-memos.md`.

## Where it stands

Everything planned for the first version is built and tested together, plus a fair bit more. What's left before
opening to the public isn't code: the real name and domain, a lawyer's look at the legal pages, funding, and real DNS
and email. `docs/16-roadmap.md` lists what was built and in what order, and `docs/17-decisions.md` explains why things
are the way they are and what's still undecided.

## See it without setting anything up
```sh
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres scripts/demo.sh
```
Builds if needed, boots a throwaway copy of the whole site (core, shell, homepages, the BBS,
and chat and the MUD if `ergo` and `evennia` are on your `PATH`), fills it with a small
believable community, and prints the address and the logins. Ctrl+C throws it all away. The
seed is `pnpm --filter @app/core cli seed-demo` (it refuses to run in production).

## Run it with Docker
The whole stack: Postgres, Redis, core, the shell, homepages, the BBS, Gopher, finger, Gemini, the MUD, Ergo and
Caddy. This is the local setup; production adds TLS and hardening (below).
```sh
cp deploy/.env.example deploy/.env      # then fill in the five secrets: openssl rand -hex 24 for POSTGRES_PASSWORD,
                                        # openssl rand -base64 32 for APP_SECRET_KEY, IRC_SECRET, MUD_SECRET and BBS_SECRET
docker compose -f deploy/compose.yaml --env-file deploy/.env up --build
# then open http://localhost:8080 (the first start of the MUD takes a minute or two)
docker compose -f deploy/compose.yaml --env-file deploy/.env exec core node cli.cjs create-admin --handle you --email you@example.net
```
Verification links are printed in core's log until `SMTP_URL` is set. Two-factor sign-in is optional
(an admin can make it required for admins in the console). Homepages are at `http://{handle}.homes.localhost:8081/`:
browsers send every `*.localhost` name to your own machine, so that works with no setup in Chrome and Firefox (Safari
needs a line like `127.0.0.1 you.homes.localhost` in `/etc/hosts`). A real site sets its own `homes_domain` in its
site config; `./sitectl doctor` refuses the local default. This stack was run end to end and checked (sign-in, all three WebSocket
routes, restarts, backup and restore); what that did and did not cover is in `docs/17-decisions.md`.

## Run it for development
Needs Node 22, pnpm 10, a Postgres you can create databases on, and optionally a Redis.
```sh
pnpm install
export SITE_CONFIG=deploy/site.example.yaml
export DATABASE_URL=postgres://user:pass@localhost:5432/app     # migrations run at startup
export APP_SECRET_KEY=$(openssl rand -base64 32)
export REDIS_URL=redis://localhost:6379                         # optional; without it events wait in the outbox
pnpm --filter @app/core cli create-admin --handle you --email you@example.net
pnpm dev:core        # core on :3000
pnpm dev:shell       # the shell on :5173, which proxies /api to core
```
Environment variables are listed in `docs/15-ops-hosting-security.md`.

The product name and domains live only in the site config (`deploy/site.example.yaml`). Point
`SITE_CONFIG` at your own copy to rebrand. `tests/placeholder-name.test.ts` fails if the
configured name appears anywhere else in source or built output.

## Tests
```sh
pnpm typecheck && pnpm build
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm test
```
The integration tests create a throwaway database each. Without `TEST_DATABASE_URL` the database
tests are skipped, and the run says so. CI sets `REQUIRE_DB`, `REQUIRE_REDIS`, `REQUIRE_BUILD`,
`REQUIRE_ERGO` and friends so nothing is skipped silently.

- **Chat and the MUD** are tested against the real servers. Put `ergo` on the `PATH` (or set
  `ERGO_BIN`) and set `EVENNIA_BIN` to an `evennia` from a virtualenv with
  `services/mud/requirements.txt` installed.
- **The MUD's own tests:** `cd services/mud && evennia test --settings settings.py tests`.
- **End to end** (Chromium at a desktop and a phone size, with accessibility checks in each theme):
  ```sh
  pnpm build
  TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm test:e2e
  ```
  The tests start core, the homes server, the BBS and the shell themselves (ports 3373, 4374, 4373 and
  6570) with `RATE_LIMIT=off`, and map `*.e2e-homes.test` and `*.e2e-custom.test` to this machine inside the
  test browser. That setting exists for tests only, and core refuses to start with it in production.
- **A walkthrough as a stranger** (screenshots and video of a newcomer, a player and an admin):
  `WALKTHROUGH=/some/dir pnpm test:e2e walkthrough`.
- **Load:** `scripts/load-test.mjs` and `scripts/sse-load.mjs` (open live-update streams) for a real site.

## Put it on a server
`docs/19-operating.md` is the guide: DNS, ports, the production `.env`, then `deploy/sitectl`
(`doctor`, `up`, `backup`, `restore-test`, `upgrade`). `docs/15-ops-hosting-security.md` has the design
behind it.

## Document index

| # | Document | Covers |
|---|----------|--------|
| — | [`CLAUDE.md`](CLAUDE.md) | Rules and conventions for Claude Code |
| 00 | [Vision, Vocabulary & Voice](docs/00-vision.md) | What, why, principles, non-goals, words we use, how we write |
| 01 | [Architecture](docs/01-architecture.md) | Components, stack, repo layout, networking |
| 02 | [Accounts & Identity](docs/02-accounts-identity.md) | Signup, login, SSO across services, stable IDs, keys |
| 03 | [Roles & Moderation](docs/03-roles-moderation.md) | guest/user/trusted/admin, ops, reports, audit log |
| 04 | [BBS](docs/04-bbs.md) | The in-house terminal BBS |
| 05 | [Boards](docs/05-boards-web.md) | Boards stored in core, with the web reader and composer |
| 06 | [Rings](docs/06-rings.md) | User-formed groups: board + channel + homepage nav |
| 07 | [Homepages](docs/07-homepages.md) | Personal static sites, widgets, directory, custom domains |
| 08 | [IRC](docs/08-irc.md) | IRC server and web chat client |
| 09 | [MUD](docs/09-mud.md) | One shared world |
| 10 | [Web Shell & UI](docs/10-web-shell.md) | Desktop-style launcher, windows, themes, mobile |
| 11 | [Admin Console](docs/11-admin-console.md) | The deliberately over-engineered control room |
| 12 | [Ownership & Export](docs/12-ownership-export.md) | Export format, portability, the path to self-hosting |
| 13 | [Data Model](docs/13-data-model.md) | Core database schema |
| 14 | [Core API](docs/14-api.md) | HTTP API, realtime, internal events |
| 15 | [Ops, Hosting & Security](docs/15-ops-hosting-security.md) | Deployment, quotas, backups, legal/abuse, hardening |
| 16 | [Roadmap](docs/16-roadmap.md) | Milestones, tasks, acceptance criteria, what is built |
| 17 | [Decisions & Open Questions](docs/17-decisions.md) | Decision log, open questions, things found and verified |
| 18 | [MUD world](docs/18-mud-world.md) | The world's design and what was built in it |
| 19 | [Operating the site](docs/19-operating.md) | Putting it on a server and keeping it running |
| 20 | [Wiki](docs/20-wiki.md) | The site wiki and ring wikis |
| 21 | [Bookmarks](docs/21-bookmarks.md) | Saving and sharing links (planned) |
| 22 | [Memos](docs/22-memos.md) | A private-by-default memo feed (planned) |

## Status tags
Used in the docs, and binding on anyone changing the code:
- **DECIDED**: agreed. Change only by updating `17-decisions.md`.
- **PROPOSED**: a recommended default. Build it this way unless there's a good reason; log changes.
- **OPEN**: undecided. Don't pick silently; raise it.
- **VERIFY**: depends on a third-party fact that must be checked against current docs or source.

## Still open
- **Before opening:** the real name and domain (Q1), legal review (Q7), funding (Q8), real DNS and email,
  and `./sitectl doctor` on the real server. TLS on a real domain, wildcard homepage domains and real SMTP
  have not been run (V11).
- **Left for later, on purpose:** Q16, federation and self-hosting (Q12, Q17), outside authors for apps (Q18), ZMODEM,
  and auditing every in-game builder command (removing notes and guestbook lines is audited).

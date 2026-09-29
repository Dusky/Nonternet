# Nonternet — Planning Docs

> **"Nonternet" is a placeholder name.** The final name depends on which domain is
> available. The name and domain must be changeable in one place — see `CLAUDE.md`.

Nonternet is a hosted, one-stop "old internet" service. It is **one big site** run by a
single admin team, where users get a real BBS, IRC, a shared MUD and Geocities-style
homepages behind one login and one retro-styled web interface. Users organize themselves
into **rings** — groups modeled on old webrings, each with its own board, chat channel and
homepage nav bar.

Users **own their stuff**: everything is exportable in open formats from day one, and the
design leaves room for self-hosting and federation later — but nobody needs to run a server
to take part.

These documents are the spec for building it with Claude Code.

## Document index

| # | Document | Covers |
|---|----------|--------|
| — | [`CLAUDE.md`](CLAUDE.md) | Rules and conventions for Claude Code |
| 00 | [Vision, Vocabulary & Voice](docs/00-vision.md) | What, why, principles, non-goals, words we use, how we write |
| 01 | [Architecture](docs/01-architecture.md) | Components, stack, repo layout, networking |
| 02 | [Accounts & Identity](docs/02-accounts-identity.md) | Signup, login, SSO across services, stable IDs, keys |
| 03 | [Roles & Moderation](docs/03-roles-moderation.md) | guest/user/trusted/admin, ops, reports, audit log |
| 04 | [BBS](docs/04-bbs.md) | The in-house terminal BBS (last milestone) |
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
| 16 | [Roadmap](docs/16-roadmap.md) | Milestones, tasks, acceptance criteria |
| 17 | [Decisions & Open Questions](docs/17-decisions.md) | Decision log, open questions, things to verify |

## Status tags
- **DECIDED** — agreed in planning. Change only by updating `17-decisions.md`.
- **PROPOSED** — recommended default. Build it this way unless there's a good reason; log changes.
- **OPEN** — undecided. Don't pick silently; raise it.
- **VERIFY** — depends on a third-party fact that must be checked against current docs/source.

## v1 at a glance
Accounts + web shell + boards + rings + homepages + export + admin console. IRC and the MUD
follow. The terminal BBS, built in-house, comes last. Federation and self-hosting are later
phases.

## Getting started (development)
Needs Node 22, pnpm 10, a Postgres you can create databases on, and a Redis.

```sh
pnpm install
pnpm typecheck && pnpm build
# The integration tests create a throwaway database each and use their own Redis stream
# names. CI sets REQUIRE_DB, REQUIRE_REDIS and REQUIRE_BUILD so nothing is skipped silently.
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres \
TEST_REDIS_URL=redis://localhost:6379 pnpm test
```
Without those variables the database and event bus tests are skipped, and the run says so.

End-to-end tests drive the built site in Chromium (a desktop and a phone size):
```sh
pnpm build
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres \
TEST_REDIS_URL=redis://localhost:6379 pnpm test:e2e
```
They start core and the shell themselves on ports 3373 and 4373 with `RATE_LIMIT=off`.
That setting exists for tests only, and core refuses to start with it in production.

Run it locally (core on :3000, shell on :5173, which proxies `/api` to core):
```sh
export SITE_CONFIG=deploy/site.example.yaml
export DATABASE_URL=postgres://user:pass@localhost:5432/app     # migrations run at startup
export APP_SECRET_KEY=$(openssl rand -base64 32)
export REDIS_URL=redis://localhost:6379                         # optional; without it events wait in the outbox
pnpm --filter @app/core cli create-admin --handle you --email you@example.net
pnpm dev:core        # verification links are printed in this log until SMTP_URL is set
pnpm dev:shell
```
The first admin login asks for two-factor setup. Environment variables are listed in
`docs/15-ops-hosting-security.md`.

The product name and domains live only in the site config (`deploy/site.example.yaml`). Point
`SITE_CONFIG` at your own copy to rebrand. `tests/placeholder-name.test.ts` fails if the
configured name appears anywhere else in source or built output.

Compose stack (Postgres, Redis, core, shell, Caddy):
```sh
cp deploy/.env.example deploy/.env      # set POSTGRES_PASSWORD and APP_SECRET_KEY
docker compose -f deploy/compose.yaml --env-file deploy/.env up --build
# then open http://localhost:8080
```

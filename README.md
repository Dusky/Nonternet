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
| 04 | [BBS: Enigma½ Integration](docs/04-bbs-enigma.md) | Embedding Enigma, the bridge, terminal access |
| 05 | [Boards Web View](docs/05-boards-web.md) | Modern web reader/composer over the same message base |
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
Accounts + web shell + Enigma BBS (terminal and web view) + rings + homepages + export +
admin console. IRC and the MUD follow. Federation and self-hosting are later phases.

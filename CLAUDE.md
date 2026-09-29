# CLAUDE.md — Instructions for building Nonternet

You are building Nonternet from the planning docs in `docs/`. Treat them as the spec.

## Read first
1. `docs/00-vision.md` — what we're building, vocabulary, voice
2. `docs/01-architecture.md` — components and repo layout
3. `docs/17-decisions.md` — what's settled, open, and unverified
4. `docs/16-roadmap.md` — current milestone and acceptance criteria
5. The doc for the component you're working on

## The name is a placeholder
"Nonternet" and its domain will change. Therefore:
- **Never hard-code the product name or domain** in code, templates, UI strings, emails,
  ANSI art or tests. Read them from config: `site.name`, `site.short_name`, `site.domain`,
  `site.homes_domain`.
- Code identifiers, package names and Docker service names use neutral names
  (`core`, `shell`, `@app/shared`), not the product name.
- BBS art, MOTD and login screens are rendered from templates with the name substituted
  at build/config time, or live in a replaceable art pack.
- A test must grep the built output and fail if the literal placeholder name appears
  outside config/fixtures.

## Ground rules
- **Respect status tags.** DECIDED is binding; PROPOSED is the default; OPEN must not be
  decided silently — stop and ask or leave a marked TODO.
- **VERIFY before relying** on any claim about Ergo, Evennia, etc. If reality differs,
  update the doc and log it in `17-decisions.md`.
- **Boards and posts live in core's Postgres.** The BBS (`04`), IRC and MUD are clients of
  core; they don't get their own copy of users or posts.
- **Use the vocabulary in `00-vision.md`** in all UI text: users, guests, trusted, admins,
  ops, rings, boards, channels, homepages. Plain voice: clear, friendly, direct, no bits.
- **Ownership is a feature.** Anything a user creates must be covered by the export (`12`).
  Adding a new kind of user content without adding it to the export is a bug.
- **Stable IDs, not handles,** are the key for everything a user owns.
- **User HTML never runs on the shell's origin** (`15`).
- **Boring core, fancy console.** Identity, storage and backups stay simple and
  well-tested. Over-engineering is welcome in the admin console (`11`), never in the core.
- **Keep docs current.** If implementation changes a design, update the doc in the same change.

## Conventions (PROPOSED)
- pnpm monorepo, **TypeScript** for our code.
- **PostgreSQL** for core data; forward-only migrations.
- Shell: **React + Vite + TypeScript**.
- Shared zod schemas in `packages/shared`, used by client and server.
- Tests: vitest (unit), Playwright (shell e2e), compose-based integration suite
  (login across services, export round-trip; web post ↔ terminal once the BBS exists).
- `docker compose up` must yield a working site locally.
- Small commits; each roadmap task independently testable.

## Definition of done
- Acceptance criteria in `16-roadmap.md` met, with tests where practical.
- Audit-relevant actions write to the audit log (`03`).
- New user content is included in export (`12`).
- UI text uses the vocabulary and voice guide.
- Docs updated if design changed.

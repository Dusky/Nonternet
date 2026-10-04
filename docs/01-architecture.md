# 01 — Architecture

One deployment, run by the admin team, on one server (or a small cluster later).

```
          browsers        telnet/SSH       IRC clients      MUD clients
             │ HTTPS          │ 23/22           │ 6697           │ 4000
      ┌──────▼─────────────── Caddy (TLS, routing) ───────────────────────┐
      │  site.domain           → shell (static SPA)                         │
      │  site.domain/api, /oidc→ core                                       │
      │  *.homes_domain        → homepage files (separate origin)           │
      │  /ws/bbs, /ws/mud, /ws/irc → service WebSockets                     │
      └──────┬───────────────────────────────────────────────────────────┘
             │
   ┌─────────▼────────┐   ┌──────────────┐   ┌────────────┐   ┌────────────┐
   │ core             │◄─►│ BBS (last)   │   │ IRC (Ergo) │   │ MUD engine │
   │ accounts, OIDC,  │   │ core client  │   │ + auth hook│   │ + auth hook│
   │ roles, boards,   │   └──────────────┘   └────────────┘   └────────────┘
   │ rings, homepages,│
   │ export, audit,   │──► Postgres     Redis (sessions, presence, events)
   │ events           │
   └──────────────────┘
```

## Components
| Component | Role | Built / borrowed |
|---|---|---|
| **Caddy** | TLS, reverse proxy, static homepages, on-demand TLS for custom domains | Borrowed |
| **core** | Accounts, OIDC, roles, boards and posts, rings, homepages, export, notifications, audit, event bus, admin APIs | **Built** (TypeScript) |
| **shell** | Web UI: launcher, windows, boards, homepage studio, rings, chat, admin console | **Built** (React) |
| **BBS** | Telnet/SSH/WebSocket terminal front door; a client of core's API (`04`) | **Built** (TypeScript), last milestone |
| **gopher** | Read-only Gopher mirror of public boards, homepages and file areas (`05`); same image as core, own process | **Built** (TypeScript, M7) |
| **Ergo** | IRC server | Borrowed (PROPOSED) |
| **MUD engine** | Shared world | Borrowed (PROPOSED: Evennia) |
| **Postgres / Redis** | Data, sessions, presence, event streams | Borrowed |
| **Worker** | Background jobs: export builds, link checks, reconcile, backups, stats rollups | **Built** (part of core codebase) |

## Rules
- **core is the source of truth** for users, roles, rings, board metadata, homepages, audit.
- **Services keep their own stores** where they must (the MUD DB, Ergo's history). core never
  writes to them directly — only via hooks.
- **Boards and posts live in core's Postgres.** The web shell and, later, the BBS read and
  write them through the core API.
- **One event bus** (Redis streams): services and workers subscribe; consumers are idempotent.
- **Everything is configurable by name**: `site.*` config drives all branding (see `CLAUDE.md`).

## Repo layout (PROPOSED)
```
repo/
├── CLAUDE.md  README.md  docs/
├── apps/
│   ├── core/            # API, OIDC, workers
│   └── shell/           # web UI incl. admin console
├── packages/
│   ├── shared/          # zod schemas, enums (roles, states), vocabulary strings
│   ├── strings/         # all UI copy; name/domain interpolated from config
│   ├── app-sdk/         # the app side of the bridge for installable apps (docs/10)
│   ├── ftn/             # FTN text helpers (later, for federation)
│   └── ui-themes/       # theme tokens
├── packs/
│   ├── apps/<id>/       # installable app packages (manifest + Vite build), e.g. todo
│   └── build/<id>/      # built packages; APPS_DIR points here, the homes server serves them
├── services/
│   ├── bbs/             # terminal BBS service + art pack (last milestone)
│   ├── irc/             # Ergo config template + auth script
│   └── mud/             # game dir + auth backend
├── deploy/
│   ├── compose.yaml  compose.prod.yaml
│   ├── caddy/Caddyfile.tmpl
│   └── site.example.yaml
└── tools/sitectl/       # init, doctor, backup, restore, render-config, promote
```

## Networking
| Port | Service | Exposure |
|---|---|---|
| 80/443 | Caddy | public |
| 23, 22 (or 2222) | BBS telnet/SSH (once shipped) | public (telnet can be disabled) |
| 6697 | IRC TLS | public |
| 4000 | MUD telnet | public, optional |
| 70 | Gopher mirror (`services.gopher`; 7070 locally) | public, optional |
| internal | core, Postgres, Redis | private network only |

## Domains
- `site.domain` — shell, API, OIDC.
- `site.homes_domain` — homepages on per-user subdomains. **Must be a separate registrable
  domain** (PROPOSED) or at least a separate subdomain tree; never the shell's origin.
- Custom domains for homepages via Caddy on-demand TLS with an allowlist check in core.

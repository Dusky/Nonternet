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
   │ core             │◄─►│ Enigma½ BBS  │   │ IRC (Ergo) │   │ MUD engine │
   │ accounts, OIDC,  │   │ + bridge     │   │ + auth hook│   │ + auth hook│
   │ roles, rings,    │   └──────────────┘   └────────────┘   └────────────┘
   │ homepages, export│
   │ audit, events    │──► Postgres     Redis (sessions, presence, events)
   └──────────────────┘
```

## Components
| Component | Role | Built / borrowed |
|---|---|---|
| **Caddy** | TLS, reverse proxy, static homepages, on-demand TLS for custom domains | Borrowed |
| **core** | Accounts, OIDC, roles, rings, board registry, homepages, export, notifications, audit, event bus, admin APIs | **Built** (TypeScript) |
| **shell** | Web UI: launcher, windows, boards, homepage studio, rings, chat, admin console | **Built** (React) |
| **Enigma½** | BBS: terminal UI, message areas, file areas, doors | Borrowed (DECIDED) |
| **Enigma bridge** | Module inside Enigma exposing a private API | **Built** |
| **Ergo** | IRC server | Borrowed (PROPOSED) |
| **MUD engine** | Shared world | Borrowed (PROPOSED: Evennia) |
| **Postgres / Redis** | Data, sessions, presence, event streams | Borrowed |
| **Worker** | Background jobs: export builds, link checks, reconcile, backups, stats rollups | **Built** (part of core codebase) |

## Rules
- **core is the source of truth** for users, roles, rings, board metadata, homepages, audit.
- **Services keep their own stores** (Enigma's SQLite, MUD DB). core never writes to them
  directly — only via bridges/hooks.
- **Message content lives in Enigma**; core keeps board metadata and a search/read index.
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
│   ├── ftn/             # FTN text helpers (kept for Enigma + future federation)
│   └── ui-themes/       # theme tokens
├── services/
│   ├── enigma/{config-templates,art-pack,bridge}/
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
| 23, 22 (or 2222) | Enigma telnet/SSH | public (telnet can be disabled) |
| 6697 | IRC TLS | public |
| 4000 | MUD telnet | public, optional |
| internal | core, bridge, Postgres, Redis | private network only |

## Domains
- `site.domain` — shell, API, OIDC.
- `site.homes_domain` — homepages on per-user subdomains. **Must be a separate registrable
  domain** (PROPOSED) or at least a separate subdomain tree; never the shell's origin.
- Custom domains for homepages via Caddy on-demand TLS with an allowlist check in core.

# 19 — Operating the site

How to put the site on a server, keep it running, and know it is healthy. The design behind it is in `15`.
Everything here uses `deploy/sitectl`, run from `deploy/` on the server.

## What you need
- One server with Docker (Compose v2.24 or later, for `!override`). A good start: 4 vCPU, 8 GB RAM, 160 GB disk
  (homepage files, file areas and backups grow). See "Capacity" for measured numbers.
- A domain for the site and a **separate registrable domain** for homepages (`15`: user HTML never shares the
  site's origin).
- DNS: `A`/`AAAA` for `example.net` and `irc.example.net`, and a wildcard `*.example-homes.net`, all pointing at
  the server. Optional names for people's clients: `bbs.`, `mud.` (same address).
- Outgoing mail (SMTP) for sign-up confirmations and password resets.
- Open ports: 80 and 443 (web), 6697 (IRC over TLS), 23 and 2222 (BBS telnet and SSH), 4000 (MUD), 70 (Gopher).
  Leave out any service you turn off in the site config.

## First install
1. `git clone` the repository on the server; `cd deploy`.
2. `cp site.example.yaml site.yaml` and set the name, domains and which services are on. Point
   `SITE_CONFIG_FILE=./site.yaml` in `.env`.
3. `cp .env.example .env` and fill in every value, including the production block at the end. Database
   passwords in hex (`openssl rand -hex 24`), other secrets `openssl rand -base64 32`, and the backup key with
   `docker compose run --rm core node cli.cjs backup-key`. **Keep a copy of `APP_SECRET_KEY` and `BACKUP_KEY`
   away from the server**: without them backups can't be read and admins lose two-factor.
4. `./sitectl up` builds and starts everything. The first start takes a few minutes; Caddy gets certificates
   as soon as DNS points at the server.
5. `./sitectl create-admin <handle> <email>`, then sign in on the web and set up two-factor (admins must).
6. `./sitectl doctor` should end with "All good."
7. Add the cron jobs below.

## Routine
| When | What | Command |
|---|---|---|
| nightly | encrypted backup into `deploy/backups` (database, MUD world, chat history, homepages, file areas, config) | `./sitectl backup` |
| weekly | Ergo picks up a renewed certificate for `irc.` | `./sitectl irc-reload` |
| monthly | prove the newest backup restores; the result shows in the console's Backups page | `./sitectl restore-test` |
| after each backup | copy `deploy/backups` off the server (rsync, object storage); it is encrypted | your tool |

Example crontab (as the user that runs Docker):
```
15 3 * * *  cd /srv/site/deploy && ./sitectl backup >> backups/backup.log 2>&1
30 4 * * 1  cd /srv/site/deploy && ./sitectl irc-reload
45 4 1 * *  cd /srv/site/deploy && ./sitectl restore-test >> backups/restore.log 2>&1
```

## Upgrading
`./sitectl upgrade` backs up, pulls the new version (`git pull --ff-only`), rebuilds, restarts, and checks the
site answers. Migrations run when core starts (forward-only, `13`). If core does not come back:
`./sitectl logs core`. To go back, check out the previous commit and `./sitectl up`; a migration that already
ran stays (forward-only), so restore the backup from before the upgrade if a migration must be undone.

## When something is wrong
- `./sitectl doctor` first: it checks configuration, DNS, services, TLS and ports and says what failed.
- `./sitectl ps` and `./sitectl logs <service>` (core, caddy, ergo, mud, bbs, homes, gopher, postgres).
- The console's Status page shows every part of the site, the event outbox, backups and TLS.
- A person can't sign in to IRC, the MUD or the BBS: ten wrong terminal passwords in 15 minutes pause terminal
  logins for that account for 15 minutes (`15`).
- Certificates: Caddy renews them on its own; homepage names and custom domains get one on first visit after
  core says the name is real.

## Capacity (measured 2026-09-30)
`scripts/load-test.mjs` (signed-in people reading boards, threads and mail, posting now and then) against one
core process on 4 vCPU, with Postgres on the same machine:
| Callers at once | Requests per second | Errors | p95 latency |
|---|---|---|---|
| 20 | 1,060 | 0 | 24–54 ms (posting slowest) |
| 100 | 1,020 | 0 | 108–184 ms |
One core process tops out near 1,000 requests a second (it is CPU-bound); beyond that, latency grows and
nothing fails. A busy evening for a community of a few thousand people is well under this. Core runs as one
instance (presence and the IRC bot live in its memory, `01`); scaling out is future work.

To measure your own server: seed a **throwaway** database with `apps/core/scripts/load-seed.ts`, start core
against it, and run `node scripts/load-test.mjs --url … --users … --seconds 30 --concurrency 20`. Never point
it at the real site: it posts.

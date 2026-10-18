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
- Open ports: 80 and 443 (web), 6697 (IRC over TLS), 23 and 2222 (BBS telnet and SSH), 4000 (MUD; 4003 for its telnet over TLS when `mud.tls.enabled` is on), 70 (Gopher), 79 (finger), 1965 (Gemini).
  Leave out any service you turn off in the site config.

## Installing with the wizard (2026-10-11)
`./sitectl install` asks everything in a full-screen wizard and writes the files for you. It runs in a container, so the server
needs nothing but Docker and git. Steps:
1. `git clone` the repository on the server; `cd deploy`; `./sitectl install`.
2. The wizard asks, in order:
   - a **profile**: small community, web and chat, everything, or custom (pick services one by one);
   - the site's name and domains;
   - who may join (open, invite, application, closed) and limits;
   - outgoing mail;
   - how the first admin is made (in the browser, or on the command line now);
   - where backups go (this server only, rsync over SSH, or S3-compatible storage);
   - extras: firewall and automatic updates on the host, the console's update agent, the wiki's starter pages, a demo community.
3. It **checks the server**: CPU, memory, disk, Docker and Compose versions, free ports, DNS for each name, and the mail
   server. A failed check stops you unless you press F to go on anyway.
4. It **shows what it will write**, file by file (D shows the differences), with secrets masked:
   - `.env`, with every secret made fresh;
   - `site.yaml`, edited from the example so its comments stay;
   - `install/crontab`;
   - `install/host-setup.sh`, if you chose the host extras.
5. It shows `APP_SECRET_KEY` and `BACKUP_KEY` once and asks you to type "saved". Keep them away from the server.
6. Then sitectl carries out the steps the installer wrote to `install/steps`:
   - runs the host script with sudo;
   - puts the cron jobs between `# >>> site install` markers in your crontab;
   - `up`;
   - makes the admin, if you chose the command line;
   - installs the agent;
   - adds the starter pages and the demo, if chosen;
   - `doctor`.
7. If you chose the browser for the first admin, it prints the setup link last. Open it, make your account, and setup closes
   for good.

**Running it again** changes settings. Your answers are kept in `install/answers.used.yaml` and fill in the wizard. Secrets
that exist are never replaced. The old files are saved in `install/previous/<time>/` before anything is written. Once the site
has an admin, no new setup link is made.

**Without the wizard:**
- `./sitectl install --answers my-answers.yaml` uses a file of answers instead of asking. Start from `install.example.yaml`.
  The file must be inside `deploy/`, because that folder is all the installer can see.
- `--dry-run` shows the plan and the differences and writes nothing.
- `--skip-checks` and `--force` are for when you know better than the checks.

**Off-site backups.** If you chose rsync or S3, cron runs `./sitectl backup-copy` an hour after each backup. It uses `rsync` to
`BACKUP_RSYNC_TARGET`, or `rclone` (in a container) with the `BACKUP_S3_*` values in `.env`. The backups are already encrypted.

## First install by hand
1. `git clone` the repository on the server; `cd deploy`.
2. `cp site.example.yaml site.yaml` and set the name, domains (the example's `homes_domain: homes.localhost` is for running
   locally only; `./sitectl doctor` fails until it matches `HOMES_DOMAIN`) and which services are on. Point
   `SITE_CONFIG_FILE=./site.yaml` in `.env`.
3. `cp .env.example .env` and fill in every value, including the production block at the end. Database
   passwords in hex (`openssl rand -hex 24`), other secrets `openssl rand -base64 32`, and the backup key with
   `docker compose run --rm core node cli.cjs backup-key`. **Keep a copy of `APP_SECRET_KEY` and `BACKUP_KEY`
   away from the server**: without them backups can't be read and admins lose two-factor.
4. `./sitectl up` builds and starts everything. The first start takes a few minutes; Caddy gets certificates
   as soon as DNS points at the server.
5. Make the first admin, one of two ways:
   - **In the browser:** put a long random `SETUP_TOKEN` in `.env` (`openssl rand -base64 32`; the installer does this for you), restart
     core, and open `https://<your domain>/setup?token=<it>`. The page makes the admin account and signs you in. It works once: as soon as
     any admin exists, setup is closed and the token does nothing (you can then delete it from `.env`).
   - **On the command line:** `./sitectl create-admin <handle> <email>`.
   Then set up a passkey or two-factor (recommended; the console can require it for all admins).
6. `./sitectl doctor` should end with "All good."
7. Add the cron jobs below.
8. Optional: the wiki's starter help pages. Press "Add the starter help pages" on the empty wiki, or run
   `docker compose run --rm core node cli.cjs wiki-starter --as <your admin handle>`. Edit them afterwards to suit your site.
9. Optional: desktop wallpapers. Put pictures in `deploy/wallpapers/`, list them under `ui.wallpapers` in the site
   config, choose `ui.default_wallpaper`, and restart core (the folder's README has an example). Not in backups:
   keep your own copy of the pictures, as with the site config.

## Routine
| When | What | Command |
|---|---|---|
| nightly | encrypted backup into `deploy/backups` (database, MUD world, chat history, homepages, file areas, config) | `./sitectl backup` |
| weekly | Ergo (and Gemini, when it uses the site's certificate) pick up renewed certificates | `./sitectl tls-reload` (`irc-reload` still works) |
| monthly | prove the newest backup restores; the result shows in the console's Backups page | `./sitectl restore-test` |
| monthly | fetch the newest list of throwaway email services refused at sign-up (core rereads it; no restart) | `./sitectl disposable-refresh` |
| after each backup | copy `deploy/backups` off the server (rsync, object storage); it is encrypted | `./sitectl backup-copy` (set up by the installer), or your own tool |

Example crontab (as the user that runs Docker):
```
15 3 * * *  cd /srv/site/deploy && ./sitectl backup >> backups/backup.log 2>&1
30 4 * * 1  cd /srv/site/deploy && ./sitectl tls-reload
45 4 1 * *  cd /srv/site/deploy && ./sitectl restore-test >> backups/restore.log 2>&1
50 4 1 * *  cd /srv/site/deploy && ./sitectl disposable-refresh
```

## Upgrading
`./sitectl upgrade` backs up, pulls the new version (`git pull --ff-only`), rebuilds, restarts, and checks the
site answers. Migrations run when core starts (forward-only, `13`). If core does not come back:
`./sitectl logs core`. To go back, check out the previous commit and `./sitectl up`; a migration that already
ran stays (forward-only), so restore the backup from before the upgrade if a migration must be undone.

### From the admin console (built 2026-10-03)
Admins can check for updates, update the site and restart services from **Admin console → Updates**, once the agent is set
up on the server: run `./sitectl install-agent` in `deploy/` (it creates `deploy/ops/` and a `sitectl-agent` system service,
using `sudo` once).
- **How it works**: core never touches Docker. It writes a small request file into `deploy/ops/requests/` (mounted into core as
  `/ops`, `OPS_DIR`). The agent on the host takes the oldest one, checks it against a fixed list, runs it, and writes the job's
  state and log to `deploy/ops/jobs/`, which the console shows. Nothing in a request is ever run as a command.
- **The fixed list**:
  - *check for updates*: `git fetch`, then the waiting commits are listed. The agent also does this every ten minutes;
  - *update*: exactly `./sitectl upgrade`, so backup first, then pull, rebuild, restart and the health check;
  - *restart* one of `core homes shell caddy bbs gopher mud ergo`, or everything, then wait until healthy. The database and Redis
    are never restarted from the web.
- **Safety**:
  - updating and restarting ask for the admin's password again;
  - one job at a time, rate-limited;
  - each request is audited (`ops.check`, `ops.upgrade`, `ops.restart`);
  - the agent keeps the last 50 jobs.

  The most a stolen admin session can do here is ask for one of these actions.
- **While core restarts** the page says so and catches up by itself. If the agent stops, the page says when it was last seen
  (`systemctl status sitectl-agent` on the server).

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

## The Gemini certificate (2026-10-05)
- **By default** the Gemini mirror makes its own certificate on its first start and keeps it in the `gemini-data`
  volume. Back the volume up with the rest: Gemini clients remember the certificate on the first visit, and a new
  one makes them warn.
- `./sitectl gemini-fingerprint` prints its fingerprint (`SHA256:…`). Publish it on the site so people can compare.
- **To use the site's own certificate** instead (Caddy already keeps one for `SITE_DOMAIN`, which is the Gemini host
  unless `gemini.host` says otherwise):
  1. In the site config, set `gemini.certificate: site`.
  2. In `.env`, set:
     ```
     GEMINI_TLS_CERT=/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<site domain>/<site domain>.crt
     GEMINI_TLS_KEY=/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<site domain>/<site domain>.key
     ```
  3. Run `./sitectl up`.
  4. Weekly `tls-reload` picks up renewals; the mirror also notices a changed file within the hour.
  - Clients that pinned the old self-signed certificate will warn once. Say so on the site before switching.
  - To switch back, set `certificate: self-signed` and clear the two env vars. The kept certificate is still in the
    volume, so its fingerprint is unchanged.
  - Like Ergo's, reading Caddy's files from another container is untested on a real host (V11).


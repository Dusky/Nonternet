# 00 — Vision, Vocabulary & Voice

## The pitch
A hosted home for the old internet. One site, one login, and the real things: a BBS you can
telnet into, IRC, a shared MUD, and personal homepages — with a modern web interface so
anyone can take part without knowing what telnet is.

## Shape (DECIDED)
- **One big site**, hosted and run by the admin team. Not a platform of many sites.
- **Rings** are how users break into smaller communities (see `06`).
- **The MUD is one shared world** for everyone.
- **Users own their stuff**: full export in open formats, stable identity, custom domains
  for homepages. Participation must never require running a server.
- **Federation and self-hosting are later phases**, designed for but not built in v1.

## Principles
1. **Two front doors.** Authentic access (telnet/SSH BBS, IRC clients, MUD clients) and a
   comfortable web way, showing the same data.
2. **One identity** across every service.
3. **Ownership by default.** If a user made it, they can take it with them.
4. **Borrow the hard parts.** Enigma½, an IRC daemon, a MUD engine, Caddy. Our code is glue,
   the shell, rings, homepages, export and the admin console.
5. **Earned standing.** Trusted users create boards and found rings.
6. **Honest UI.** Say plainly what's public, what's permanent, what's local.
7. **Boring core, fancy console.** Keep the foundations simple. Put the ambition in the
   admin console.

## Non-goals (v1)
- Federation between separate installs.
- A desktop app or self-hosted "points".
- Rich-media social features (algorithmic feeds, likes-as-metrics).
- Large scale: target hundreds to low thousands of users on one server.
- Native mobile apps (the web shell must work well on phones).

## Vocabulary (DECIDED: plain, period-accurate terms)
Use these words in all UI, docs and code comments. No invented metaphor or setting.

| Concept | Word | Notes |
|---|---|---|
| The whole service | the site name (config) | "on Nonternet" — placeholder |
| People | **users** | |
| Not-yet-approved / logged-out people | **guests** | |
| Earned standing | **trusted** | Can create boards and found rings |
| Staff with full control | **admins** | |
| Scoped moderators | **ops** | **board op**, **ring op**, **channel op**, (MUD: builder/wizard stays engine-native) |
| User-formed groups | **rings** | Not "neighborhoods", "towns", "clubs" |
| Message areas | **boards** | |
| Chat rooms | **channels** | |
| Personal sites | **homepages** | |
| The web UI | **the shell** | internal term; UI can just say the site name |
| Control panel | **admin console** | |

Retired terms from earlier planning: town, neighborhood, sysop (except where Enigma uses it
internally), peer, handle@town.

## Voice (DECIDED: plain)
Clear, friendly, direct. No jokes, no characters, no nostalgia bits in system text.
Personality comes from users' homepages, rings and posts, and from admin-written MOTDs.

| Situation | Write | Don't write |
|---|---|---|
| Login | "Welcome back, zerocool. 14 users online." | "The kettle's on!" |
| Empty board | "No posts yet." | "Be the first! Under construction!" |
| Error | "Something went wrong. The admins have been notified." | "The server declined to elaborate." |
| Permanence | "Posts on this board are public." | vague or cute warnings |

Rules: sentence case; say what happened and what to do next; numbers as digits; no
exclamation marks in system text.

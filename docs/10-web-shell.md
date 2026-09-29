# 10 — Web Shell & UI

The shell makes the services feel like one site.

## Concept
Desktop-style windows on large screens; a launcher home screen with full-screen apps on phones.
Every app also has a normal full-page URL (links, bookmarks, sharing).

## Apps
| App | v1? |
|---|---|
| **Boards** (`05`) | yes |
| **Terminal** — BBS in xterm.js (`04`) | BBS milestone (last) |
| **Rings** — directory, ring pages, my rings, ring op tools (`06`) | yes |
| **Homepage studio** — files, editor, preview, widgets (`07`) | yes |
| **Homepages** — directory, random page | yes |
| **Who's online** — presence across services, user profile cards | yes |
| **Settings** — profile, passwords, theme, notifications, export, custom domain; terminal password and SSH keys arrive with the first service that needs them (IRC) | yes |
| **Admin console** (`11`) | yes (admins) |
| **Chat** — IRC (`08`) | IRC milestone |
| **MUD** — terminal into the world (`09`) | MUD milestone |
| **Mail** — private messages | later (OPEN) |

## Desktop layout
Taskbar (launcher, open windows, online count, notifications, clock); draggable/resizable
windows with remembered positions; desktop icons; keyboard window cycling.

## Mobile
Launcher grid; apps full-screen with back navigation; terminal key bar (Esc, Ctrl, Tab,
arrows); Boards designed mobile-first.

## Themes (PROPOSED)
Amber CRT, green screen, Win95-style, System 7-style, and a clean modern light/dark.
Themes are token sets in `packages/ui-themes`. Effects (scanlines, glow, sounds) individually
toggleable; flicker off by default; respect `prefers-reduced-motion`. Admin sets the default.

Note: themes style the chrome; **all copy follows the plain voice** in `00`.

## Landing page (logged out)
Site name and banner, online count, recent public posts, featured rings and homepages,
how to connect (web now; telnet, SSH and IRC as they ship), sign up / log in.

## Accessibility (required)
Keyboard-operable; proper ARIA roles for windows; modern theme meets WCAG AA; retro themes
offer high contrast; terminal windows offer a screen-reader mode or transcript (VERIFY
xterm.js support). The Boards app is the accessible path to BBS content.

## Tech (PROPOSED)
React + Vite + TypeScript; TanStack Query; Zustand for the window manager; xterm.js;
in-house window manager. All strings from `packages/strings` with `site.name` interpolation.

# Astir

Astir is a to-do app from Stone Dragon Media built around a daily list that resets every day. Habits clear their checkmarks each morning, one-off tasks for today sit beside them, and anything unfinished rolls into tomorrow, tagged with how long it's been waiting. Named lists hold everything else and never reset.

Astir runs in the browser and as a Windows app. Both work offline and sync through a Cloudflare Worker with a D1 database. Mac, Linux, iOS and Android are planned from the same codebase.

This README owns what Astir is and how to set it up and use it. [AGENTS.md](AGENTS.md) owns coding conventions.

## Status

Not built yet. The v1 design is settled in the [spec](docs/specs/2026-11-16-astir-v1.md) and split into [issues #1 to #15](https://github.com/jmusick/astir/issues) in build order.

## Planned for v1

- **Daily list:** recurring habits (every day or chosen weekdays) plus today-only tasks, a progress ring, and a reset at your own day-start hour in your time zone
- **Rollover:** unfinished today-only tasks move to the next day with a "2nd day", "3rd day" tag
- **Named lists:** any number of them, with notes, due dates, reminders and one level of subtasks. Tasks due today also show in Today
- **History:** look back at what you did on any past day
- **Offline everywhere:** the web view and the Windows app keep working without a connection and sync when it returns
- **Windows extras:** a tray icon with background running, start with Windows, a global quick-add hotkey, a taskbar badge, and silent auto-updates
- **Accounts:** open sign-up with email verification, a devices list with revoke, JSON export, and account deletion

## Tech

- **Web and API:** a Cloudflare Worker with static assets, D1, and React with Vite
- **Native apps:** Tauri 2, reusing the same React UI
- **Sync:** one TypeScript sync engine for every client, storing data in IndexedDB in the browser and SQLite in Tauri
- **Hosting:** astir.stonedragonmedia.com
- **Windows distribution:** an installer on GitHub Releases with Tauri's auto-updater

## Setup

Setup instructions arrive with [#1](https://github.com/jmusick/astir/issues/1).

## License

Astir's code will use the Tagstash non-commercial license, adapted for Astir, copyright Stone Dragon Media LLC. It gets added in [#1](https://github.com/jmusick/astir/issues/1). Until then, all rights are reserved.

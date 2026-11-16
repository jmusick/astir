# Astir

Astir is a to-do app from Stone Dragon Media built around a daily list that resets every day. Habits clear their checkmarks each morning, one-off tasks for today sit beside them, and anything unfinished rolls into tomorrow, tagged with how long it's been waiting. Named lists hold everything else and never reset.

Astir runs in the browser and as a Windows app. Both work offline and sync through a Cloudflare Worker with a D1 database. Mac, Linux, iOS and Android are planned from the same codebase.

This README owns what Astir is and how to set it up and use it. [AGENTS.md](AGENTS.md) owns coding conventions.

## Status

Early. The repo, the Worker and the deploy are set up, but there's no app yet. The v1 design is settled in the [spec](docs/specs/2026-11-16-astir-v1.md) and split into [issues #1 to #15](https://github.com/jmusick/astir/issues) in build order.

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

You need Node 22.13 or newer (CI uses the version in `.nvmrc`) and npm 11.19 or newer, which honors the install safeguards in `.npmrc`.

```bash
npm install
npm run db:migrate:local
npm run dev
```

`npm run dev` serves the React UI and the Worker together from Vite at http://localhost:5173, against a local D1 database kept in `.wrangler/state`. `GET /api/health` reports whether the API and the database answer.

| Command | What it does |
| --- | --- |
| `npm run dev` | Web UI and Worker together, with local D1 |
| `npm run typecheck` | Generates the Worker's types (`worker-configuration.d.ts`) and type-checks everything |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run build` | Type check, then build the Worker and the static assets into `dist/` |
| `npm run preview` | Build, then serve the production build locally |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations locally or to production |
| `npm run deploy` | Build and deploy to astir.stonedragonmedia.com (needs `wrangler login`) |

CI runs the shared [jmusick/ci](https://github.com/jmusick/ci) checks on every push and pull request. Deploys are run by hand with `npm run deploy` for now.

## License

Astir's code is under the [Astir Non-Commercial License](LICENSE.md), adapted from Tagstash's, copyright Stone Dragon Media LLC. Personal and non-commercial use is free. Commercial use needs written permission.

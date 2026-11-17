# Astir

Astir is a to-do app from Stone Dragon Media built around a daily list that resets every day. Habits clear their checkmarks each morning, one-off tasks for today sit beside them, and anything unfinished rolls into tomorrow, tagged with how long it's been waiting. Named lists hold everything else and never reset.

Astir runs in the browser and as a Windows app. Both work offline and sync through a Cloudflare Worker with a D1 database. Mac, Linux, iOS and Android are planned from the same codebase.

This README owns what Astir is and how to set it up and use it. [AGENTS.md](AGENTS.md) owns coding conventions.

## Status

Early. Web accounts support sign-up, email verification, sign-in, password reset and sign-out. The server stores lists, items, versioned recurring schedules, completions, reminder dismissals and the account's day settings behind an authenticated [sync API](docs/sync-api.md). The web Today view runs offline-first on the client sync engine, loads with no connection after the first visit, resets at your day-start hour and rolls unfinished tasks over. Named lists hold tasks with notes, due dates and subtasks, and tasks that are due show in Today. History shows what you did on any past day. Reminders pop up as notifications while a tab is open. Settings manages the day boundary, signed-in devices, a JSON export and account deletion. A Windows app (Tauri 2) runs the same UI offline over SQLite and signs in through the browser; it lives in the tray with an optional start at login and a taskbar count. Its hotkey, native reminders and installer are still being built. The v1 design is settled in the [spec](docs/specs/2026-11-16-astir-v1.md) and split into [issues #1 to #15](https://github.com/jmusick/astir/issues) in build order.

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
cp .dev.vars.example .dev.vars
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

`npm run dev` serves the React UI and the Worker together from Vite at http://localhost:5173, against a local D1 database kept in `.wrangler/state`. `GET /api/health` reports whether the API and the database answer.

On PowerShell, use `Copy-Item` in place of `cp` if preferred. Before starting, replace `JWT_SECRET` in `.dev.vars` with a random secret (the example gives a generator). Both local config files are ignored by git.

### Accounts and email

The home page is the sign-in form. `/signup`, `/forgot-password` and `/resend-verification` open the other account forms. Verification links expire after 24 hours; reset links expire after an hour. Each link works once, and requesting a new link replaces the old one. A reset also verifies the address, clears a login lockout and revokes existing browser sessions. Verification alone does not sign you in.

| Variable | Where | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | `.dev.vars` / Worker secret | At least 32 random bytes, unique to Astir; signs browser sessions |
| `TURNSTILE_SECRET_KEY` | `.dev.vars` / Worker secret | Validates Cloudflare Turnstile challenges |
| `CLOUDFLARE_API_TOKEN` | `.dev.vars` / Worker secret | Token scoped to Email Sending: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | `.dev.vars` / Worker secret | Account with Cloudflare Email Sending enabled |
| `EMAIL_FROM` | `.dev.vars` / Worker secret | Sender address on a verified sending domain |
| `EMAIL_REPLY_TO` | `.dev.vars` / Worker secret | Optional reply address |
| `APP_URL` | `.dev.vars` locally, `wrangler.jsonc` in production | Base URL used in email links; local example uses `http://localhost:5173` |
| `VITE_TURNSTILE_SITE_KEY` | `.env.local` locally / build environment | Public Turnstile site key embedded during the build |

The examples use Cloudflare's public Turnstile test keys for local HTTP only. A deployed app needs a real widget allowing `astir.stonedragonmedia.com`, its secret, and its public site key at build time. The server refuses test secrets on HTTPS. Missing auth or email configuration returns 503 rather than bypassing checks. Email uses Cloudflare Email Sending's REST API, with no email Worker binding. Configure the credentials above to test real verification/reset delivery locally; the automated tests intercept providers and never send mail.

For production setup, set each Worker secret with `npx wrangler secret put NAME`, build with the production site key, apply `npm run db:migrate:remote`, then deploy. Keep credentials out of tracked files. Changing a signing secret invalidates every existing browser session.

Browser sessions last seven days in an HttpOnly, Secure, SameSite=Lax cookie (plain HTTP loopback uses a local cookie). Tokens never go in localStorage. Every authenticated request checks D1 for expiry, revocation and the current account version; sign-out revokes the session as well as clearing its cookie. Settings lists each live session by a browser-and-system name derived from its User-Agent, with its last activity, and can revoke any but the current one. Deleting an account needs the password and the word DELETE, and removes the user row (sessions, tokens and synced records cascade) plus its address-keyed auth events and lockout in one batch. A request whose cookie carries a token this server signed for a user that no longer exists gets a 401 with `reason: "account-deleted"`, so that account's other devices clear their local copy.

Auth-event counters limit sign-up to 10 requests/IP/hour, reset and verification resends to 10/IP/hour and 5/address/hour with at most one/address/minute, and failed logins to 20/IP/15 minutes. Eight wrong passwords lock an address for 15 minutes, including unknown addresses. The event caps are soft under simultaneous requests; the lockout increment is atomic. Security events contain email/IP and are pruned after 30 days on auth activity. Auth failures never print credentials or email addresses to Worker logs.

New passwords need at least eight characters and at most 72 UTF-8 bytes. Like Tagstash, the server checks known breaches through Pwned Passwords using only a five-character hash prefix; that advisory check fails open if the provider is unavailable. Sign-up and recovery requests return generic messages so they do not disclose registered addresses. Email work runs through `waitUntil`; if delivery fails, request a new verification/reset link.

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
| `npm run app:dev` | The Windows app against `npm run dev` (Tauri; starts the dev server itself) |
| `npm run app:build` | Build the Windows app and its installer into `src-tauri/target/release` |

### The Windows app

The app needs [Rust](https://rustup.rs) (stable, MSVC) and the Visual Studio C++ build tools; Windows 10 and 11 already have WebView2. If more than one Visual Studio is installed and the newest lacks the x64 C++ libraries (the link fails on `msvcrt.lib`), run the app commands from "x64 Native Tools Command Prompt for VS 2022", or after its `vcvars64.bat`.

`npm run app:dev` loads the UI from the Vite dev server, so a development app talks to your local Worker and D1. A built app talks to astir.stonedragonmedia.com (override with `VITE_ASTIR_ORIGIN` at build time). It has no password form: **Sign in with your browser** opens `/connect-app` with a PKCE challenge, the signed-in page asks for a one-time code (five minutes, single use) and opens `astir://auth?code=…`, and the app redeems it with its verifier for a long-lived device token. Device tokens are listed in Settings with the browsers, can be revoked there, and end on a password reset. Data lives in one SQLite file per account in the app's data folder; signing out empties it. A development build registers `astir://` when it starts; installers register it themselves.

CI runs the shared [jmusick/ci](https://github.com/jmusick/ci) checks on every push and pull request. Deploys are run by hand with `npm run deploy` for now.

## License

Astir's code is under the [Astir Non-Commercial License](LICENSE.md), adapted from Tagstash's, copyright Stone Dragon Media LLC. Personal and non-commercial use is free. Commercial use needs written permission.

# AGENTS.md

Guidance for AI coding agents working in this repo. [README.md](README.md) owns what Astir is and how to set it up. This file owns how to work on it. Add gotchas here as you find them, and replace the "not built yet" notes as the code lands.

## What this is

Astir is a to-do app built around a daily list that resets every day. The web view and API run on a Cloudflare Worker with D1. The native apps are Tauri 2 and reuse the same React UI. The repo is **public**.

The v1 design lives in [docs/specs/2026-11-16-astir-v1.md](docs/specs/2026-11-16-astir-v1.md). Its **Decisions** table (D1, D2, …) is the source of truth for anything settled. Issues cite D numbers.
- Decisions marked `user` were made by the owner. Don't change them without asking.
- Decisions marked `agent` were reasonable defaults. Raise it if the code shows one is wrong.
- If you need to change a decision, update the spec in the same change and say so in the commit.

## Status

The foundation (#1), web account flow (#2), server sync API (#3) and the web Today view with the client sync engine (#4) are implemented. Rollover, the account's time zone and day-start hour (#5) are not built yet: "today" is still the device's local date. Work goes through issues [#1 to #15](https://github.com/jmusick/astir/issues) in build order. Each issue lists the issues it depends on and has a "Done when" checklist taken from the spec.

## Layout

One npm package at the root, no workspaces. The layout follows the Cloudflare Vite plugin's and Tauri's defaults so their docs apply as written.

- `src/`: the shared React UI. `App.tsx` picks between `AuthScreen.tsx` (signed out) and `today/TodayScreen.tsx` (signed in); `authMode.ts` reads the account form from the address, and `rememberedAccount.ts` lets Today open offline.
- `src/sync/`: the one TypeScript sync engine (D13). `engine.ts` is local-first and storage-agnostic; it talks to a `SyncStore` (`store.ts`; `indexedDbStore.ts` for the browser, one database per account, D45; a Tauri SQLite store implements the same interface later) and a `SyncTransport` (`transport.ts`, the HTTP API). `daily.ts` holds the pure Today model and record builders. `day.ts` is the only place that decides what "today" is.
- `tests/client/`: Vitest for `src/sync` with DOM types (`tsconfig.app.json`); `fake-indexeddb` stands in for the browser. `tests/sync-client.test.ts` runs the engine against the real Worker handler.
- `worker/`: the Cloudflare Worker. `index.ts` is a single-file dispatcher (as in Tagstash), `headers.ts` sets the API's security headers, `no-store` and the CORS allowlist.
- `worker/auth.ts`: web auth handlers and helpers adapted from Tagstash. Optional secret types live in `worker/env.d.ts`; generated bindings still come from Wrangler.
- `worker/sync.ts`: validates sync pushes and serves revision-cursor pulls. [docs/sync-api.md](docs/sync-api.md) owns the wire contract. `0002_sync.sql` stores all entities in `sync_records`, with per-entity views, reference/revision triggers and a final-state quota check.
- `public/_headers`: CSP, HSTS and friends for static assets only. Worker responses never get these.
- `migrations/`: D1 migrations for `astir-db`.
- `src-tauri/`: placeholder for the Tauri app (#11).
- `tests/`: Vitest. Worker tests call the fetch handler directly with a stub env; no Worker runtime needed.
- `wrangler.jsonc`: the Worker, its D1 binding and the custom domain. `npm run cf:types` regenerates `worker-configuration.d.ts` (gitignored) from it, and `npm run typecheck` does that first.

## Gotchas

- **`GET /api/health` must stay ahead of the `env.DB` check** in `worker/index.ts`, so it answers without D1. It reports the database as `ok`, `not configured` or `error` but always returns 200.
- **`/api` and `/api/*` run the Worker first** (`run_worker_first` in `wrangler.jsonc`). Without it, a browser navigating to an API path would get the React shell from the SPA fallback.
- **Adding a third-party script (Turnstile, analytics) means updating the CSP** in `public/_headers`. Vite's dev server doesn't apply `_headers`, so check CSP problems with `npm run preview`.
- **npm only installs versions at least 7 days old** (`.npmrc` `min-release-age`). `npm install pkg@latest` fails for a fresh release; pick an older one. A dependency with an install script must be reviewed into `allowScripts` in `package.json`.
- **TypeScript stays on 6.x** until typescript-eslint supports 7.
- **Email work uses Worker `waitUntil`**, keeping known and unknown addresses' responses alike. With no context (tests), it awaits inline. A failed send removes its token but keeps the account for a resend. Never log provider messages, addresses or tokens.
- **Auth writes need `X-Astir-Client: web` and a trusted `Origin`.** Browser JWTs are cookie-only and always checked against `browser_sessions` plus `users.token_version`. Logout revokes the row; reset bumps the version and revokes all browser sessions. Keep this check when adding protected routes.
- **Email-token redemption is a D1 transaction.** A conditional user update wins the claim, `changes()` gates token consumption, and a unique `claim_id` gates reset side effects. Don't chain `changes()` through optional rows or use a timestamp as the claim identity: concurrent requests can share a millisecond.
- **Auth tests use Node's built-in SQLite** to execute the real migration and transactional SQL. No extra SQLite package or Worker runtime is needed. Missing migrations fail auth closed; apply local migrations before testing the forms.
- **Turnstile's public test secrets omit the action field.** Only on HTTP loopback with a public dummy secret do we skip action validation. A real secret always checks the action; HTTPS always refuses dummy secrets and checks hostname as well.
- **Sync pushes are D1 transactions.** Keep the `json_each` upsert and final quota-check insert in one `DB.batch`. Only winning changes allocate a server revision. Pull cursors use those revisions, never client timestamps, and pushes never advance a pull cursor.
- **Client deletes go in the same push as everything else**, so quotas see the final state. The server ignores data on deletes, so a tombstone for an item it never saw is stored without data: the next pull hands `engine.ts` that tombstone, which marks its local copy `archive` and pushes the data back. If a push is rejected with 400 because completions or children reference such an item, the engine retries with the archive copies first and the tombstones after.
- **Offline start uses the remembered account.** `rememberedAccount.ts` keeps the signed-in account's id and email in `localStorage` so Today opens from IndexedDB when `/api/auth/me` can't be reached. Sign-out and a 401 from `me` clear it.
- **Local edits are stamped by `SyncEngine.change`.** Record builders in `daily.ts` leave `editedAt` at 0; the engine stamps each edit strictly after the previous one for that record.
- **Sync tombstones are permanent and keep archive data.** A delete arriving before creation can receive its missing metadata later, while remaining deleted. Item kind, parent, list and original/creation day are immutable. Completions and schedules use semantic client IDs; see the API contract before building the client.

## Rules that shape the code

- **One codebase.** The browser and every native app share one React UI and one TypeScript sync engine (D12, D13). Rust in the Tauri app handles only native features: tray, notifications, hotkey, autostart, badge and updater. Data logic never goes in Rust, and the UI is never forked per platform.
- **No Windows-only assumptions outside the platform layer.** v1 ships web and Windows, but Mac, Linux, iOS and Android come next from the same code.
- **Local-first.** Every change saves to the local store (IndexedDB or SQLite) first and syncs later. Never make the UI wait on the network for a write.
- **Never lose a task.** Sync rules (D32, D39) mean:
  - The most recent edit wins per record, by the client's edit timestamp, clamped by the server.
  - A delete beats any edit, and deletes are tombstones.
  - Completions are their own records.
  - Rollover, sync and long offline gaps must never make an item vanish without a trace.
- **The day boundary comes from the account's time zone and day-start hour** (D6, D30), not the device's time zone. It's computed on the device, and there's no server cron.
- **History never rewrites itself.** Schedules are versioned with the day they take effect (D34, D40).

## Tagstash is the reference for the server side

The sibling repo [jmusick/tagstash](https://github.com/jmusick/tagstash) (locally `../tagstash`) is a live Stone Dragon Media product on the same stack. Copy and adapt its patterns for:
- auth: bcryptjs, jose, Turnstile, email verification and password reset through Cloudflare Email Sending
- in-code rate limiting and lockout
- security headers, CSP and the CORS allowlist
- account deletion

Read its AGENTS.md first: it records many non-obvious gotchas. Two differences to keep in mind:
- **Tagstash runs on Pages Functions. Astir runs on Workers with static assets.** Don't copy Pages-specific layout (`functions/`, `_headers`) as-is.
- **Don't import from Tagstash.** Copy and adapt. The two apps must be able to change independently.

CI and release workflows in other projects use the shared [jmusick/ci](https://github.com/jmusick/ci) workflows (locally `../ci`). Check there before writing a release pipeline from scratch.

## Secrets and keys

- The repo is public. No secrets, tokens, real `.dev.vars`, or account IDs that aren't already public.
- The Tauri updater's private signing key must never be committed. If it's lost, every installed copy is stranded. Keep it in CI secrets with a documented backup.

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …) with a scope where it helps, for example `feat(sync): …`.
- No AI co-author or attribution trailers.
- Commit only when asked.

## Changelog and releases

- [CHANGELOG.md](CHANGELOG.md) follows Keep a Changelog. Its sections become the release notes on GitHub Releases and in the Windows app's update notice, so write entries for people who use Astir: what changed for them, not commit subjects.
- Add user-visible changes under `## [Unreleased]` as part of the change itself. Leave out refactors, CI, tests and chores.
- Releases are cut with the `/release` skill. It bumps the version from the Conventional Commits, turns `Unreleased` into the version's section, tags and pushes. Don't hand-edit version numbers outside that flow.

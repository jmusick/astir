# AGENTS.md

Guidance for AI coding agents working in this repo. [README.md](README.md) owns what Astir is and how to set it up. This file owns how to work on it. Add gotchas here as you find them, and replace the "not built yet" notes as the code lands.

## What this is

Astir is a to-do app built around a daily list that resets every day. The web view and API run on a Cloudflare Worker with D1. The native apps are Tauri 2 and reuse the same React UI. The repo is **public**.

The v1 design lives in [docs/specs/2026-11-16-astir-v1.md](docs/specs/2026-11-16-astir-v1.md). Its **Decisions** table (D1, D2, …) is the source of truth for anything settled. Issues cite D numbers.
- Decisions marked `user` were made by the owner. Don't change them without asking.
- Decisions marked `agent` were reasonable defaults. Raise it if the code shows one is wrong.
- If you need to change a decision, update the spec in the same change and say so in the commit.

## Status

Not built yet. Work goes through issues [#1 to #15](https://github.com/jmusick/astir/issues) in build order. Each issue lists the issues it depends on and has a "Done when" checklist taken from the spec.

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

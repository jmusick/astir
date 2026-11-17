# Changelog

All notable changes to Astir are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-11-16

### Added

- Your day now resets at the hour you choose, in your account’s time zone, on every device and offline too. Habits come back unchecked each day with past checkmarks kept, and unfinished today-only tasks roll into the new day tagged “2nd day”, “3rd day” and so on. Today shows when it resets and rolls over on its own without a reload. You can change the reset hour or time zone from Today; a change starts at the next reset, so today stays as it is. If your device is in a different time zone from your account, Today offers to switch, and it warns you when your device clock is noticeably off.

## [0.4.0] - 2026-11-16

### Added

- Plan and finish your day on the web. Today shows your habits and today-only tasks in their own panels, with a progress ring and a running “done · to go” count. Add habits that repeat every day or on chosen weekdays, add tasks for today, and check off, rename or delete them. Changes save in your browser first and sync in the background, so a dropped connection doesn’t lose anything; signing out syncs and then clears your data from that browser.

## [0.3.0] - 2026-11-16

### Added

- An authenticated sync API stores lists, tasks, recurring schedules and completion history, resolves offline conflicts and keeps deleted records for sync. The daily list interface and client sync are still being built.

## [0.2.0] - 2026-11-16

### Added

- Create an account on the web, verify your email address, sign in and sign out. Forgotten passwords can be reset by email; resetting your password signs out existing browser sessions.

## [0.1.0] - 2026-11-16

### Added

- Astir has a home at [astir.stonedragonmedia.com](https://astir.stonedragonmedia.com). There's nothing to use yet: the page is a placeholder while the daily list is built.
- Astir's code is available under the Astir Non-Commercial License: free for personal and non-commercial use.

[Unreleased]: https://github.com/jmusick/astir/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/jmusick/astir/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jmusick/astir/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jmusick/astir/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jmusick/astir/releases/tag/v0.1.0

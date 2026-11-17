# Changelog

All notable changes to Astir are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Look back at past days in History, next to Today. Pick any day since you started, or step through them one at a time, to see which habits you did out of the ones scheduled and which tasks you checked off. Past days stay as they were: changing a habit's schedule or removing a habit doesn't change them, and days you didn't open Astir show their habits as not done.

## [0.7.0] - 2026-11-16

### Added

- Keep your own lists, like Work, Groceries or Someday. They sit next to Today with a count of what's still open, and they never reset: a task stays until you check it off. Give a list task a due date and, once it's due or overdue, it also shows in Today under "Due from your lists" and counts toward the ring; checking it there checks it off in its list. Tasks can have notes, a reminder time and a checklist of subtasks, and habits can have notes and a daily reminder time. Checking every subtask leaves the task itself for you to check. Reminders are saved but don't notify yet. Deleting a list asks first and takes its tasks with it.

## [0.6.0] - 2026-11-16

### Added

- Astir’s web view now opens without a connection after your first visit. Reload with no internet and Today comes up with your habits and tasks; anything you change is saved in the browser and syncs on its own when you’re back online. If Astir’s servers are down, or the connection stalls, you see a quiet “not synced yet” note instead of an error, and Astir keeps retrying.

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

[Unreleased]: https://github.com/jmusick/astir/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/jmusick/astir/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jmusick/astir/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jmusick/astir/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jmusick/astir/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jmusick/astir/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jmusick/astir/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jmusick/astir/releases/tag/v0.1.0

# Changelog

All notable changes to Astir are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Any task on Today can repeat. When you add one, choose Once, Every day or Chosen days, and choose what happens if it's missed: drop it, or roll it over to the next day. Repeating tasks start out set to drop and one-off tasks to roll over, as before, but you can pick either. Open a task's details to change its repeat or missed setting later, including turning a one-off into a repeating task or back; the change starts at your next reset, and past days in History stay as they were.
- Repeating tasks can have subtasks now, a checklist that starts fresh each day. If a task set to roll over isn't done, it keeps the steps you checked until you finish it. Checking every step still doesn't check the task itself.
- Give a repeating task a bucket: a list of items it cycles through, like the accounts you post for. Each day it shows one row per pick, such as "Social media post: Iron Tide", choosing the items that have gone longest without being done, and you choose how many a day. Skip a pick to swap it for the next one today without losing its turn, or, once today's picks are done, choose Do another to add one more. Pause an item to take it out of the rotation, give items notes, and see in History which items got done each day.
- A bucket task set to roll over keeps a missed pick: the same item waits at the top the next day, tagged with how long it's been waiting, and takes one of that day's picks. Skipped picks and extras never roll over.
- A bucket task's subtasks repeat on every pick row, each with its own checks, so "write it" and "schedule it" apply to each account's post. A pick that rolls over keeps the steps you checked.
- A one-off task set to drop disappears after its day and shows in History on that day as dropped.

### Changed

- Unfinished tasks that roll over now wait at the top of Today, oldest first, until you drag them somewhere else. A task you drag stays where you put it until it's done; if it rolls over again later, it starts at the top again.
- A repeating task set to roll over now waits until it's done, tagged with how many days since it was missed, and shows once even when its next scheduled day comes around. Checking it off counts for the day you check it; the days it was missed stay missed in History, and its reminder doesn't go off again while it's waiting.
- History now lists repeating tasks under "Repeating" and counts them as "repeating" instead of "habits".

- Today is now one list in the order you choose. Habits, one-off tasks and list tasks that are due sit together, and you can drag them into the order you'll do them. Your existing habits come first, then your tasks, each in the order they were in. Repeating tasks show a small repeat mark, and a list task that's due shows its list's name. A newly due list task starts at the top, most overdue first, until you drag it somewhere else, and moving it on Today doesn't move it in its list. New tasks land at the bottom, from the add box or the quick-add hotkey. One add box now covers everything: choose Once, Every day or Chosen days.
- Drag to reorder works in your named lists and on subtasks too, and the order syncs to your other devices. To move a task without a mouse, focus its handle and use the up and down arrow keys.

## [0.12.0] - 2026-11-17

### Added

- Check for updates from Settings in the Windows app. If a new version is available, Astir downloads it, installs it quietly and restarts automatically, without walking through setup again. Settings also tells you when you're up to date or an update couldn't be completed.

## [0.11.0] - 2026-11-17

### Changed

- Astir has a new Signal design: a stepped logo, Archivo lettering, clearer task panels and a layout that fits a narrow desktop window or a wide browser. Choose Signal, Blueprint or Fern for a light theme, or Midnight or Carbon for a dark one, under Settings → Appearance. Your choice is remembered on this device, works offline and also colors the Windows quick-add box.

## [0.10.0] - 2026-11-17

### Added

- A Settings page, linked at the top of every screen. Change your time zone and when your day resets there; the change starts at your next reset. See every browser you're signed in on, with when each was last used, and sign any of them out. Download everything as a JSON file: every list, task, habit, checkmark and day of history. You can also delete your account. That takes your password, happens right away and removes everything. Your other devices clear their copy the next time they connect and tell you why.
- Astir for Windows, an app that keeps your day on your computer and works without a connection. Everything you add, check, edit or delete while offline is saved there and syncs when you're back online; changes from the web come down too, and the most recent edit to a task wins. To sign in, Astir opens your browser, where you sign in or create an account as usual, then hands you back to the app. It shows up in Settings as a device you can sign out.
- The Windows app lives in the tray. Closing its window keeps Astir running there, still syncing and rolling your day over on time; the tray icon's menu has Open Astir, Quick add, Sync now and Quit. The taskbar icon shows how many things are left today and clears when you're done. On first run Astir offers to start with Windows, quietly in the tray; it's off unless you say yes, and you can change it in Settings.
- Add to today from any app on Windows. Press Ctrl+Alt+Space and a small box appears; type a task and press Enter, and it's in today's "Today only" list. Escape closes the box without adding anything. The tray's Quick add opens the same box. Change the shortcut in Settings; if another app already uses the one you pick, Astir tells you and keeps the old one.
- Reminders in the Windows app are Windows notifications, and they keep coming while Astir sits in the tray. Click one to open its task. They follow the same rules as on the web, and closing one means your other devices won't show it too. If Astir wasn't running, or the computer was asleep, when a reminder was due, you get it once as a "Missed reminder" the next time Astir starts or wakes, as long as it's still the same day.
- Astir for Windows installs from GitHub Releases, just for your Windows account, with no administrator prompt. After that it keeps itself up to date: it downloads new versions in the background and installs them on its own when you aren't using it, or right away if you choose "Restart to update". The installer isn't code-signed yet, so Windows may warn the first time; choose "More info", then "Run anyway".
- If a device is signed out from Settings, it keeps any changes it hadn't synced until you sign in there again, and offers to download a copy of them first.

## [0.9.0] - 2026-11-16

### Added

- Reminders now pop up while Astir is open in a browser tab. A today-only task reminds you at its time on its day, a habit on each day it's scheduled, and a list task at its date and time. Click the notification to go straight to the item. Close it and your other devices won't show it too, unless they already did. A reminder doesn't come back once a task rolls over or is overdue, and one whose time passed while no tab was open isn't shown later. Astir asks to show notifications when you set a reminder or turn them on from Today, not when the page loads. Reminders with the browser closed come with the Windows app.

## [0.8.0] - 2026-11-16

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

[Unreleased]: https://github.com/jmusick/astir/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/jmusick/astir/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/jmusick/astir/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/jmusick/astir/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/jmusick/astir/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/jmusick/astir/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/jmusick/astir/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jmusick/astir/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jmusick/astir/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/jmusick/astir/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jmusick/astir/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jmusick/astir/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jmusick/astir/releases/tag/v0.1.0

# Astir: priority order, repeats on any task, missed-task rules and cycling buckets

2026-11-17 · Draft · Written from an interview with the user

## Problem and why

Astir's daily list splits the day into two fixed kinds. Habits repeat and simply vanish when missed. Today-only tasks never repeat and always roll over. In real use the owner needs more control than that, mostly over habits:

- **Order matters.** The list should show what to do first, and the owner wants to set that by dragging, not by creation order.
- **Whether a missed task matters depends on the task.** Some daily tasks are fine to skip ("stretch"). Others have to happen eventually and should be waiting at the top tomorrow ("invoice the client").
- **Some daily tasks rotate.** The owner runs social media for several projects, bands and businesses. "Do a social media post" is a daily task, but each day it should be for one (or a few) of those accounts, cycling so each gets its turn without all of them needing a post every day.

A good result: the owner opens Today, sees one list in the order they set, with yesterday's must-dos at the top and today's social post already naming which account it's for. They work down it.

This builds on [the v1 spec](2026-11-16-astir-v1.md). Its decisions D3, D5, D22, D26 and D27 change here. D47 onward continue its numbering.

## Goals

- Today is **one list** in an order the owner sets by dragging. Habits, one-off tasks and list tasks due today are mixed together in it.
- Drag-to-reorder works on Today, in named lists, and on subtasks, and the order syncs to every device.
- Any task on the daily list can be **once, every day, or chosen days**, set when it's created and changeable later.
- Every daily task has a **missed setting**: *drop* (gone after its day, shown in History as not done) or *roll over* (waits at the top of the next day until done).
- A repeating task can have **subtasks that clear each day**.
- A repeating task can have a **bucket**: a pool of items it cycles through, showing a set number of them each day, whichever has gone longest without being done.
- All of it works offline, and every device agrees on the list, its order and today's bucket picks after syncing.

**Non-goals**

- Priority levels (high/normal/low) or any priority other than position in the list.
- Recurrence beyond every day or chosen weekdays (unchanged from v1).
- Pools shared between bucket tasks. Each bucket task owns its pool.
- Weights or per-item weekdays inside a pool.
- Bringing a dropped task back from History.
- Buckets on one-off tasks.
- Repeat, missed settings or buckets on named-list tasks. They keep their due dates and keep showing on Today while due or overdue (D27).

**Anti-goals**

- Losing a task. A dropped task still leaves a trace in History, and a reorder, conversion or rollover never makes an item vanish (v1's anti-goal holds).
- A pick that changes under the owner mid-day for no visible reason, or two devices showing different picks after syncing.
- History rewriting itself when a schedule, missed setting or pool changes (D34, D40).
- A morning triage screen. Carrying and picking happen by themselves.

## Users and scenarios

The owner first, then anyone with an account. Scenarios are in build order. Each can ship on its own.

### Put Today in my order (priority 1)

Today becomes one list, ordered by dragging.

- **Given** an account with three habits and two one-off tasks, **when** they open Today after this ships, **then** they see one list: the habits first, then the one-off tasks, each group in its old order. Repeating tasks carry a small repeat marker.
- **Given** that list, **when** they drag a one-off task above a habit, **then** it stays there after a reload, and the other device shows the same order after both sync.
- **Given** a task in the list, **when** they focus it and use the keyboard move up / move down control, **then** it moves one place, the same as a drag.
- **Given** a new task added from the add box or the quick-add hotkey, **when** it's saved, **then** it appears at the bottom of the list.
- **Given** a Work list, **when** they drag its open tasks, or a task's subtasks, **then** that order sticks and syncs. Finished tasks still sort by when they were checked.
- **Given** a Work task due today, **when** they open Today, **then** it's in the one list with a "Work" tag (no separate "Due from your lists" panel), and dragging it on Today doesn't change its place in Work.

### Repeat any task, and choose what happens when it's missed (priority 1)

- **Given** the add box, **when** they create a task, **then** they choose *Once*, *Every day* or *Chosen days*. The missed setting is preset to *Drop* for repeating tasks and *Roll over* for one-off tasks, and they can change it before saving.
- **Given** a one-off task set to *Drop* and left unfinished, **when** the day resets, **then** it's gone from Today, and History shows it on its day as not done.
- **Given** a one-off task set to *Roll over* and left unfinished, **when** the day resets, **then** it appears at the top of Today tagged "2nd day" (as in v1, but at the top).
- **Given** a repeating task set to *Drop* and missed, **when** the day resets, **then** it's not carried. It shows again on its next scheduled day, and History shows the missed day as not done (as v1 does for habits).
- **Given** an existing task, **when** they open its details, **then** they can change its repeat (including once ↔ repeating) and its missed setting. The change applies from the next reset, and past days in History stay as they were.
- **Given** a one-off task on today, **when** they make it repeat every day, **then** it stays on today's list as it is and repeats from the next reset.

### Carry the ones that matter (priority 1)

What *roll over* means for a repeating task, and where carried tasks sit.

- **Given** a repeating task scheduled Mon/Thu, set to *Roll over*, and missed Monday, **when** Tuesday starts, **then** it's at the top of Today tagged "2nd day". It is still there Wednesday ("3rd day") if not done.
- **Given** that task still undone on Thursday, its next scheduled day, **then** Today shows it **once**, tagged "4th day", not twice.
- **Given** that carried task, **when** they check it off on Wednesday, **then** it counts as done on Wednesday. Monday (and Thursday's merged occurrence, if it had reached Thursday) are settled by that one check. History shows Monday as missed and Wednesday's check as done. The task next appears on its following scheduled day.
- **Given** two carried tasks, one from Sunday and one from Monday, **when** Tuesday starts, **then** both are above everything else, Sunday's first.
- **Given** a carried task, **when** they drag it lower, **then** it stays where they put it for the rest of that carry. Once it's done, it goes back to its usual place, and if it's carried again later, it starts at the top again.
- **Given** a list task that becomes due today, **then** it lands at the top with the carried tasks (overdue ones first, by how overdue) until dragged.

### Daily checklists on repeating tasks (priority 2)

- **Given** a repeating task, **when** they add subtasks to it, **then** each scheduled day starts with all of them unchecked. Checking every subtask still doesn't check the task (as in v1).
- **Given** a *Roll over* repeating task with 2 of 3 subtasks checked and the task not done, **when** the day resets, **then** the carried task keeps those 2 checked until the task itself is done. The next fresh occurrence starts clear.

### Cycle through a bucket (priority 2)

- **Given** a repeating task "Social media post", **when** they turn on a bucket for it and add Iron Tide, Rust Belt Records and Stone Dragon Media to its pool, **then** it gets a "how many a day" number, defaulting to 1.
- **Given** that bucket at 1 a day, **when** Today opens, **then** it shows one row, "Social media post: Iron Tide" (never-done items go first, in pool order), and it counts once toward the ring.
- **Given** Iron Tide done today, **when** tomorrow starts, **then** the pick is the item that has gone longest without being done (Rust Belt Records). Over three days all three get a turn.
- **Given** today's pick isn't workable, **when** they choose *Skip* on it, **then** the next item in line replaces it for today. The skipped item isn't counted as done, so it's still first in line tomorrow.
- **Given** a bucket set to 2 a day, **then** Today shows two pick rows. Each is checked, carried and dragged on its own.
- **Given** today's picks are done, **when** they choose *Do another*, **then** the next item in line is added as an extra row for today. Doing it sends that item to the back of the line.
- **Given** a bucket task set to *Roll over* whose pick (Iron Tide) is missed, **when** the next day starts, **then** Iron Tide carries with a "2nd day" tag and fills one of that day's picks. With 1 a day, that day shows only the carried Iron Tide.
- **Given** a bucket task set to *Drop* whose pick is missed, **then** the pick is gone, and Iron Tide is first in line again because it still hasn't been done.
- **Given** a pool item, **when** they pause it, **then** it leaves the rotation (and today's pick row, if unchecked) until unpaused. Each pool item can also have notes, shown with its pick row.
- **Given** a bucket task with daily subtasks ("write it", "schedule it"), **then** each pick row has its own copy of the checklist.
- **Given** a past day in History, **then** a bucket task shows each pick by name, done or not.

## Decisions

| # | Decision | Why | Decided by |
| --- | --- | --- | --- |
| D47 | **Today is one list.** Habits, one-off tasks and list tasks due today share one ordered list. Repeating tasks show a repeat marker, and due list tasks show their list's name. This replaces v1's separate Habits, Today-only and "Due from your lists" panels (D3's two panels, D22's distinct tinted panels, D27's third panel). | Priority only means something if a one-off can sit above a habit. | user |
| D48 | **Priority is position.** The owner drags tasks into order. There are no priority levels. | That's what the owner described. | user |
| D49 | **Drag-to-reorder works on Today, named lists and subtasks.** The order syncs. | Same mechanism everywhere tasks appear. | user |
| D50 | **New tasks land at the bottom** of the list they're added to. | The owner drags up what matters. | user |
| D51 | **Any daily task can repeat:** once, every day or chosen weekdays. It's set at creation, and the repeat (including once ↔ repeating) can be changed later from the task's details. Changes apply from the next reset (D34). A one-off made repeating stays on today as it is. | The owner wants to choose this per task, not per kind. | user |
| D52 | **Every daily task has a missed setting:** *drop* or *roll over*. New repeating tasks default to drop and new one-off tasks to roll over, matching v1's behavior. It can be changed later, from the next reset. A dropped task stays in History as not done. This generalizes D5. | Some tasks can be skipped and some can't, whatever their kind. | user |
| D53 | **A rolled-over task carries until it's done**, tagged with days since the occurrence it was first missed. A repeating task still undone on its next scheduled day shows **once**. One check settles every merged occurrence and counts as done on the day it's made. The missed days stay missed in History. | The owner wants the task waiting until done, without duplicates. | user |
| D54 | **Carried tasks and newly due list tasks go to the top**, oldest carry (or most overdue) first, ties in normal order. Dragging one places it for the rest of that carry only. When the carry ends, it returns to its usual place, and a later carry starts at the top again. To change its usual place, drag it when it isn't carried. | The owner asked for them "at the top", and for a dragged one to stay put "for the rest of its carry". | user |
| D55 | **Repeating tasks can have subtasks that clear each day.** A carried task keeps its partly checked list until the task is done. Checking every subtask still doesn't check the task. This reverses part of D26. Due dates stay list-only. | The owner wants daily checklists. | user |
| D56 | **Buckets.** A repeating task can have a pool of items and a "how many a day" number (default 1). Each day it picks that many active items, whichever have gone longest without being done (never done first). Each pick is its own row, titled "Task: Item". | Spreads posts across accounts, and a missed one comes first again on its own. | user |
| D57 | ***Skip*** swaps a pick for the next item in line, for today only. The skipped item isn't done, so it keeps its place. ***Do another*** adds the next item in line as an extra row. | The owner wants to work around an account with nothing to post. | user |
| D58 | **Pool items have a name, optional notes, and can be paused.** Each bucket task owns its pool. There are no weights, per-item days or shared pools. | The owner chose pause and notes. Shared pools aren't needed yet. | user |
| D59 | **A bucket task's subtasks repeat on every pick row**, each with its own checks. | "Write it, schedule it" applies to each account's post. | user |
| D60 | **Missed is handled the same way for picks.** On roll over, a missed pick carries with the same item and fills one of the next day's picks. On drop, it's gone and the item stays first in line. Extras added with *Do another* are never carried or counted as missed. | Follows D53 and D56 without new rules. Extras are bonus work. | agent |
| D61 | **A day's picks are worked out from what was done before that day,** so checking one pick never reshuffles another. Only *Skip*, *Do another* and pausing change them mid-day. Each pick is **recorded once it's decided**, as a synced record keyed by task, day and slot. That record is what History shows (a missed pick keeps its name), and what extras, checks and per-pick subtasks attach to. Two devices that decide the same slot offline compute the same item from the same synced history. If their histories differed, the most recent edit wins (D32), unless one pick was checked: a checked pick always stands. Items added to a pool today join the rotation tomorrow. | Every device must agree, and a pick mustn't jump mid-day. A recorded pick is a fact, like a completion, so History is still recomputed from records (D40), not snapshotted at the reset. | agent |
| D62 | **If a pool has fewer active items than the daily number, all of them show.** With none active, the task shows as a plain row with a note that its pool is empty. | Nothing breaks when the owner pauses everything. | agent |
| D63 | **Only repeating tasks have buckets.** "Make one-off" isn't offered while a task has a bucket; remove the bucket first. | A one-off has nothing to rotate through, and this avoids an awkward conversion. | agent |
| D64 | **Every row on Today counts once toward the ring and the taskbar badge:** each pick and extra, carried task and due list task. | Matches what the owner sees in the list. | agent |
| D65 | **A due list task has its own place on Today**, separate from its place in its list. Dragging it on Today doesn't reorder the list. | The two orders mean different things. | agent |
| D66 | **A bucket task's picks sit together at its place**, in slot order, with extras right after them. Dragging a pick row moves that row today and also sets the task's place, so from tomorrow all its picks start there. With one pick a day, that's the same as dragging any task. | Keeps "each pick drags on its own" without a separate control for the task's place. | agent |
| D67 | **Reordering has a keyboard way** (move up / move down on a focused row) as well as mouse and touch drag. | Accessibility, and fine control in the narrow Windows window. | agent |
| D68 | **Existing data converts automatically.** Habits become repeating tasks set to drop. Today-only tasks become one-off tasks set to roll over. On Today, habits come first, then tasks, each in its current order. List tasks due at conversion start at the top as newly due. Nothing is lost or re-dated. | Behavior is unchanged until the owner changes a setting. | agent |
| D69 | **Reminders stay per task.** A bucket task's reminder fires once for the task, not once per pick. A carried task's reminder doesn't fire again (D42). | Avoids a burst of notifications for one task. | agent |
| D70 | **History shows dropped one-off tasks** on their day as not done, and **bucket picks by item name**, done or not. Carried tasks show on the day they were done, as in v1. | Gives every dropped task its trace, and shows which account got the post. | agent |
| D71 | **Repeat, missed settings and buckets are for daily tasks only.** Named-list tasks keep due dates and v1's due/overdue behavior (D27). | Keeps the change to the daily list. Lists already have their own way of not losing things. | user |
| D72 | **Old Windows clients keep working without a version gate.** New state lives in item fields an old client passes through untouched when it edits, or in new record types it stores and ignores. An old client may show a bucket or carried task as a plain habit until it updates. That's acceptable because updates arrive by themselves (D38). | Avoids a forced-update mechanism for what's mostly a one-user window. | agent |
| D73 | **A new task, a new bucket task, or a task made repeating today counts from today** (D40's rule for new habits). Turning on, changing or removing a bucket on an existing task, and changing its daily number, apply from the next reset. Pausing or deleting a pool item is the exception: it replaces today's unchecked pick at once. | Matches D51 and D34, while a new task still shows up when it's made. | agent |
| D74 | **A skipped pick isn't missed.** The replacement takes its slot, and only that replacement can be missed and carried. A carried pick fills a slot on the next day before fresh picks do, so a carry and a fresh pick are never the same slot (D60). | Skipping is a choice, not a miss. | agent |

"user" means the user chose it in the interview. "agent" means the interviewer made the call, so check those first.

## Constraints

- **The server must ship first.** The Worker rejects fields and entities it doesn't know, so the new item fields and any new record types (pool items, skips, per-occurrence subtask checks) go to production, with any D1 migration applied remotely, before a client that writes them. A new entity type means rebuilding `sync_records` as the AGENTS.md gotcha describes. Update the sync API contract with it.
- **Installed Windows apps update on their own schedule (D38).** An older client must not strip or corrupt the new fields when it edits a task. Check this before shipping the client.
- **The sync rules hold (D32, D39):** most recent edit wins per record, a delete wins, and completions are their own records. A reorder must edit as few records as possible (ideally just the moved one), so two devices reordering offline don't overwrite each other's whole list.
- **History is recomputed, not snapshotted (D40).** Repeat, missed-setting and daily-number changes must be versioned by the day they take effect, so past days keep showing what was scheduled then. Bucket picks are recorded facts (D61), like completions.
- **The day boundary is still the account's time zone and day-start hour**, computed on the device (D6, D30).
- **One UI and one sync engine (D12, D13).** None of this goes in Rust.
- **Update the v1 spec's decisions table in the same change** that builds this, marking D3, D5, D22, D26 and D27 as changed by D47–D55, and refresh the AGENTS.md status and layout notes.

## Edge cases and failures

- **Offline for several days with a carried repeating task.** The day count is right on return, it shows once, and each missed scheduled day is missed in History.
- **Two devices reorder offline.** After sync, each moved task ends up where its latest drag put it. No task disappears or duplicates. An exact tie in position falls back to a stable order.
- **Two devices check different picks of the same bucket for the same day offline.** Both checks stand, and the next day's pick takes both into account.
- **Two devices skip offline.** Both skips stand. The day shows the next unskipped item(s).
- **A pool item is deleted.** It leaves the rotation. Its past picks keep its name in History (archived like a deleted habit, D34).
- **The daily number is changed.** It applies from the next reset.
- **The missed setting is changed while a task is carried.** Switching to drop ends the carry at the next reset. Switching to roll over applies to occurrences missed after the change.
- **A repeating task is turned into a one-off.** Today's occurrence stays. Future occurrences stop from the next reset, and past days keep their history.
- **A list task due today is finished or its due date moved.** It leaves Today as in v1 (D27).
- **Empty states.** An empty pool shows the plain task with a note (D62). An empty Today keeps v1's invitation, rewritten for one list.
- **Limits.** Pool items and per-day picks count toward D31's limits like any record. A pool is capped at a generous number (the builder picks it, in the spirit of D31's 100 subtasks per task).

## Open questions

None.

## Left to the builder

- The data model: whether "once" becomes a schedule version, how carry state and per-occurrence subtask checks are recorded, and how positions are represented (fractional or otherwise), within the constraints above.
- Where the repeat, missed and bucket controls sit in the add box and the task details, and what the repeat marker, carried tag and pick rows look like, within Signal and the five themes (D22, D46).
- The drag library or hand-rolled drag, and its touch behavior.
- Where *Skip* and *Do another* live on a pick row.
- The pool size cap.

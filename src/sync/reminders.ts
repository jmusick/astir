import { addDays, dayAt, settingsOn, weekdayOf, zonedInstant } from './day';
import { scheduleOn, schedulesByItem } from './daily';
import { blank, checkedAt, habitCompletionId, isCompleted, live, taskCompletionId } from './records';
import { recordKey } from './types';
import type { DayData, DismissalData, ItemData, SyncRecord } from './types';

// When reminders are due (D16, D42). Pure, like daily.ts: the web view's notifier and, later, the
// native app ask the same question. A today-only task's reminder is a time on its original day
// only, so it doesn't fire again once it rolls over; a recurring item's is a time on each
// scheduled day; a list task's is one instant, so it doesn't fire again once it's overdue.

export interface DueReminder {
  item: SyncRecord<ItemData>;
  /** The dismissal record's ID: itemId:day for a habit's day, itemId:task for a task. */
  id: string;
  /** The account day a habit's reminder belongs to; null for tasks. */
  day: string | null;
  /** The item's reminder value when it fired, so a changed time fires again. */
  reminder: string;
  /** When it's due, in epoch milliseconds. */
  at: number;
}

/** A habit or today-only reminder's HH:mm on an account day. Times before the day-start hour fall after midnight. */
export function reminderInstant(versions: readonly DayData[], day: string, time: string): number {
  const settings = settingsOn(versions, day);
  const wallDay = Number(time.slice(0, 2)) < settings.startHour ? addDays(day, 1) : day;
  return zonedInstant(wallDay, time, settings.timeZone);
}

function isDismissed(records: ReadonlyMap<string, SyncRecord>, id: string, reminder: string): boolean {
  return live<DismissalData>(records, recordKey('dismissal', id))?.data?.reminder === reminder;
}

/**
 * Reminders due after `from` and up to `to` that are still worth showing: the item is live and
 * open, and nobody dismissed this reminder on any device. A window only reaches back to when the
 * caller last looked, so a reminder that passed while nothing was watching isn't shown later.
 */
export function remindersDue(records: ReadonlyMap<string, SyncRecord>, versions: readonly DayData[], from: number, to: number): DueReminder[] {
  if (to <= from) return [];
  const due: DueReminder[] = [];
  const schedules = schedulesByItem(records);
  // A habit's reminder may fall on the account day before `from` (a time before the day-start hour).
  const firstDay = addDays(dayAt(versions, from), -1);
  const lastDay = dayAt(versions, to);
  for (const record of records.values()) {
    if (record.entity !== 'item' || record.deleted || !record.data) continue;
    const item = record as SyncRecord<ItemData>;
    const data = item.data!;
    if (!data.reminder || data.parentId) continue;
    const add = (id: string, day: string | null, at: number) => {
      if (at > from && at <= to && !isDismissed(records, id, data.reminder!)) due.push({ item, id, day, reminder: data.reminder!, at });
    };
    if (data.kind === 'habit') {
      // Capped so a long gap can't loop for ages; such a window is filtered by its caller anyway.
      for (let day = firstDay, n = 0; day <= lastDay && n < 3; day = addDays(day, 1), n++) {
        if (!data.createdDay || day < data.createdDay) continue;
        if (!scheduleOn(schedules.get(item.id), day)?.weekdays.includes(weekdayOf(day))) continue;
        if (isCompleted(records, habitCompletionId(item.id, day))) continue;
        add(habitCompletionId(item.id, day), day, reminderInstant(versions, day, data.reminder));
      }
    } else if (checkedAt(records, item.id) === null) {
      const at = data.kind === 'today' ? data.originalDay ? reminderInstant(versions, data.originalDay, data.reminder) : NaN : Date.parse(data.reminder);
      if (Number.isFinite(at)) add(taskCompletionId(item.id), null, at);
    }
  }
  return due.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Records that a reminder was dismissed, so devices that haven't shown it yet skip it (D42). */
export function dismissed(reminder: Pick<DueReminder, 'item' | 'id' | 'day' | 'reminder'>): SyncRecord[] {
  return [blank<DismissalData>('dismissal', reminder.id, { itemId: reminder.item.id, day: reminder.day, reminder: reminder.reminder })];
}

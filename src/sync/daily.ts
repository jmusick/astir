import { daysBetween, weekdayOf } from './day';
import { dueEntries } from './lists';
import type { DueEntry } from './lists';
import { blank, byPosition, checkedAt, CLOCK_SLACK_MS, habitCompletionId, isCompleted, scheduleId, subtasksByParent, taskCompletionId, tombstone } from './records';
import type { Entry } from './records';
import type { CompletionData, ItemData, ScheduleData, SyncRecord } from './types';

// The daily list's model: what Today shows, and the full records each edit produces.
// Everything here is pure, so it's shared by every client and tested without a browser.

export { cleanNotes, cleanTitle, habitCompletionId, isCompleted, NOTES_MAX, scheduleId, taskCompletionId, TITLE_MAX } from './records';
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** Monday first, as most people read a week. Values are 0 (Sunday) to 6 (Saturday). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon, Wed and Fri" */
export function describeDays(weekdays: readonly number[]): string {
  const names = WEEK.filter((d) => weekdays.includes(d)).map((d) => SHORT_DAYS[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

export interface TodayEntry extends Entry {
  /** A today-only task's checklist (D26); subtasks don't count toward the ring. */
  subtasks?: Entry[];
  /** Which day of its life a today-only task is on: 1 on its original day, 2 after one rollover (D41). */
  dayCount?: number;
}
export interface TodayView {
  day: string;
  habits: TodayEntry[];
  tasks: TodayEntry[];
  /** Named-list tasks due today or overdue (D27). They count toward the ring. */
  due: DueEntry[];
  done: number;
  total: number;
  /** 0–100, rounded. 0 when nothing is planned. */
  percent: number;
  /** True when this account has no live habits, tasks or lists at all (the first-run empty state). */
  isNew: boolean;
}

/** The schedule in effect on a day: the latest version effective on or before it (D40). */
export function scheduleOn(versions: readonly ScheduleData[] | undefined, day: string): ScheduleData | undefined {
  let best: ScheduleData | undefined;
  for (const version of versions ?? []) {
    if (version.effectiveDay <= day && (!best || version.effectiveDay > best.effectiveDay)) best = version;
  }
  return best;
}

function schedulesByItem(records: ReadonlyMap<string, SyncRecord>) {
  const byItem = new Map<string, ScheduleData[]>();
  for (const record of records.values()) {
    if (record.entity !== 'schedule' || record.deleted || !record.data) continue;
    const data = record.data as ScheduleData;
    byItem.set(data.itemId, [...byItem.get(data.itemId) ?? [], data]);
  }
  return byItem;
}

/** "2nd day", "3rd day", "11th day", "21st day" */
export function carriedLabel(dayCount: number): string {
  const tens = dayCount % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][dayCount % 10] ?? 'th';
  return `${dayCount}${suffix} day`;
}

/**
 * What Today shows on a day. Habits uncheck because their completions are per day. Unfinished
 * today-only tasks roll forward from their original day (D5); a finished one stays on the day it
 * was checked. `dayOf` maps an edit time to its account day, which dates a task's checkmark.
 */
export function todayView(records: ReadonlyMap<string, SyncRecord>, day: string, dayOf: (editedAt: number) => string): TodayView {
  const weekday = weekdayOf(day);
  const habits: TodayEntry[] = [];
  const tasks: TodayEntry[] = [];
  const schedules = schedulesByItem(records);
  const subtasks = subtasksByParent(records);
  let isNew = true;
  for (const record of records.values()) {
    if (record.entity === 'list' && !record.deleted && record.data) isNew = false;
    if (record.entity !== 'item' || record.deleted || !record.data) continue;
    isNew = false;
    const item = record as SyncRecord<ItemData>;
    const data = item.data!;
    if (data.kind === 'habit') {
      if (!data.createdDay || data.createdDay > day) continue;
      if (!scheduleOn(schedules.get(item.id), day)?.weekdays.includes(weekday)) continue;
      habits.push({ item, done: isCompleted(records, habitCompletionId(item.id, day)) });
    } else if (data.kind === 'today' && !data.parentId) {
      const original = data.originalDay;
      if (!original || original > day) continue;
      const checked = checkedAt(records, item.id);
      // Checked before this day: it was finished on an earlier day and doesn't roll over.
      if (checked !== null && original < day && dayOf(checked) < day) continue;
      // Edit stamps may run a few minutes ahead (D32 clamps at five), so a check just before the
      // reset still counts for the day it was made.
      const done = checked !== null && dayOf(checked - CLOCK_SLACK_MS) <= day;
      tasks.push({ item, done, subtasks: subtasks.get(item.id) ?? [], dayCount: daysBetween(original, day) + 1 });
    }
  }
  habits.sort(byPosition); tasks.sort(byPosition);
  const due = dueEntries(records, day, dayOf, subtasks);
  const counted = [...habits, ...tasks, ...due];
  const total = counted.length;
  const done = counted.filter((entry) => entry.done).length;
  return { day, habits, tasks, due, done, total, percent: total ? Math.round((done / total) * 100) : 0, isNew };
}

/** "2 done · 3 to go" */
export const progressLabel = (view: Pick<TodayView, 'done' | 'total'>) => `${view.done} done · ${view.total - view.done} to go`;

export function normalizeWeekdays(weekdays: number[]): number[] {
  const unique = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (!unique.length) throw new Error('Choose at least one day.');
  return unique;
}

// Record builders. editedAt is a placeholder: SyncEngine.change stamps the real edit time.
const record = blank;

/** A new habit and its first schedule version, effective on the day it's created (D40). */
export function newHabit(id: string, title: string, weekdays: number[], day: string, position: number): SyncRecord[] {
  const item: ItemData = { kind: 'habit', title, createdDay: day, position };
  const schedule: ScheduleData = { itemId: id, effectiveDay: day, weekdays: normalizeWeekdays(weekdays) };
  return [record('item', id, item), record('schedule', scheduleId(id, day), schedule)];
}

export function newTodayTask(id: string, title: string, day: string, position: number): SyncRecord[] {
  return [record('item', id, { kind: 'today', title, originalDay: day, position } satisfies ItemData)];
}

/** Check or uncheck. Unchecking is an edit (completed: false), never a delete. */
export function setCompleted(item: SyncRecord<ItemData>, day: string, completed: boolean): SyncRecord[] {
  const habit = item.data!.kind === 'habit';
  const data: CompletionData = { itemId: item.id, day: habit ? day : null, completed };
  return [record('completion', habit ? habitCompletionId(item.id, day) : taskCompletionId(item.id), data)];
}

/** Renames send the whole record, not a patch. */
export function renamed(item: SyncRecord<ItemData>, title: string): SyncRecord[] {
  return edited(item, { title });
}

/** Notes, due date and reminder edits: the whole record with the changed fields. */
export function edited(item: SyncRecord<ItemData>, changes: Partial<Pick<ItemData, 'title' | 'notes' | 'dueDay' | 'reminder'>>): SyncRecord[] {
  return [{ ...item, data: { ...item.data!, ...changes } }];
}

/**
 * A tombstone that keeps its data, so a deleted habit is archived with its history (D34). Sync
 * never cascades, so a task's subtasks go with it when the records are given.
 */
export function removed(item: SyncRecord<ItemData>, records?: ReadonlyMap<string, SyncRecord>): SyncRecord[] {
  const children = records ? (subtasksByParent(records).get(item.id) ?? []).map((entry) => tombstone(entry.item)) : [];
  return [tombstone(item), ...children];
}

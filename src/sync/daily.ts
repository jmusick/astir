import { daysBetween, weekdayOf } from './day';
import { dueEntries } from './lists';
import { blank, bottomPlace, byPosition, checkedAt, CLOCK_SLACK_MS, habitCompletionId, isCompleted, reorder, scheduleId, subtasksByParent, taskCompletionId, tombstone } from './records';
import type { Entry } from './records';
import type { CompletionData, ItemData, ScheduleData, SyncRecord } from './types';

// The daily list's model: what Today shows, and the full records each edit produces.
// Everything here is pure, so it's shared by every client and tested without a browser.

export { cleanNotes, cleanTitle, habitCompletionId, isCompleted, NOTES_MAX, repositioned, scheduleId, taskCompletionId, TITLE_MAX } from './records';
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** Monday first, as most people read a week. Values are 0 (Sunday) to 6 (Saturday). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon, Wed and Fri" */
export function describeDays(weekdays: readonly number[]): string {
  const names = WEEK.filter((d) => weekdays.includes(d)).map((d) => SHORT_DAYS[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

/** "Every day" or "Mon, Wed and Fri" */
export const repeatLabel = (weekdays: readonly number[]) => weekdays.length === 7 ? 'Every day' : describeDays(weekdays);

/** Where a Today row comes from: a habit, a today-only task, or a named-list task that's due (D27). */
export type TodaySource = 'habit' | 'today' | 'list';
export interface TodayEntry extends Entry {
  source: TodaySource;
  /** Its place in the one list (D47, D48). Null while it waits at the top until dragged (D54). */
  place: number | null;
  /** Subtasks of today-only and list tasks (D26); they don't count toward the ring. */
  subtasks?: Entry[];
  /** Which day of its life a today-only task is on: 1 on its original day, 2 after one rollover (D41). */
  dayCount?: number;
  /** A habit's weekdays today, for the repeat marker (D47). */
  repeats?: number[];
  /** A due list task's list name (D47). */
  listTitle?: string;
  /** A due list task's days past its due date: 0 when due today. */
  overdue?: number;
}
export interface TodayView {
  day: string;
  /** One list in the owner's order (D47): rows waiting at the top first, then by place. */
  entries: TodayEntry[];
  done: number;
  total: number;
  /** 0–100, rounded. 0 when nothing is planned. */
  percent: number;
  /** True when this account has no live habits, tasks or lists at all (the first-run empty state). */
  isNew: boolean;
}

/**
 * v1 records have no todayPosition. Their positions are creation times, so shifting habits below
 * every task puts the habits first, then the tasks, each in its old order (D68), without
 * rewriting a record. Holds while positions stay under the shift (creation times until 2286).
 */
const LEGACY_HABIT_SHIFT = 1e13;
/** A habit's or today-only task's usual place on Today. */
export function todayPlace(data: ItemData): number {
  if (data.todayPosition != null) return data.todayPosition;
  const position = data.position ?? 0;
  return data.kind === 'habit' ? position - LEGACY_HABIT_SHIFT : position;
}
/** A due list task has its own Today place for this due date only, separate from its list place (D54, D65). */
const duePlace = (data: ItemData) => data.carryPosition != null && data.carryDay != null && data.carryDay === data.dueDay ? data.carryPosition : null;

/** Waiting rows first, most overdue first and then in their list's order; then everything else by place. */
function byTodayOrder(a: TodayEntry, b: TodayEntry): number {
  if (a.place === null || b.place === null) {
    if (a.place !== null) return 1;
    if (b.place !== null) return -1;
    return (b.overdue ?? 0) - (a.overdue ?? 0) || byPosition(a, b);
  }
  return a.place - b.place || a.item.id.localeCompare(b.item.id);
}

/** The schedule in effect on a day: the latest version effective on or before it (D40). */
export function scheduleOn(versions: readonly ScheduleData[] | undefined, day: string): ScheduleData | undefined {
  let best: ScheduleData | undefined;
  for (const version of versions ?? []) {
    if (version.effectiveDay <= day && (!best || version.effectiveDay > best.effectiveDay)) best = version;
  }
  return best;
}

/** Every live schedule version, grouped by item. Archived habits keep theirs, so history can use them (D34). */
export function schedulesByItem(records: ReadonlyMap<string, SyncRecord>) {
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
 * What Today shows on a day, as one ordered list (D47). Habits uncheck because their completions
 * are per day. Unfinished today-only tasks roll forward from their original day (D5); a finished
 * one stays on the day it was checked. List tasks due today or overdue join in (D27). `dayOf` maps
 * an edit time to its account day, which dates a task's checkmark.
 */
export function todayView(records: ReadonlyMap<string, SyncRecord>, day: string, dayOf: (editedAt: number) => string): TodayView {
  const weekday = weekdayOf(day);
  const entries: TodayEntry[] = [];
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
      const schedule = scheduleOn(schedules.get(item.id), day);
      if (!schedule?.weekdays.includes(weekday)) continue;
      entries.push({ item, source: 'habit', place: todayPlace(data), done: isCompleted(records, habitCompletionId(item.id, day)), repeats: schedule.weekdays });
    } else if (data.kind === 'today' && !data.parentId) {
      const original = data.originalDay;
      if (!original || original > day) continue;
      const checked = checkedAt(records, item.id);
      // Checked before this day: it was finished on an earlier day and doesn't roll over.
      if (checked !== null && original < day && dayOf(checked) < day) continue;
      // Edit stamps may run a few minutes ahead (D32 clamps at five), so a check just before the
      // reset still counts for the day it was made.
      const done = checked !== null && dayOf(checked - CLOCK_SLACK_MS) <= day;
      entries.push({ item, source: 'today', place: todayPlace(data), done, subtasks: subtasks.get(item.id) ?? [], dayCount: daysBetween(original, day) + 1 });
    }
  }
  for (const due of dueEntries(records, day, dayOf, subtasks)) entries.push({ ...due, source: 'list', place: duePlace(due.item.data!) });
  entries.sort(byTodayOrder);
  const total = entries.length;
  const done = entries.filter((entry) => entry.done).length;
  return { day, entries, done, total, percent: total ? Math.round((done / total) * 100) : 0, isNew };
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
  const item: ItemData = { kind: 'habit', title, createdDay: day, position, todayPosition: position };
  const schedule: ScheduleData = { itemId: id, effectiveDay: day, weekdays: normalizeWeekdays(weekdays) };
  return [record('item', id, item), record('schedule', scheduleId(id, day), schedule)];
}

export function newTodayTask(id: string, title: string, day: string, position: number): SyncRecord[] {
  return [record('item', id, { kind: 'today', title, originalDay: day, position, todayPosition: position } satisfies ItemData)];
}

/** Where a new habit or today-only task goes: below everything on Today (D50). */
export function todayBottom(records: ReadonlyMap<string, SyncRecord>, now: number): number {
  const places: number[] = [];
  for (const record of records.values()) {
    const data = record.data as ItemData | null;
    if (record.entity !== 'item' || record.deleted || !data || data.parentId) continue;
    if (data.kind === 'habit' || data.kind === 'today') places.push(todayPlace(data));
    // A due list task dragged low on Today counts too, so the new task still lands below it.
    else if (data.carryPosition != null) places.push(data.carryPosition);
  }
  return bottomPlace(places, now);
}

/** Today after a drag (D49): only the moved rows change, each in the field that holds its Today place. */
export function reorderedToday(entries: readonly TodayEntry[], from: number, to: number): SyncRecord[] {
  return reorder(entries, (entry) => entry.place, from, to).map(({ item: entry, place }) => ({
    ...entry.item,
    data: entry.source === 'list'
      // A due list task's Today place lasts for this due date only, and never moves it in its list (D65).
      ? { ...entry.item.data!, carryPosition: place, carryDay: entry.item.data!.dueDay ?? null }
      : { ...entry.item.data!, todayPosition: place },
  }));
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

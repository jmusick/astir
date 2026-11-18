import { addDays, daysBetween } from './day';
import { dueEntries } from './lists';
import { blank, bottomPlace, checkedAt, CLOCK_SLACK_MS, habitCompletionId, isCompleted, reorder, scheduleId, subtasksByParent, taskCompletionId, tombstone } from './records';
import type { Entry } from './records';
import { carryEnds, missedOn, repeatCarry, repeatsOn, sortedVersions, weekdaysOn } from './repeats';
import type { Missed } from './repeats';
import { bucketRecords, dayPicks, PER_DAY_MAX, perDayOn, pickCheckId } from './buckets';
import type { CompletionData, ItemData, PickData, PoolData, ScheduleData, SyncRecord } from './types';

// The daily list's model: what Today shows, and the full records each edit produces.
// Everything here is pure, so it's shared by every client and tested without a browser.

export type { Missed } from './repeats';
export { defaultMissed } from './repeats';
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
  /** Its usual place, which orders rows waiting at the top that tie (D54): its list place for a list task. */
  usual: number;
  /** Subtasks of today-only and list tasks (D26); they don't count toward the ring. */
  subtasks?: Entry[];
  /** Which day of its carry a task is on: 1 on its own day, 2 after one rollover (D41, D53). */
  dayCount?: number;
  /** The weekdays a repeating task repeats on today, for the repeat marker (D47). */
  repeats?: number[];
  /** A due list task's list name (D47). */
  listTitle?: string;
  /**
   * The day a carry or due date began: the missed occurrence's day, or a list task's due date.
   * Such a row waits at the top until dragged, and a drag places it for that carry only (D54).
   */
  carry?: string;
  /** Days since `carry`: how overdue a list task is, or how long a task has been carried. */
  overdue?: number;
  /** The day its checkmark is recorded for, or null for a one-off's own itemId:task record. */
  completionDay: string | null;
  /**
   * The occurrence its subtasks are checked for: the day a carry began, so a carried checklist keeps
   * its checks until the task is done (D55), or null for a one-off's own day (itemId:task records).
   */
  subtaskDay?: string | null;
  /** A bucket pick row (D56): titled "Task: Item", checked on its pick record. */
  pick?: { record: SyncRecord<PickData>; name: string; notes: string; extra: boolean };
  /** Orders rows that share a place: a bucket task's picks in slot order (D66). */
  sub?: number;
  /** A bucket task whose pool has no active items shows as a plain row with a note (D62). */
  bucketEmpty?: boolean;
  /** On a bucket task's last row: the next item in line for "Do another" (D57). */
  another?: SyncRecord<PoolData>;
}
export interface TodayView {
  day: string;
  /** One list in the owner's order (D47): rows waiting at the top first, then by place. */
  entries: TodayEntry[];
  /** Picks decided on this view that aren't recorded yet; the screen saves them (D61). */
  toRecord: SyncRecord[];
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
/**
 * A carried or due task's place for this carry or due date only, separate from its usual place and
 * its list place (D54, D65). Null until it's dragged during this one.
 */
const carryPlace = (data: ItemData, carry: string) => data.carryPosition != null && data.carryDay === carry ? data.carryPosition : null;

/** A daily row's place and carry tag: at the top while carried until dragged (D54), else its usual place. */
function placed(data: ItemData, carry: string | null, day: string) {
  const usual = todayPlace(data);
  if (!carry) return { place: usual, usual, dayCount: 1 };
  return { place: carryPlace(data, carry), usual, carry, overdue: daysBetween(carry, day), dayCount: daysBetween(carry, day) + 1 };
}

/** Waiting rows first, most overdue first and then in their list's order; then everything else by place. */
function byTodayOrder(a: TodayEntry, b: TodayEntry): number {
  if (a.place === null || b.place === null) {
    if (a.place !== null) return 1;
    if (b.place !== null) return -1;
    return (b.overdue ?? 0) - (a.overdue ?? 0) || a.usual - b.usual || a.item.id.localeCompare(b.item.id);
  }
  return a.place - b.place || a.item.id.localeCompare(b.item.id) || (a.sub ?? 0) - (b.sub ?? 0);
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
  const entries: TodayEntry[] = [];
  const schedules = schedulesByItem(records);
  const subtasks = subtasksByParent(records);
  const checkedDays = completedDays(records);
  const buckets = bucketRecords(records);
  const toRecord: SyncRecord[] = [];
  /**
   * A bucket task's rows: one per pick, carried picks included even on a day it isn't scheduled (D60),
   * or the plain task with a note when its bucket has nothing active (D62). Null when it has neither.
   */
  const bucketRows = (base: TodayEntry, sorted: readonly ScheduleData[], scheduled: boolean): TodayEntry[] | null => {
    const bucketDay = scheduled && perDayOn(sorted, day) > 0;
    if (!buckets.pools.has(base.item.id)) return bucketDay ? [{ ...base, bucketEmpty: true }] : null;
    const { picks, next } = dayPicks(buckets, base.item.id, base.item.data!.kind, sorted, day, { scheduled });
    if (!picks.length) return bucketDay ? [{ ...base, bucketEmpty: true }] : null;
    const usual = todayPlace(base.item.data!);
    const checklist = subtasks.get(base.item.id) ?? [];
    const rows = picks.map(({ pool, record, fresh, carry }, i): TodayEntry => {
      if (fresh) toRecord.push(record);
      // A carried pick waits at the top until dragged during this carry (D54, D60).
      const where = carry ? { carry, overdue: daysBetween(carry, day), dayCount: daysBetween(carry, day) + 1, place: record.data!.place ?? null }
        : { carry: undefined, overdue: undefined, dayCount: 1, place: record.data!.place ?? usual };
      return { ...base, ...where, usual, done: !!record.data!.done, sub: i,
        // Each pick row has its own copy of the task's checklist (D59).
        subtasks: checklist.map((sub) => ({ ...sub, done: isCompleted(records, pickCheckId(sub.item.id, record)) })), subtaskDay: undefined,
        pick: { record, name: pool.data!.name, notes: pool.data!.notes ?? '', extra: !!record.data!.extra } };
    });
    if (next && picks.every((p) => p.record.data!.done)) rows[rows.length - 1] = { ...rows[rows.length - 1], another: next };
    return rows;
  };
  let isNew = true;
  for (const record of records.values()) {
    if (record.entity === 'list' && !record.deleted && record.data) isNew = false;
    if (record.entity !== 'item' || record.deleted || !record.data) continue;
    isNew = false;
    const item = record as SyncRecord<ItemData>;
    const data = item.data!;
    if (data.parentId || (data.kind !== 'habit' && data.kind !== 'today')) continue;
    const sorted = sortedVersions(schedules.get(item.id));
    const weekdays = weekdaysOn(sorted, day);
    const repeats = weekdays.length ? { repeats: weekdays } : {};
    const scheduled = repeatsOn(data, sorted, day);
    const days = checkedDays.get(item.id) ?? [];
    if (data.kind === 'habit') {
      // A missed repeat set to roll over waits until it's checked, shown once even on its next scheduled day (D53).
      const carry = repeatCarry(data, sorted, days, day);
      const subtaskDay = carry ?? day;
      const base: TodayEntry = { ...placed(data, carry, day), item, source: 'habit', completionDay: day, done: isCompleted(records, habitCompletionId(item.id, day)),
        subtasks: checklistOn(records, subtasks.get(item.id), subtaskDay), subtaskDay, ...repeats };
      const picked = bucketRows(base, sorted, scheduled);
      // A carry from before its bucket began still shows as the task itself, so nothing is lost.
      if (picked) entries.push(...picked, ...(carry ? [base] : []));
      else if (scheduled || carry) entries.push(base);
      continue;
    }
    const original = data.originalDay;
    if (!original || original > day) continue;
    // The one-off's own occurrence: on its day, then carried until it's checked unless it's set to drop (D5, D52).
    const checked = checkedAt(records, item.id);
    const settledBefore = (checked !== null && original < day && dayOf(checked) < day) || days.some((d) => d >= original && d < day);
    const ends = carryEnds(data.kind, sorted, original);
    const pending = day === original || (!settledBefore && (ends === null || ends > day));
    // Edit stamps may run a few minutes ahead (D32 clamps at five), so a check just before the
    // reset still counts for the day it was made.
    const doneHere = checked !== null && !settledBefore && dayOf(checked - CLOCK_SLACK_MS) <= day;
    // Its repeats carry like any repeating task's; its own check settles them too.
    const repeatCarried = repeatCarry(data, sorted, checked === null ? days : [...days, dayOf(checked)], day);
    if (!pending && !scheduled && !repeatCarried) continue;
    const carry = pending && day > original ? original : repeatCarried;
    // Every occurrence on one row shows once, and checking it settles them all (D53). Only its own day
    // keeps the itemId:task records older clients read, for the task and its checklist.
    const perDay = scheduled || !!repeatCarried;
    const subtaskDay = perDay && (carry ?? day) !== original ? carry ?? day : null;
    const shared = { ...placed(data, carry, day), item, source: 'today' as const, subtasks: checklistOn(records, subtasks.get(item.id), subtaskDay), subtaskDay, ...repeats };
    if (perDay) {
      const base: TodayEntry = { ...shared, completionDay: day, done: isCompleted(records, habitCompletionId(item.id, day)) || (pending && doneHere) };
      entries.push(...(!carry && bucketRows(base, sorted, scheduled)) || [base]);
    }
    else entries.push({ ...shared, completionDay: null, done: doneHere });
  }
  for (const due of dueEntries(records, day, dayOf, subtasks)) {
    const carry = due.item.data!.dueDay!;
    entries.push({ ...due, source: 'list', carry, place: carryPlace(due.item.data!, carry), usual: due.item.data!.position ?? 0, completionDay: null });
  }
  entries.sort(byTodayOrder);
  const total = entries.length;
  const done = entries.filter((entry) => entry.done).length;
  return { day, entries, toRecord, done, total, percent: total ? Math.round((done / total) * 100) : 0, isNew };
}

/** A daily task's checklist for one occurrence: each subtask's own check that day, or its itemId:task check. */
function checklistOn(records: ReadonlyMap<string, SyncRecord>, entries: readonly Entry[] | undefined, occurrence: string | null): Entry[] {
  if (!entries) return [];
  return occurrence === null ? [...entries] : entries.map((entry) => ({ ...entry, done: isCompleted(records, habitCompletionId(entry.item.id, occurrence)) }));
}

/** The days each item has a live, checked per-day completion for. */
export function completedDays(records: ReadonlyMap<string, SyncRecord>): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  for (const record of records.values()) {
    if (record.entity !== 'completion' || record.deleted || !record.data) continue;
    const data = record.data as CompletionData;
    if (data.day && data.completed && !data.poolId) byItem.set(data.itemId, [...byItem.get(data.itemId) ?? [], data.day]);
  }
  return byItem;
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

/** A new repeating task and its first schedule version, effective on the day it's created (D40, D73). */
export function newHabit(id: string, title: string, weekdays: number[], day: string, position: number, missed: Missed = 'drop'): SyncRecord[] {
  const item: ItemData = { kind: 'habit', title, createdDay: day, position, todayPosition: position };
  const schedule: ScheduleData = { itemId: id, effectiveDay: day, weekdays: normalizeWeekdays(weekdays), missed };
  return [record('item', id, item), record('schedule', scheduleId(id, day), schedule)];
}

/** A new one-off task. Rolling over is its default (D52), so only a drop needs a schedule version saying so. */
export function newTodayTask(id: string, title: string, day: string, position: number, missed: Missed = 'carry'): SyncRecord[] {
  const item = record('item', id, { kind: 'today', title, originalDay: day, position, todayPosition: position } satisfies ItemData);
  if (missed === 'carry') return [item];
  return [item, record('schedule', scheduleId(id, day), { itemId: id, effectiveDay: day, weekdays: [], missed } satisfies ScheduleData)];
}

/** A daily task's repeat and missed setting as they'll be from the next reset. */
export interface RepeatSetting { weekdays: number[]; missed: Missed; /** Bucket picks a day; 0 for no bucket (D56). */ perDay: number }
export function upcomingRepeat(records: ReadonlyMap<string, SyncRecord>, item: SyncRecord<ItemData>, day: string): RepeatSetting {
  const sorted = sortedVersions(schedulesByItem(records).get(item.id));
  const next = addDays(day, 1);
  return { weekdays: weekdaysOn(sorted, next), missed: missedOn(item.data!.kind, sorted, next), perDay: perDayOn(sorted, next) };
}

/**
 * Change a daily task's repeat (no weekdays: once), missed setting or bucket from the next reset
 * (D51, D52, D73). Today stays as it is, and past days keep what applied then (D40). A repeating task
 * created today is still new, so its changes count from today, as its first version did (D73). A
 * second change before the reset replaces the first, since both are versions for the same day.
 */
export function repeatChanged(item: SyncRecord<ItemData>, day: string, weekdays: number[], missed: Missed, perDay = 0): SyncRecord[] {
  const effectiveDay = item.data!.kind === 'habit' && item.data!.createdDay === day && weekdays.length ? day : addDays(day, 1);
  const normalized = weekdays.length ? normalizeWeekdays(weekdays) : [];
  // Only repeating tasks have buckets (D63).
  const bucket = normalized.length ? Math.max(0, Math.min(PER_DAY_MAX, Math.round(perDay))) : 0;
  return [record('schedule', scheduleId(item.id, effectiveDay), { itemId: item.id, effectiveDay, weekdays: normalized, missed, perDay: bucket } satisfies ScheduleData)];
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
  return reorder(entries, (entry) => entry.place, from, to).flatMap(({ item: entry, place }): SyncRecord[] => entry.pick && entry.carry
    // A carried pick is placed for this carry only, and never moves its task (D54).
    ? [{ ...entry.pick.record, data: { ...entry.pick.record.data!, place } }]
    : entry.pick
    // A pick row moves today, and sets its task's usual place so its picks start there tomorrow
    // (D66). The task's other picks today stay put, so they're pinned where they are.
    ? [{ ...entry.pick.record, data: { ...entry.pick.record.data!, place } }, { ...entry.item, data: { ...entry.item.data!, todayPosition: place } },
      ...entries.filter((other) => other !== entry && other.item.id === entry.item.id && other.pick && other.pick.record.data!.place == null && other.place !== null)
        .map((other) => ({ ...other.pick!.record, data: { ...other.pick!.record.data!, place: other.place } }))]
    : [{
    ...entry.item,
    data: entry.carry
      // A carried or due task's place lasts for this carry only, and never moves a list task in its list (D54, D65).
      ? { ...entry.item.data!, carryPosition: place, carryDay: entry.carry }
      : { ...entry.item.data!, todayPosition: place },
  }]);
}

/**
 * A Today row's stable key. A task's first row keeps the task's own key, so turning a bucket on, or
 * a skip swapping the pick, doesn't remount the row and close its open details (D56).
 */
export const todayRowKey = (entry: Pick<TodayEntry, 'item' | 'pick' | 'sub'>) => entry.pick && entry.sub ? `${entry.item.id}:${entry.pick.record.data!.poolId}` : entry.item.id;

/** Check or uncheck a Today row, on the record its day uses (D53). */
export function checkedOff(entry: Pick<TodayEntry, 'item' | 'completionDay'>, completed: boolean): SyncRecord[] {
  const data: CompletionData = { itemId: entry.item.id, day: entry.completionDay, completed };
  return [record('completion', entry.completionDay ? habitCompletionId(entry.item.id, entry.completionDay) : taskCompletionId(entry.item.id), data)];
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

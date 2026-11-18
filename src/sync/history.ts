import { completedDays, schedulesByItem } from './daily';
import { addDays } from './day';
import type { ListData } from './lists';
import { byPosition, checkedAt, CLOCK_SLACK_MS, habitCompletionId, isCompleted } from './records';
import type { Entry } from './records';
import { recordKey } from './types';
import type { ItemData, ScheduleData, SyncRecord } from './types';
import { carryEnds, repeatsOn, sortedVersions } from './repeats';

// Looking back at past days (D7). Nothing is snapshotted at the reset: a day is recomputed from
// the versioned schedules (D40) and the completion records (D39), so history never rewrites
// itself (D34). Pure, like daily.ts.

export interface HistoryTask {
  item: SyncRecord<ItemData>;
  /** The named list a task came from; absent for today-only tasks. */
  listTitle?: string;
}

export interface HistoryDay {
  day: string;
  /** Repeating tasks scheduled that day, done or not. */
  habits: Entry[];
  habitsDone: number;
  /** Today-only and named-list tasks checked off that day. */
  tasks: HistoryTask[];
  /** One-off tasks set to drop that left Today unfinished after this day, their last on it (D70). */
  dropped: HistoryTask[];
}

type DayOf = (editedAt: number) => string;

/** Items with data, archived (deleted) ones included: their past days stay as they were. */
const itemsWithData = function* (records: ReadonlyMap<string, SyncRecord>) {
  for (const record of records.values()) {
    if (record.entity === 'item' && record.data) yield record as SyncRecord<ItemData>;
  }
};

/**
 * Whether an archived item still belongs to a day. It leaves from the day it was deleted on; a
 * habit checked off earlier that day stays, so the day keeps what was done in it.
 */
function presentOn(item: SyncRecord<ItemData>, day: string, dayOf: DayOf, doneThatDay: () => boolean): boolean {
  if (!item.deleted) return true;
  const deletedOn = dayOf(item.editedAt);
  return day < deletedOn || (day === deletedOn && doneThatDay());
}

/**
 * The days a task shows as checked off, matching Today. Edit stamps may run a few minutes ahead
 * (D32), so a check just after the reset also counts for the day before; a today-only task never
 * counts before its original day.
 */
function finishedDays(records: ReadonlyMap<string, SyncRecord>, item: SyncRecord<ItemData>, dayOf: DayOf): { from: string; to: string } | null {
  const checked = checkedAt(records, item.id);
  if (checked === null) return null;
  const to = dayOf(checked);
  const early = dayOf(checked - CLOCK_SLACK_MS);
  const original = item.data!.originalDay;
  return { from: original && original > early ? original : early, to };
}
const finishedOnDay = (records: ReadonlyMap<string, SyncRecord>, item: SyncRecord<ItemData>, day: string, dayOf: DayOf) => {
  const days = finishedDays(records, item, dayOf);
  return !!days && days.from <= day && day <= days.to;
};

const isTopLevelTask = (data: ItemData) => (data.kind === 'today' || data.kind === 'task') && !data.parentId;

/** What was done on a past day: habits done out of habits scheduled, and the tasks finished. */
export function historyDay(records: ReadonlyMap<string, SyncRecord>, day: string, dayOf: DayOf): HistoryDay {
  const schedules = schedulesByItem(records);
  const habits: Entry[] = [];
  const tasks: { task: HistoryTask; at: number }[] = [];
  const dropped: HistoryTask[] = [];
  const checkedDays = completedDays(records);
  for (const item of itemsWithData(records)) {
    const data = item.data!;
    const sorted = data.parentId ? [] : sortedVersions(schedules.get(item.id));
    // A repeating task counts from the day it was created, that day included (D40); a one-off made
    // repeating counts on the days it repeats on after its own (D51).
    if ((data.kind === 'habit' || (data.kind === 'today' && !data.parentId)) && repeatsOn(data, sorted, day)
      && presentOn(item, day, dayOf, () => isCompleted(records, habitCompletionId(item.id, day)))) {
      habits.push({ item, done: isCompleted(records, habitCompletionId(item.id, day)) });
    }
    if (data.kind === 'today' && !data.parentId && data.originalDay && droppedOn(data.originalDay, sorted, checkedAt(records, item.id), checkedDays.get(item.id)) === day
      && presentOn(item, day, dayOf, () => false)) {
      dropped.push({ item });
    }
    if (data.kind === 'habit') continue;
    if (isTopLevelTask(data) && finishedOnDay(records, item, day, dayOf) && presentOn(item, day, dayOf, () => false)) {
      const list = data.listId ? records.get(recordKey('list', data.listId))?.data as ListData | null | undefined : undefined;
      tasks.push({ task: { item, ...(data.listId ? { listTitle: list?.title ?? 'A list' } : {}) }, at: checkedAt(records, item.id)! });
    }
  }
  habits.sort(byPosition);
  tasks.sort((a, b) => a.at - b.at || byPosition(a.task, b.task));
  dropped.sort(byPosition);
  return { day, habits, habitsDone: habits.filter((entry) => entry.done).length, tasks: tasks.map(({ task }) => task), dropped };
}

/**
 * The last day an unfinished one-off was on Today before its missed setting dropped it (D52, D70):
 * its own day, or the last day of its carry. Null while it's still carried, or once it's checked.
 */
function droppedOn(original: string, sorted: readonly ScheduleData[], checked: number | null, checkedDays: readonly string[] = []): string | null {
  if (checked !== null) return null;
  const ends = carryEnds('today', sorted, original);
  if (ends === null) return null;
  const last = addDays(ends, -1);
  return checkedDays.some((d) => d >= original && d <= last) ? null : last;
}

/**
 * The first day there's anything to look back on: the earliest day a habit was created, a
 * today-only task was planned, or a task was checked off. Null when there's nothing yet.
 */
export function firstHistoryDay(records: ReadonlyMap<string, SyncRecord>, dayOf: DayOf): string | null {
  let first: string | null = null;
  const consider = (day: string | null | undefined) => { if (day && (!first || day < first)) first = day; };
  // A today-only task is never checked before its original day, so only list tasks' checks can
  // come first. Only the earliest needs turning into a day (dayAt formats dates, so it isn't free).
  let earliestCheck: number | null = null;
  for (const item of itemsWithData(records)) {
    const data = item.data!;
    if (data.kind === 'habit') consider(data.createdDay);
    else if (data.kind === 'today' && !data.parentId) consider(data.originalDay);
    else if (isTopLevelTask(data)) {
      const checked = checkedAt(records, item.id);
      if (checked !== null && (earliestCheck === null || checked < earliestCheck)) earliestCheck = checked;
    }
  }
  if (earliestCheck !== null) consider(dayOf(earliestCheck - CLOCK_SLACK_MS));
  return first;
}

/** The days History can show, oldest to newest: from the first day up to yesterday. Null when there are none. */
export function historyRange(records: ReadonlyMap<string, SyncRecord>, today: string, dayOf: DayOf): { first: string; last: string } | null {
  const last = addDays(today, -1);
  const first = firstHistoryDay(records, dayOf);
  return first && first <= last ? { first, last } : null;
}

/** A real YYYY-MM-DD calendar day, so a hand-typed address can't produce an invalid date. */
export const isCalendarDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
  && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

/** "3 of 4 repeating · 2 tasks done · 1 dropped" */
export function historyLabel(view: HistoryDay): string {
  const habits = view.habits.length ? `${view.habitsDone} of ${view.habits.length} repeating` : 'Nothing repeating';
  const tasks = view.tasks.length === 1 ? '1 task done' : `${view.tasks.length} tasks done`;
  return `${habits} · ${tasks}${view.dropped.length ? ` · ${view.dropped.length} dropped` : ''}`;
}

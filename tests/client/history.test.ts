import { describe, expect, it } from 'vitest';
import { EVERY_DAY, newHabit, newTodayTask, removed, scheduleId, setCompleted, taskCompletionId } from '../../src/sync/daily';
import { addDays } from '../../src/sync/day';
import { historyDay, historyLabel, historyRange, isCalendarDay } from '../../src/sync/history';
import { newList, newListTask } from '../../src/sync/lists';
import { keyOf } from '../../src/sync/types';
import type { ItemData, ScheduleData, SyncRecord } from '../../src/sync/types';

// Two weeks starting Monday, 2 November 2026. Each day's edits get stamps inside that day, so
// dayOf can read the day straight back from a stamp.
const START = '2026-11-02';
const DAY_MS = 1_000_000;
const dayNumber = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86_400_000);
const stampOn = (day: string, n = 0) => (dayNumber(day) + 1) * DAY_MS + 500_000 + n;
const dayOf = (editedAt: number) => addDays(START, Math.floor(editedAt / DAY_MS) - 1);
const on = (n: number) => addDays(START, n);

let tick = 0;
function apply(records: Map<string, SyncRecord>, day: string, changes: SyncRecord[]) {
  for (const record of changes) records.set(keyOf(record), { ...record, editedAt: stampOn(day, tick++) });
}
const item = (records: Map<string, SyncRecord>, id: string) => records.get(`item/${id}`) as SyncRecord<ItemData>;
const reschedule = (itemId: string, effectiveDay: string, weekdays: number[]): SyncRecord =>
  ({ entity: 'schedule', id: scheduleId(itemId, effectiveDay), editedAt: 0, deleted: false, data: { itemId, effectiveDay, weekdays } satisfies ScheduleData });

describe('history', () => {
  it('shows a past day’s habits done out of scheduled, plus the tasks finished that day', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), [...newHabit('walk', 'Walk', EVERY_DAY, on(0), 1), ...newHabit('read', 'Read', [1, 3, 5], on(0), 2)]);
    apply(records, on(0), [...newList('home', 'Home', 1), ...newListTask('fix', 'home', 'Fix the tap', 1)]);
    apply(records, on(3), newTodayTask('call', 'Call the bank', on(3), 3));
    apply(records, on(4), newTodayTask('ship', 'Ship it', on(4), 4));
    // Wednesday (day 2): walked and read. Thursday: call the bank, fix the tap; ship stays open.
    apply(records, on(2), setCompleted(item(records, 'walk'), on(2), true));
    apply(records, on(2), setCompleted(item(records, 'read'), on(2), true));
    apply(records, on(3), setCompleted(item(records, 'call'), on(3), true));
    apply(records, on(3), setCompleted(item(records, 'fix'), on(3), true));

    const wednesday = historyDay(records, on(2), dayOf);
    expect(wednesday.habits.map((e) => [e.item.id, e.done])).toEqual([['walk', true], ['read', true]]);
    expect(historyLabel(wednesday)).toBe('2 of 2 habits · 0 tasks done');

    const thursday = historyDay(records, on(3), dayOf);
    expect(thursday.habits.map((e) => [e.item.id, e.done])).toEqual([['walk', false]]);
    expect(thursday.tasks).toMatchObject([{ item: { id: 'call' } }, { item: { id: 'fix' }, listTitle: 'Home' }]);
    expect(thursday.tasks[0]).not.toHaveProperty('listTitle');
    expect(historyLabel(thursday)).toBe('0 of 1 habit · 2 tasks done');
    expect(historyDay(records, on(4), dayOf).tasks).toEqual([]);
  });

  it('offers every day from the first one up to yesterday', () => {
    const records = new Map<string, SyncRecord>();
    expect(historyRange(records, on(13), dayOf)).toBeNull();
    apply(records, on(0), newHabit('walk', 'Walk', EVERY_DAY, on(0), 1));
    expect(historyRange(records, on(0), dayOf)).toBeNull();
    expect(historyRange(records, on(13), dayOf)).toEqual({ first: on(0), last: on(12) });
  });

  it('recomputes past days from the versioned schedule, so a change today leaves them alone', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), newHabit('read', 'Read', EVERY_DAY, on(0), 1));
    const before = [0, 1, 2, 3, 4, 5, 6].map((n) => historyDay(records, on(n), dayOf).habits.length);
    // From day 7 on, Mondays only.
    apply(records, on(6), [reschedule('read', on(7), [1])]);
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => historyDay(records, on(n), dayOf).habits.length)).toEqual(before);
    expect(before).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect([7, 8, 9].map((n) => historyDay(records, on(n), dayOf).habits.length)).toEqual([1, 0, 0]);
  });

  it('counts a habit from the day it was created, that day included', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(5), newHabit('walk', 'Walk', EVERY_DAY, on(5), 1));
    expect(historyDay(records, on(4), dayOf).habits).toEqual([]);
    expect(historyDay(records, on(5), dayOf).habits).toMatchObject([{ item: { id: 'walk' }, done: false }]);
  });

  it('shows days missed while offline as not done', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), newHabit('walk', 'Walk', EVERY_DAY, on(0), 1));
    apply(records, on(0), setCompleted(item(records, 'walk'), on(0), true));
    // Nothing opened the app from day 1 to day 4.
    apply(records, on(5), setCompleted(item(records, 'walk'), on(5), true));
    expect([0, 1, 2, 3, 4, 5].map((n) => historyDay(records, on(n), dayOf).habitsDone)).toEqual([1, 0, 0, 0, 0, 1]);
  });

  it('keeps an archived habit on the days it was scheduled, and only those', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), newHabit('walk', 'Walk', [1, 3, 5], on(0), 1));
    apply(records, on(0), setCompleted(item(records, 'walk'), on(0), true));
    apply(records, on(9), removed(item(records, 'walk')));
    expect(historyDay(records, on(0), dayOf).habits).toMatchObject([{ item: { id: 'walk', deleted: true }, done: true }]);
    expect(historyDay(records, on(1), dayOf).habits).toEqual([]);
    expect(historyDay(records, on(7), dayOf).habits).toMatchObject([{ done: false }]);
    // Deleted on day 9, a Wednesday: gone from that day on.
    expect(historyDay(records, on(9), dayOf).habits).toEqual([]);
    expect(historyDay(records, on(11), dayOf).habits).toEqual([]);
  });

  it('keeps a habit checked off on the day it was removed', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), [...newHabit('walk', 'Walk', EVERY_DAY, on(0), 1), ...newHabit('read', 'Read', EVERY_DAY, on(0), 2)]);
    apply(records, on(2), setCompleted(item(records, 'walk'), on(2), true));
    apply(records, on(2), [...removed(item(records, 'walk')), ...removed(item(records, 'read'))]);
    expect(historyDay(records, on(2), dayOf).habits.map((e) => [e.item.id, e.done])).toEqual([['walk', true]]);
    expect(historyDay(records, on(3), dayOf).habits).toEqual([]);
  });

  it('accepts only real calendar days from the address', () => {
    expect(isCalendarDay('2026-11-16')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    for (const bad of ['2026-11-31', '2026-13-01', '2026-02-29', '20261116', '']) expect(isCalendarDay(bad)).toBe(false);
  });

  it('keeps a finished task on its day after it’s deleted later, but not one deleted the same day', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), [...newTodayTask('call', 'Call', on(0), 1), ...newTodayTask('oops', 'Oops', on(0), 2)]);
    apply(records, on(0), setCompleted(item(records, 'call'), on(0), true));
    apply(records, on(0), setCompleted(item(records, 'oops'), on(0), true));
    apply(records, on(0), removed(item(records, 'oops')));
    apply(records, on(3), removed(item(records, 'call')));
    expect(historyDay(records, on(0), dayOf).tasks.map((t) => t.item.id)).toEqual(['call']);
  });

  it('lists a task checked a few minutes past the reset on both days, as Today does', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), newTodayTask('call', 'Call', on(0), 1));
    // Day 1 starts at RESET; the check is stamped two minutes after it.
    const RESET = 1e9;
    const resetDayOf = (editedAt: number) => editedAt >= RESET ? on(1) : on(0);
    const [check] = setCompleted(item(records, 'call'), on(0), true);
    records.set(`completion/${taskCompletionId('call')}`, { ...check, editedAt: RESET + 2 * 60_000 });
    expect(historyDay(records, on(0), resetDayOf).tasks.map((t) => t.item.id)).toEqual(['call']);
    expect(historyDay(records, on(1), resetDayOf).tasks.map((t) => t.item.id)).toEqual(['call']);
    expect(historyDay(records, on(2), resetDayOf).tasks).toEqual([]);
  });

  it('leaves subtasks out of the finished tasks', () => {
    const records = new Map<string, SyncRecord>();
    apply(records, on(0), newTodayTask('call', 'Call', on(0), 1));
    apply(records, on(0), [{ entity: 'item', id: 'sub', editedAt: 0, deleted: false, data: { kind: 'today', title: 'Find number', originalDay: on(0), parentId: 'call' } }]);
    apply(records, on(0), setCompleted(item(records, 'sub'), on(0), true));
    expect(historyDay(records, on(0), dayOf).tasks).toEqual([]);
  });
});

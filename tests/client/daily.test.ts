import { describe, expect, it } from 'vitest';
import {
  cleanTitle, describeDays, EVERY_DAY, habitCompletionId, newHabit, newTodayTask, normalizeWeekdays, progressLabel,
  removed, renamed, scheduleOn, setCompleted, taskCompletionId, todayView,
} from '../../src/sync/daily';
import { currentDay, weekdayOf } from '../../src/sync/day';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const WEDNESDAY = '2026-11-18';
let stamp = 1;
const store = (...groups: SyncRecord[][]) => {
  const map = new Map<string, SyncRecord>();
  for (const record of groups.flat()) map.set(keyOf(record), { ...record, editedAt: stamp++ });
  return map;
};
const apply = (map: Map<string, SyncRecord>, records: SyncRecord[]) => {
  for (const record of records) map.set(keyOf(record), { ...record, editedAt: stamp++ });
};
const item = (map: Map<string, SyncRecord>, id: string) => map.get(`item/${id}`) as SyncRecord<ItemData>;

describe('day', () => {
  it('uses the device’s local calendar date', () => {
    expect(currentDay(new Date(2026, 10, 16, 23, 59))).toBe('2026-11-16');
    expect(currentDay(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
  it('finds the weekday of a day regardless of time zone', () => {
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayOf(TUESDAY)).toBe(2);
    expect(weekdayOf('2026-11-22')).toBe(0);
  });
});

describe('today view', () => {
  function mondayScenario() {
    return store(
      newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1),
      newHabit('read', 'Read', [1, 3, 5], MONDAY, 2),
      newHabit('stretch', 'Stretch', [1], MONDAY, 3),
      newTodayTask('call', 'Call the bank', MONDAY, 4),
      newTodayTask('ship', 'Ship the release', MONDAY, 5),
    );
  }

  it('shows Monday’s three habits and two tasks with the ring at 0%', () => {
    const view = todayView(mondayScenario(), MONDAY);
    expect(view.habits.map((e) => e.item.data!.title)).toEqual(['Walk', 'Read', 'Stretch']);
    expect(view.tasks.map((e) => e.item.data!.title)).toEqual(['Call the bank', 'Ship the release']);
    expect(view.percent).toBe(0);
    expect(progressLabel(view)).toBe('0 done · 5 to go');
    expect(view.isNew).toBe(false);
  });

  it('counts one habit and one task done as 40% and “2 done · 3 to go”', () => {
    const records = mondayScenario();
    apply(records, setCompleted(item(records, 'read'), MONDAY, true));
    apply(records, setCompleted(item(records, 'ship'), MONDAY, true));
    const view = todayView(records, MONDAY);
    expect(view.percent).toBe(40);
    expect(progressLabel(view)).toBe('2 done · 3 to go');
    expect(view.habits.find((e) => e.item.id === 'read')?.done).toBe(true);
  });

  it('leaves a Mon/Wed/Fri habit out of Tuesday entirely', () => {
    const records = store(newHabit('read', 'Read', [1, 3, 5], MONDAY, 1), newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 2));
    const tuesday = todayView(records, TUESDAY);
    expect(tuesday.habits.map((e) => e.item.id)).toEqual(['walk']);
    expect(tuesday.total).toBe(1);
    expect(todayView(records, WEDNESDAY).habits.map((e) => e.item.id)).toEqual(['read', 'walk']);
  });

  it('marks a brand-new account as new, and an account with items as not', () => {
    const empty = todayView(new Map(), MONDAY);
    expect(empty).toMatchObject({ isNew: true, total: 0, percent: 0, habits: [], tasks: [] });
    const unscheduled = todayView(store(newHabit('read', 'Read', [3], MONDAY, 1)), TUESDAY);
    expect(unscheduled).toMatchObject({ isNew: false, total: 0 });
  });

  it('clears habit checks each day but keeps the history', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    expect(todayView(records, MONDAY).done).toBe(1);
    expect(todayView(records, TUESDAY).done).toBe(0);
    expect(records.has(`completion/${habitCompletionId('walk', MONDAY)}`)).toBe(true);
  });

  it('ignores habits before their creation day and tasks from other days', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, TUESDAY, 1), newTodayTask('old', 'Old', MONDAY, 2));
    expect(todayView(records, MONDAY).habits).toEqual([]);
    expect(todayView(records, TUESDAY).tasks).toEqual([]);
  });

  it('hides deleted items, keeps their data as an archive, and keeps completions', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    apply(records, removed(item(records, 'walk')));
    expect(todayView(records, MONDAY).habits).toEqual([]);
    expect(item(records, 'walk')).toMatchObject({ deleted: true, data: { title: 'Walk', createdDay: MONDAY } });
    expect(records.get(`completion/walk:${MONDAY}`)?.deleted).toBe(false);
  });

  it('picks the latest schedule version effective on or before a day', () => {
    const versions = [
      { itemId: 'h', effectiveDay: MONDAY, weekdays: EVERY_DAY },
      { itemId: 'h', effectiveDay: WEDNESDAY, weekdays: [5] },
    ];
    expect(scheduleOn(versions, TUESDAY)?.weekdays).toEqual(EVERY_DAY);
    expect(scheduleOn(versions, WEDNESDAY)?.weekdays).toEqual([5]);
    expect(scheduleOn(versions, '2026-11-15')).toBeUndefined();
  });
});

describe('records', () => {
  it('builds a habit with its first schedule version effective on its creation day', () => {
    const [habit, schedule] = newHabit('h1', 'Walk', [5, 1, 3, 1], MONDAY, 7);
    expect(habit).toMatchObject({ entity: 'item', id: 'h1', deleted: false, data: { kind: 'habit', title: 'Walk', createdDay: MONDAY, position: 7 } });
    expect(schedule).toMatchObject({ entity: 'schedule', id: `h1:${MONDAY}`, data: { itemId: 'h1', effectiveDay: MONDAY, weekdays: [1, 3, 5] } });
  });

  it('uses semantic completion IDs, so repeated checks are one record', () => {
    const records = store(newHabit('h', 'Walk', EVERY_DAY, MONDAY, 1), newTodayTask('t', 'Call', MONDAY, 2));
    const habitCheck = setCompleted(item(records, 'h'), MONDAY, true)[0];
    const taskCheck = setCompleted(item(records, 't'), MONDAY, true)[0];
    expect(habitCheck).toMatchObject({ id: habitCompletionId('h', MONDAY), data: { itemId: 'h', day: MONDAY, completed: true } });
    expect(taskCheck).toMatchObject({ id: taskCompletionId('t'), data: { itemId: 't', day: null, completed: true } });
    apply(records, [habitCheck]); apply(records, setCompleted(item(records, 'h'), MONDAY, true));
    apply(records, setCompleted(item(records, 'h'), MONDAY, false));
    expect([...records.keys()].filter((k) => k.startsWith('completion/h:'))).toHaveLength(1);
    expect(todayView(records, MONDAY).done).toBe(0);
  });

  it('renames with the full record, not a patch', () => {
    const records = store(newTodayTask('t', 'Call', MONDAY, 2));
    expect(renamed(item(records, 't'), 'Call mom')[0].data).toEqual({ kind: 'today', title: 'Call mom', originalDay: MONDAY, position: 2 });
  });

  it('validates titles and weekdays', () => {
    expect(cleanTitle('  Walk  ')).toEqual({ title: 'Walk' });
    expect(cleanTitle('   ')).toHaveProperty('error');
    expect(cleanTitle('x'.repeat(501))).toHaveProperty('error');
    expect(() => normalizeWeekdays([])).toThrow();
    expect(describeDays([5, 1, 3])).toBe('Mon, Wed and Fri');
    expect(describeDays([0])).toBe('Sun');
  });
});

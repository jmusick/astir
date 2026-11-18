import { describe, expect, it } from 'vitest';
import {
  carriedLabel, cleanTitle, describeDays, EVERY_DAY, habitCompletionId, newHabit, newTodayTask, normalizeWeekdays, progressLabel,
  isCompleted, removed, renamed, scheduleOn, setCompleted, taskCompletionId, todayView,
} from '../../src/sync/daily';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';
import type { TodayView } from '../../src/sync/daily';
const habitsOf = (v: TodayView) => v.entries.filter((e) => e.source === 'habit');
const tasksOf = (v: TodayView) => v.entries.filter((e) => e.source === 'today');

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
    const view = todayView(mondayScenario(), MONDAY, () => MONDAY);
    expect(habitsOf(view).map((e) => e.item.data!.title)).toEqual(['Walk', 'Read', 'Stretch']);
    expect(tasksOf(view).map((e) => e.item.data!.title)).toEqual(['Call the bank', 'Ship the release']);
    expect(view.percent).toBe(0);
    expect(progressLabel(view)).toBe('0 done · 5 to go');
    expect(view.isNew).toBe(false);
  });

  it('counts one habit and one task done as 40% and “2 done · 3 to go”', () => {
    const records = mondayScenario();
    apply(records, setCompleted(item(records, 'read'), MONDAY, true));
    apply(records, setCompleted(item(records, 'ship'), MONDAY, true));
    const view = todayView(records, MONDAY, () => MONDAY);
    expect(view.percent).toBe(40);
    expect(progressLabel(view)).toBe('2 done · 3 to go');
    expect(habitsOf(view).find((e) => e.item.id === 'read')?.done).toBe(true);
  });

  it('leaves a Mon/Wed/Fri habit out of Tuesday entirely', () => {
    const records = store(newHabit('read', 'Read', [1, 3, 5], MONDAY, 1), newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 2));
    const tuesday = todayView(records, TUESDAY, () => TUESDAY);
    expect(habitsOf(tuesday).map((e) => e.item.id)).toEqual(['walk']);
    expect(tuesday.total).toBe(1);
    expect(habitsOf(todayView(records, WEDNESDAY, () => WEDNESDAY)).map((e) => e.item.id)).toEqual(['read', 'walk']);
  });

  it('marks a brand-new account as new, and an account with items as not', () => {
    const empty = todayView(new Map(), MONDAY, () => MONDAY);
    expect(empty).toMatchObject({ isNew: true, total: 0, percent: 0, entries: [] });
    const unscheduled = todayView(store(newHabit('read', 'Read', [3], MONDAY, 1)), TUESDAY, () => TUESDAY);
    expect(unscheduled).toMatchObject({ isNew: false, total: 0 });
  });

  it('clears habit checks each day but keeps the history', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    expect(todayView(records, MONDAY, () => MONDAY).done).toBe(1);
    expect(todayView(records, TUESDAY, () => TUESDAY).done).toBe(0);
    expect(records.has(`completion/${habitCompletionId('walk', MONDAY)}`)).toBe(true);
  });

  it('ignores habits before their creation day and tasks from later days', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, TUESDAY, 1), newTodayTask('later', 'Later', TUESDAY, 2));
    expect(habitsOf(todayView(records, MONDAY, () => MONDAY))).toEqual([]);
    expect(tasksOf(todayView(records, MONDAY, () => MONDAY))).toEqual([]);
  });

  it('hides deleted items, keeps their data as an archive, and keeps completions', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    apply(records, removed(item(records, 'walk')));
    expect(habitsOf(todayView(records, MONDAY, () => MONDAY))).toEqual([]);
    expect(item(records, 'walk')).toMatchObject({ deleted: true, data: { title: 'Walk', createdDay: MONDAY } });
    expect(records.get(`completion/walk:${MONDAY}`)?.deleted).toBe(false);
  });

  it('rolls an unfinished task into the next days, counting from its original day', () => {
    const records = store(newTodayTask('call', 'Call the bank', MONDAY, 1));
    expect(tasksOf(todayView(records, MONDAY, () => MONDAY))[0]).toMatchObject({ done: false, dayCount: 1 });
    expect(tasksOf(todayView(records, TUESDAY, () => TUESDAY))[0]).toMatchObject({ done: false, dayCount: 2 });
    expect(tasksOf(todayView(records, WEDNESDAY, () => WEDNESDAY))[0]).toMatchObject({ done: false, dayCount: 3 });
    expect(todayView(records, TUESDAY, () => TUESDAY).total).toBe(1);
  });

  it('catches up after four days offline with the right count and nothing lost', () => {
    const records = store(newTodayTask('a', 'A', MONDAY, 1), newTodayTask('b', 'B', TUESDAY, 2), newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 3));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    const view = todayView(records, '2026-11-20', () => '2026-11-20');
    expect(tasksOf(view).map((e) => [e.item.id, e.dayCount])).toEqual([['a', 5], ['b', 4]]);
    expect(habitsOf(view)).toMatchObject([{ done: false }]);
    expect(isCompleted(records, habitCompletionId('walk', MONDAY))).toBe(true);
  });

  it('keeps a finished task on the day it was checked, not later days', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1), newTodayTask('ship', 'Ship', MONDAY, 2));
    // Stamps here are tiny, so "Wednesday" starts at a stamp far past them.
    const WEDNESDAY_STARTS = 1e9;
    apply(records, setCompleted(item(records, 'call'), MONDAY, true));
    records.set(`completion/${taskCompletionId('ship')}`, { ...setCompleted(item(records, 'ship'), WEDNESDAY, true)[0], editedAt: WEDNESDAY_STARTS + 3_600_000 });
    const dayOf = (editedAt: number) => editedAt >= WEDNESDAY_STARTS ? WEDNESDAY : MONDAY;
    expect(tasksOf(todayView(records, MONDAY, dayOf)).map((e) => [e.item.id, e.done])).toEqual([['call', true], ['ship', false]]);
    expect(tasksOf(todayView(records, TUESDAY, dayOf)).map((e) => e.item.id)).toEqual(['ship']);
    expect(tasksOf(todayView(records, WEDNESDAY, dayOf))).toMatchObject([{ item: { id: 'ship' }, done: true, dayCount: 3 }]);
    expect(tasksOf(todayView(records, '2026-11-19', dayOf))).toEqual([]);
  });

  it('counts a check stamped a few minutes past the reset as done on the day it was made', () => {
    const RESET = 1e9;
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    records.set(`completion/${taskCompletionId('call')}`, { ...setCompleted(item(records, 'call'), MONDAY, true)[0], editedAt: RESET + 2 * 60_000 });
    const dayOf = (editedAt: number) => editedAt >= RESET ? TUESDAY : MONDAY;
    expect(tasksOf(todayView(records, MONDAY, dayOf))).toMatchObject([{ done: true }]);
    expect(tasksOf(todayView(records, TUESDAY, dayOf))).toMatchObject([{ done: true, dayCount: 2 }]);
  });

  it('rolls a task forward again if it’s unchecked', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, setCompleted(item(records, 'call'), MONDAY, true));
    apply(records, setCompleted(item(records, 'call'), MONDAY, false));
    expect(tasksOf(todayView(records, WEDNESDAY, () => MONDAY))).toMatchObject([{ done: false, dayCount: 3 }]);
  });

  it('labels carried days', () => {
    expect([2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(carriedLabel))
      .toEqual(['2nd day', '3rd day', '4th day', '11th day', '12th day', '13th day', '21st day', '22nd day', '101st day', '111th day']);
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
    expect(todayView(records, MONDAY, () => MONDAY).done).toBe(0);
  });

  it('renames with the full record, not a patch', () => {
    const records = store(newTodayTask('t', 'Call', MONDAY, 2));
    expect(renamed(item(records, 't'), 'Call mom')[0].data).toEqual({ kind: 'today', title: 'Call mom', originalDay: MONDAY, position: 2, todayPosition: 2 });
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

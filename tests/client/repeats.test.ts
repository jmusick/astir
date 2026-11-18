import { describe, expect, it } from 'vitest';
import { checkedOff, EVERY_DAY, newHabit, newTodayTask, repeatChanged, todayView, upcomingRepeat } from '../../src/sync/daily';
import { historyDay } from '../../src/sync/history';
import { remindersDue } from '../../src/sync/reminders';
import { keyOf } from '../../src/sync/types';
import type { DayData, ItemData, SyncRecord } from '../../src/sync/types';

// Repeats on any daily task and the missed setting (#20: D51, D52, D68, D70).

const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const WEDNESDAY = '2026-11-18';
const THURSDAY = '2026-11-19';
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
const view = (map: Map<string, SyncRecord>, day: string) => todayView(map, day, () => day);
const row = (map: Map<string, SyncRecord>, day: string, id: string) => view(map, day).entries.find((e) => e.item.id === id);
const past = (map: Map<string, SyncRecord>, day: string) => historyDay(map, day, () => day);

describe('one-off tasks and the missed setting', () => {
  it('drops a one-off set to drop after its day, leaving it in History as not done', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1, 'drop'));
    expect(row(records, MONDAY, 'call')).toMatchObject({ done: false, dayCount: 1 });
    expect(row(records, TUESDAY, 'call')).toBeUndefined();
    expect(past(records, MONDAY).dropped.map((t) => t.item.id)).toEqual(['call']);
    expect(past(records, TUESDAY).dropped).toEqual([]);
  });

  it('rolls a one-off set to roll over to the top of the next day, tagged as its 2nd day', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1), newTodayTask('call', 'Call', MONDAY, 2));
    const tuesday = view(records, TUESDAY);
    expect(tuesday.entries.map((e) => [e.item.id, e.dayCount ?? 1, e.place])).toEqual([['call', 2, null], ['walk', 1, 1]]);
    expect(past(records, MONDAY).dropped).toEqual([]);
  });

  it('keeps a missed repeating task set to drop off the next day and missed in History', () => {
    const records = store(newHabit('read', 'Read', [1, 4], MONDAY, 1));
    expect(row(records, TUESDAY, 'read')).toBeUndefined();
    expect(row(records, THURSDAY, 'read')).toMatchObject({ done: false });
    expect(past(records, MONDAY).habits).toMatchObject([{ item: { id: 'read' }, done: false }]);
  });

  it('ends a carry at the next reset when switched to drop while carried', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    expect(row(records, TUESDAY, 'call')).toMatchObject({ dayCount: 2 });
    apply(records, repeatChanged(item(records, 'call'), TUESDAY, [], 'drop'));
    expect(row(records, TUESDAY, 'call')).toMatchObject({ dayCount: 2 });
    expect(row(records, WEDNESDAY, 'call')).toBeUndefined();
    expect(past(records, TUESDAY).dropped.map((t) => t.item.id)).toEqual(['call']);
    expect(past(records, MONDAY).dropped).toEqual([]);
  });

  it('applies a switch to roll over to a task missed after the change', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1, 'drop'));
    apply(records, repeatChanged(item(records, 'call'), MONDAY, [], 'carry'));
    expect(row(records, TUESDAY, 'call')).toMatchObject({ dayCount: 2 });
  });
});

describe('changing a task’s repeat', () => {
  it('keeps a one-off made every-day on today as it is, and repeats it from the next reset', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, repeatChanged(item(records, 'call'), MONDAY, EVERY_DAY, 'carry'));
    expect(row(records, MONDAY, 'call')).toMatchObject({ completionDay: null, dayCount: 1 });
    expect(row(records, MONDAY, 'call')!.repeats).toBeUndefined();
    expect(upcomingRepeat(records, item(records, 'call'), MONDAY)).toEqual({ weekdays: EVERY_DAY, missed: 'carry', perDay: 0 });
    apply(records, checkedOff(row(records, MONDAY, 'call')!, true));
    // Checked on Monday, so Tuesday starts fresh.
    const tuesday = todayView(records, TUESDAY, () => MONDAY).entries;
    expect(tuesday).toMatchObject([{ completionDay: TUESDAY, done: false, dayCount: 1, repeats: EVERY_DAY }]);
    apply(records, checkedOff(row(records, TUESDAY, 'call')!, true));
    expect(row(records, TUESDAY, 'call')).toMatchObject({ done: true });
    expect(row(records, WEDNESDAY, 'call')).toMatchObject({ done: false });
    expect(past(records, TUESDAY).habits).toMatchObject([{ item: { id: 'call' }, done: true }]);
    expect(past(records, MONDAY).habits).toEqual([]);
  });

  it('shows a still-carried one-off once on a day it now repeats, and one check settles both', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, repeatChanged(item(records, 'call'), MONDAY, EVERY_DAY, 'carry'));
    const tuesday = view(records, TUESDAY).entries;
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0]).toMatchObject({ completionDay: TUESDAY, dayCount: 2 });
    apply(records, checkedOff(tuesday[0], true));
    expect(row(records, WEDNESDAY, 'call')).toMatchObject({ dayCount: 1, done: false });
  });

  it('ends the first day’s carry when the new repeat is set to drop', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, repeatChanged(item(records, 'call'), MONDAY, EVERY_DAY, 'drop'));
    expect(view(records, TUESDAY).entries).toMatchObject([{ completionDay: TUESDAY, dayCount: 1 }]);
    expect(past(records, MONDAY).dropped.map((t) => t.item.id)).toEqual(['call']);
  });

  it('stops a repeating task from the next reset when made a one-off, keeping its history', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    apply(records, repeatChanged(item(records, 'walk'), TUESDAY, [], 'drop'));
    expect(row(records, TUESDAY, 'walk')).toBeDefined();
    expect(row(records, WEDNESDAY, 'walk')).toBeUndefined();
    expect(past(records, MONDAY).habits).toHaveLength(1);
  });

  it('keeps the missed setting when a later version doesn’t say (an older client’s)', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1, 'carry'));
    apply(records, [{ entity: 'schedule', id: `walk:${WEDNESDAY}`, editedAt: 0, deleted: false, data: { itemId: 'walk', effectiveDay: WEDNESDAY, weekdays: [1] } }]);
    expect(upcomingRepeat(records, item(records, 'walk'), TUESDAY)).toEqual({ weekdays: [1], missed: 'carry', perDay: 0 });
  });

  it('defaults new repeating tasks to drop and new one-off tasks to roll over', () => {
    expect(newHabit('a', 'A', EVERY_DAY, MONDAY, 1)[1].data).toMatchObject({ missed: 'drop' });
    expect(newTodayTask('b', 'B', MONDAY, 1)).toHaveLength(1);
    expect(upcomingRepeat(store(newTodayTask('b', 'B', MONDAY, 1)), item(store(newTodayTask('b', 'B', MONDAY, 1)), 'b'), MONDAY)).toEqual({ weekdays: [], missed: 'carry', perDay: 0 });
  });
});

describe('reminders on a one-off made repeating', () => {
  it('fires on each day it repeats on, and only once on its own day', () => {
    const versions: DayData[] = [{ effectiveDay: '0001-01-01', timeZone: 'UTC', startHour: 0 }];
    const records = store([{ ...newTodayTask('call', 'Call', MONDAY, 1)[0], data: { kind: 'today', title: 'Call', originalDay: MONDAY, position: 1, reminder: '09:00' } }]);
    apply(records, repeatChanged(item(records, 'call'), MONDAY, EVERY_DAY, 'drop'));
    const at = (day: string) => Date.parse(`${day}T09:00:00Z`);
    expect(remindersDue(records, versions, at(MONDAY) - 1, at(MONDAY)).map((r) => r.id)).toEqual(['call:task']);
    expect(remindersDue(records, versions, at(TUESDAY) - 1, at(TUESDAY)).map((r) => r.id)).toEqual([`call:${TUESDAY}`]);
  });
});

import { describe, expect, it } from 'vitest';
import { checkedOff, EVERY_DAY, newHabit, newTodayTask, reorderedToday, repeatChanged, todayView } from '../../src/sync/daily';
import { historyDay } from '../../src/sync/history';
import { newList, newListTask } from '../../src/sync/lists';
import { remindersDue } from '../../src/sync/reminders';
import { keyOf } from '../../src/sync/types';
import type { DayData, ItemData, SyncRecord } from '../../src/sync/types';

// Carrying rolled-over tasks at the top until they're done (#21: D53, D54, D69).

const SUNDAY = '2026-11-15';
const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const WEDNESDAY = '2026-11-18';
const THURSDAY = '2026-11-19';
const FRIDAY = '2026-11-20';
const NEXT_MONDAY = '2026-11-23';
let stamp = 1;
const store = (...groups: SyncRecord[][]) => {
  const map = new Map<string, SyncRecord>();
  for (const record of groups.flat()) map.set(keyOf(record), { ...record, editedAt: stamp++ });
  return map;
};
const apply = (map: Map<string, SyncRecord>, records: SyncRecord[]) => {
  for (const record of records) map.set(keyOf(record), { ...record, editedAt: stamp++ });
};
const view = (map: Map<string, SyncRecord>, day: string) => todayView(map, day, () => day);
const row = (map: Map<string, SyncRecord>, day: string, id: string) => view(map, day).entries.find((e) => e.item.id === id);
const rows = (map: Map<string, SyncRecord>, day: string, id: string) => view(map, day).entries.filter((e) => e.item.id === id);
const past = (map: Map<string, SyncRecord>, day: string) => historyDay(map, day, () => day);
// "Invoice the client", Mon and Thu, set to roll over.
const invoice = () => store(newHabit('walk', 'Walk', EVERY_DAY, SUNDAY, 1), newHabit('invoice', 'Invoice', [1, 4], SUNDAY, 2, 'carry'));

describe('carrying a repeating task', () => {
  it('carries a missed Monday to the top of Tuesday and Wednesday, tagged by day', () => {
    const records = invoice();
    expect(view(records, TUESDAY).entries.map((e) => [e.item.id, e.dayCount, e.place])).toEqual([['invoice', 2, null], ['walk', 1, 1]]);
    expect(row(records, WEDNESDAY, 'invoice')).toMatchObject({ dayCount: 3, carry: MONDAY, completionDay: WEDNESDAY });
  });

  it('shows it once on Thursday, its next scheduled day, as its 4th day', () => {
    const records = invoice();
    expect(rows(records, THURSDAY, 'invoice')).toHaveLength(1);
    expect(row(records, THURSDAY, 'invoice')).toMatchObject({ dayCount: 4, carry: MONDAY, completionDay: THURSDAY });
  });

  it('counts a Wednesday check as done on Wednesday and settles Monday, then waits for its next scheduled day', () => {
    const records = invoice();
    apply(records, checkedOff(row(records, WEDNESDAY, 'invoice')!, true));
    expect(row(records, WEDNESDAY, 'invoice')).toMatchObject({ done: true, dayCount: 3 });
    expect(row(records, THURSDAY, 'invoice')).toMatchObject({ done: false, dayCount: 1, place: 2 });
    // Thursday is a fresh occurrence: left undone, it starts a new carry.
    expect(row(records, FRIDAY, 'invoice')).toMatchObject({ carry: THURSDAY, dayCount: 2 });
    expect(past(records, MONDAY).habits.find((e) => e.item.id === 'invoice')).toMatchObject({ done: false });
    expect(past(records, WEDNESDAY).tasks.map((t) => t.item.id)).toEqual(['invoice']);
  });

  it('goes back to carried when its check is undone', () => {
    const records = invoice();
    apply(records, checkedOff(row(records, WEDNESDAY, 'invoice')!, true));
    apply(records, checkedOff(row(records, WEDNESDAY, 'invoice')!, false));
    expect(row(records, WEDNESDAY, 'invoice')).toMatchObject({ done: false, dayCount: 3 });
    expect(row(records, THURSDAY, 'invoice')).toMatchObject({ dayCount: 4 });
  });

  it('settles a merged Thursday with one check, leaving Monday and Thursday missed only until then', () => {
    const records = invoice();
    apply(records, checkedOff(row(records, FRIDAY, 'invoice')!, true));
    expect(row(records, NEXT_MONDAY, 'invoice')).toMatchObject({ dayCount: 1 });
    expect(past(records, MONDAY).habits.find((e) => e.item.id === 'invoice')).toMatchObject({ done: false });
    expect(past(records, THURSDAY).habits.find((e) => e.item.id === 'invoice')).toMatchObject({ done: false });
    expect(past(records, FRIDAY).tasks.map((t) => t.item.id)).toEqual(['invoice']);
  });

  it('is right after days offline: the count, one row, and each missed scheduled day missed', () => {
    const records = invoice();
    // Nothing synced or opened from Monday to the next Monday.
    expect(rows(records, NEXT_MONDAY, 'invoice')).toMatchObject([{ dayCount: 8, carry: MONDAY }]);
    expect([MONDAY, THURSDAY].map((d) => past(records, d).habits.find((e) => e.item.id === 'invoice')?.done)).toEqual([false, false]);
  });

  it('puts two carried tasks above everything, the older carry first', () => {
    const records = store(newHabit('walk', 'Walk', EVERY_DAY, SUNDAY, 1),
      newHabit('mon', 'Monday task', [1], SUNDAY, 2, 'carry'), newHabit('sun', 'Sunday task', [0], SUNDAY, 3, 'carry'));
    expect(view(records, TUESDAY).entries.map((e) => e.item.id)).toEqual(['sun', 'mon', 'walk']);
  });

  it('keeps a dragged carry where it was put for the rest of that carry only', () => {
    const records = invoice();
    apply(records, reorderedToday(view(records, TUESDAY).entries, 0, 1));
    expect(view(records, WEDNESDAY).entries.map((e) => e.item.id)).toEqual(['walk', 'invoice']);
    apply(records, checkedOff(row(records, WEDNESDAY, 'invoice')!, true));
    // Back to its usual place, then a later carry starts at the top again.
    expect(view(records, THURSDAY).entries.map((e) => e.item.id)).toEqual(['walk', 'invoice']);
    expect(view(records, FRIDAY).entries.map((e) => e.item.id)).toEqual(['invoice', 'walk']);
  });

  it('ends the carry at the next reset when switched to drop', () => {
    const records = invoice();
    apply(records, repeatChanged(row(records, TUESDAY, 'invoice')!.item, TUESDAY, [1, 4], 'drop'));
    expect(row(records, TUESDAY, 'invoice')).toMatchObject({ dayCount: 2 });
    expect(row(records, WEDNESDAY, 'invoice')).toBeUndefined();
    expect(row(records, THURSDAY, 'invoice')).toMatchObject({ dayCount: 1 });
  });

  it('carries the repeats of a one-off made repeating', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, checkedOff(row(records, MONDAY, 'call')!, true));
    apply(records, repeatChanged(row(records, MONDAY, 'call')!.item, MONDAY, [2], 'carry'));
    const wednesday = todayView(records, WEDNESDAY, (at) => at === records.get(`completion/call:task`)!.editedAt ? MONDAY : WEDNESDAY);
    expect(wednesday.entries).toMatchObject([{ item: { id: 'call' }, carry: TUESDAY, dayCount: 2, completionDay: WEDNESDAY }]);
  });

  it('puts a newly due list task at the top with the carried tasks, most overdue first', () => {
    const records = invoice();
    apply(records, newList('work', 'Work', 1));
    apply(records, newListTask('report', 'work', 'Report', 1, SUNDAY));
    apply(records, newListTask('slides', 'work', 'Slides', 2, TUESDAY));
    expect(view(records, TUESDAY).entries.map((e) => e.item.id)).toEqual(['report', 'invoice', 'slides', 'walk']);
  });
});

describe('a carried task’s reminder', () => {
  it('doesn’t fire again on a scheduled day merged into the carry', () => {
    const versions: DayData[] = [{ effectiveDay: '0001-01-01', timeZone: 'UTC', startHour: 0 }];
    const records = invoice();
    const habit = records.get('item/invoice') as SyncRecord<ItemData>;
    apply(records, [{ ...habit, data: { ...habit.data!, reminder: '09:00' } }]);
    const at = (day: string) => Date.parse(`${day}T09:00:00Z`);
    expect(remindersDue(records, versions, at(MONDAY) - 1, at(MONDAY)).map((r) => r.id)).toEqual([`invoice:${MONDAY}`]);
    expect(remindersDue(records, versions, at(THURSDAY) - 1, at(THURSDAY))).toEqual([]);
  });
});

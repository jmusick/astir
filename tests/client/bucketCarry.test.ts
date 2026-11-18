import { describe, expect, it } from 'vitest';
import { extraPick, newPoolItem, pickChecked, pickSkipped, pickSubtaskChecked } from '../../src/sync/buckets';
import { EVERY_DAY, newHabit, reorderedToday, repeatChanged, todayView } from '../../src/sync/daily';
import { historyDay } from '../../src/sync/history';
import { newSubtask } from '../../src/sync/lists';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

// Carrying missed bucket picks and per-pick checklists (#24: D55, D59, D60, D74).

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
/** Today on a day, with its fresh picks recorded as the screen does. */
const open = (map: Map<string, SyncRecord>, day: string) => {
  const view = todayView(map, day, () => day);
  if (view.toRecord.length) apply(map, view.toRecord);
  return todayView(map, day, () => day);
};
const rows = (map: Map<string, SyncRecord>, day: string) => open(map, day).entries.filter((e) => e.item.id === 'post');
const names = (map: Map<string, SyncRecord>, day: string) => rows(map, day).map((e) => [e.pick?.name, e.dayCount]);
const row = (map: Map<string, SyncRecord>, day: string, name: string) => rows(map, day).find((e) => e.pick?.name === name)!;

/** "Social media post", made on Monday, with a bucket of three. */
function social(perDay = 1, missed: 'drop' | 'carry' = 'carry') {
  const records = store(newHabit('post', 'Social media post', EVERY_DAY, MONDAY, 1, missed));
  apply(records, repeatChanged(item(records, 'post'), MONDAY, EVERY_DAY, missed, perDay));
  for (const [i, name] of ['Iron Tide', 'Rust Belt Records', 'Stone Dragon Media'].entries()) apply(records, newPoolItem(`p${i}`, 'post', name, i, MONDAY));
  return records;
}

describe('carried picks', () => {
  it('carries a missed pick with the same item, filling the next day’s only pick', () => {
    const records = social();
    open(records, MONDAY);
    expect(names(records, TUESDAY)).toEqual([['Iron Tide', 2]]);
    expect(row(records, TUESDAY, 'Iron Tide')).toMatchObject({ carry: MONDAY, place: null });
    expect(names(records, WEDNESDAY)).toEqual([['Iron Tide', 3]]);
  });

  it('fills a slot before fresh picks, then lets the rotation continue once it’s done', () => {
    const records = social(2);
    open(records, MONDAY);
    apply(records, pickChecked(row(records, MONDAY, 'Rust Belt Records').pick!.record, true));
    expect(names(records, TUESDAY)).toEqual([['Iron Tide', 2], ['Stone Dragon Media', 1]]);
    apply(records, pickChecked(row(records, TUESDAY, 'Iron Tide').pick!.record, true));
    expect(historyDay(records, MONDAY, () => MONDAY).habits.find((e) => e.pick === 'Iron Tide')).toMatchObject({ done: false });
    expect(historyDay(records, TUESDAY, () => TUESDAY).habits.find((e) => e.pick === 'Iron Tide')).toMatchObject({ done: true });
    // Tuesday's fresh pick went undone, so it carries too; the line goes on with the item done longest ago.
    expect(names(records, WEDNESDAY)).toEqual([['Stone Dragon Media', 2], ['Rust Belt Records', 1]]);
  });

  it('shows a carried pick on a day the task isn’t scheduled, and History shows it there once done', () => {
    const records = store(newHabit('post', 'Social media post', [1], MONDAY, 1, 'carry'));
    apply(records, repeatChanged(item(records, 'post'), MONDAY, [1], 'carry', 1));
    apply(records, newPoolItem('p0', 'post', 'Iron Tide', 0, MONDAY));
    open(records, MONDAY);
    expect(names(records, TUESDAY)).toEqual([['Iron Tide', 2]]);
    apply(records, pickChecked(row(records, TUESDAY, 'Iron Tide').pick!.record, true));
    expect(historyDay(records, TUESDAY, () => TUESDAY).tasks).toMatchObject([{ item: { id: 'post' }, pick: 'Iron Tide' }]);
    expect(rows(records, WEDNESDAY)).toEqual([]);
  });

  it('drops a missed pick on a drop task, and never carries an extra or a skipped pick', () => {
    const dropped = social(1, 'drop');
    open(dropped, MONDAY);
    expect(names(dropped, TUESDAY)).toEqual([['Iron Tide', 1]]);
    const records = social();
    apply(records, pickSkipped(row(records, MONDAY, 'Iron Tide').pick!.record));
    apply(records, pickChecked(row(records, MONDAY, 'Rust Belt Records').pick!.record, true));
    const last = row(records, MONDAY, 'Rust Belt Records');
    apply(records, extraPick('post', MONDAY, last.another!, 1));
    expect(names(records, MONDAY)).toEqual([['Rust Belt Records', 1], ['Stone Dragon Media', 1]]);
    // Iron Tide was skipped and Stone Dragon Media was an extra: neither carries.
    expect(names(records, TUESDAY)).toEqual([['Iron Tide', 1]]);
  });

  it('doesn’t offer Skip on a carried pick, which can only be done', () => {
    const records = social();
    open(records, MONDAY);
    expect(row(records, TUESDAY, 'Iron Tide').carry).toBe(MONDAY);
  });

  it('places a dragged carried pick for its carry only, without moving its task', () => {
    const records = social();
    apply(records, newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 2));
    open(records, MONDAY);
    const view = open(records, TUESDAY);
    expect(view.entries.map((e) => e.pick?.name ?? e.item.id)).toEqual(['Iron Tide', 'walk']);
    const changes = reorderedToday(view.entries, 0, 1);
    expect(changes.map(keyOf)).toEqual([`pick/post:${TUESDAY}:p0`]);
    apply(records, changes);
    expect(open(records, WEDNESDAY).entries.map((e) => e.pick?.name ?? e.item.id)).toEqual(['walk', 'Iron Tide']);
  });
});

describe('per-pick checklists', () => {
  function withChecklist(perDay = 2) {
    const records = social(perDay);
    apply(records, newSubtask('write', item(records, 'post'), 'Write it', 1));
    apply(records, newSubtask('schedule', item(records, 'post'), 'Schedule it', 2));
    return records;
  }

  it('gives each pick row its own copy of the checklist', () => {
    const records = withChecklist();
    apply(records, pickSubtaskChecked(row(records, MONDAY, 'Iron Tide').pick!.record, 'write', true));
    expect(row(records, MONDAY, 'Iron Tide').subtasks!.map((s) => s.done)).toEqual([true, false]);
    expect(row(records, MONDAY, 'Rust Belt Records').subtasks!.map((s) => s.done)).toEqual([false, false]);
    expect(row(records, MONDAY, 'Iron Tide')).toMatchObject({ done: false });
  });

  it('keeps both checks when two devices check different steps of one pick offline', () => {
    const records = withChecklist(1);
    const pick = row(records, MONDAY, 'Iron Tide').pick!.record;
    const phone = pickSubtaskChecked(pick, 'write', true);
    const laptop = pickSubtaskChecked(pick, 'schedule', true);
    expect(keyOf(phone[0])).not.toBe(keyOf(laptop[0]));
    apply(records, laptop); apply(records, phone);
    expect(row(records, MONDAY, 'Iron Tide').subtasks!.map((s) => s.done)).toEqual([true, true]);
  });

  it('keeps a carried pick’s partly checked list, and starts fresh picks clear', () => {
    const records = withChecklist(1);
    apply(records, pickSubtaskChecked(row(records, MONDAY, 'Iron Tide').pick!.record, 'write', true));
    expect(row(records, TUESDAY, 'Iron Tide').subtasks!.map((s) => s.done)).toEqual([true, false]);
    apply(records, pickChecked(row(records, TUESDAY, 'Iron Tide').pick!.record, true));
    expect(row(records, WEDNESDAY, 'Rust Belt Records').subtasks!.map((s) => s.done)).toEqual([false, false]);
  });
});

import { describe, expect, it } from 'vitest';
import { extraPick, newPoolItem, pickChecked, pickSkipped, poolEdited, poolRemoved } from '../../src/sync/buckets';
import { EVERY_DAY, newHabit, newTodayTask, reorderedToday, repeatChanged, todayView } from '../../src/sync/daily';
import { historyDay } from '../../src/sync/history';
import { remindersDue } from '../../src/sync/reminders';
import { keyOf } from '../../src/sync/types';
import type { ItemData, PoolData, SyncRecord } from '../../src/sync/types';

// Cycling a repeating task through a bucket (#23: D56–D58, D61–D64, D66, D73, D74).

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
const pool = (map: Map<string, SyncRecord>, id: string) => map.get(`pool/${id}`) as SyncRecord<PoolData>;
/** Today on a day, with its fresh picks recorded as the screen does. */
const open = (map: Map<string, SyncRecord>, day: string) => {
  const view = todayView(map, day, () => day);
  if (view.toRecord.length) apply(map, view.toRecord);
  return todayView(map, day, () => day);
};
const picks = (map: Map<string, SyncRecord>, day: string) => open(map, day).entries.filter((e) => e.item.id === 'post').map((e) => e.pick?.name ?? null);
const row = (map: Map<string, SyncRecord>, day: string, name: string) => open(map, day).entries.find((e) => e.pick?.name === name)!;
const doPick = (map: Map<string, SyncRecord>, day: string, name: string) => apply(map, pickChecked(row(map, day, name).pick!.record, true));

/** "Social media post" with a bucket of three, made on Monday. */
function social(perDay = 1, missed: 'drop' | 'carry' = 'drop') {
  const records = store(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1), newHabit('post', 'Social media post', EVERY_DAY, MONDAY, 2, missed));
  apply(records, repeatChanged(item(records, 'post'), MONDAY, EVERY_DAY, missed, perDay));
  for (const [i, name] of ['Iron Tide', 'Rust Belt Records', 'Stone Dragon Media'].entries()) apply(records, newPoolItem(`p${i}`, 'post', name, i, MONDAY));
  return records;
}

describe('a bucket', () => {
  it('starts today on a task made today, showing the first never-done item, counted once', () => {
    const records = social();
    const view = open(records, MONDAY);
    expect(view.entries.map((e) => [e.item.id, e.pick?.name ?? null])).toEqual([['walk', null], ['post', 'Iron Tide']]);
    expect(view.total).toBe(2);
  });

  it('picks the item that has gone longest without being done, so all three get a turn', () => {
    const records = social();
    doPick(records, MONDAY, 'Iron Tide');
    expect(picks(records, TUESDAY)).toEqual(['Rust Belt Records']);
    doPick(records, TUESDAY, 'Rust Belt Records');
    expect(picks(records, WEDNESDAY)).toEqual(['Stone Dragon Media']);
    doPick(records, WEDNESDAY, 'Stone Dragon Media');
    expect(picks(records, THURSDAY)).toEqual(['Iron Tide']);
  });

  it('never reshuffles a pick when another is checked', () => {
    const records = social(2);
    expect(picks(records, MONDAY)).toEqual(['Iron Tide', 'Rust Belt Records']);
    doPick(records, MONDAY, 'Rust Belt Records');
    expect(picks(records, MONDAY)).toEqual(['Iron Tide', 'Rust Belt Records']);
    expect(open(records, MONDAY)).toMatchObject({ total: 3, done: 1 });
  });

  it('swaps a skipped pick for the next in line, and keeps the skipped one first tomorrow', () => {
    const records = social();
    apply(records, pickSkipped(row(records, MONDAY, 'Iron Tide').pick!.record));
    expect(picks(records, MONDAY)).toEqual(['Rust Belt Records']);
    doPick(records, MONDAY, 'Rust Belt Records');
    expect(picks(records, TUESDAY)).toEqual(['Iron Tide']);
    // A skip isn't a miss: History shows only the pick that stood.
    expect(historyDay(records, MONDAY, () => MONDAY).habits.filter((e) => e.item.id === 'post').map((e) => [e.pick, e.done])).toEqual([['Rust Belt Records', true]]);
  });

  it('adds the next in line as an extra row once today’s picks are done, sending it to the back', () => {
    const records = social();
    expect(open(records, MONDAY).entries.find((e) => e.pick)?.another).toBeUndefined();
    doPick(records, MONDAY, 'Iron Tide');
    const last = row(records, MONDAY, 'Iron Tide');
    expect(last.another?.data!.name).toBe('Rust Belt Records');
    apply(records, extraPick('post', MONDAY, last.another!, 1));
    expect(picks(records, MONDAY)).toEqual(['Iron Tide', 'Rust Belt Records']);
    expect(row(records, MONDAY, 'Rust Belt Records').pick!.extra).toBe(true);
    doPick(records, MONDAY, 'Rust Belt Records');
    expect(picks(records, TUESDAY)).toEqual(['Stone Dragon Media']);
  });

  it('drops a missed pick on a drop task, leaving that item first in line', () => {
    const records = social();
    open(records, MONDAY);
    expect(picks(records, TUESDAY)).toEqual(['Iron Tide']);
    expect(historyDay(records, MONDAY, () => MONDAY).habits.find((e) => e.pick)).toMatchObject({ pick: 'Iron Tide', done: false });
  });

  it('takes a paused item out of the rotation and today’s unchecked pick at once', () => {
    const records = social();
    open(records, MONDAY);
    apply(records, poolEdited(pool(records, 'p0'), { paused: true }));
    expect(picks(records, MONDAY)).toEqual(['Rust Belt Records']);
    apply(records, poolEdited(pool(records, 'p0'), { paused: false }));
    expect(picks(records, TUESDAY)).toEqual(['Iron Tide']);
  });

  it('keeps a deleted item’s name on its past picks', () => {
    const records = social();
    doPick(records, MONDAY, 'Iron Tide');
    apply(records, poolRemoved(pool(records, 'p0')));
    expect(historyDay(records, MONDAY, () => MONDAY).habits.find((e) => e.pick)).toMatchObject({ pick: 'Iron Tide', done: true });
    expect(picks(records, TUESDAY)).toEqual(['Rust Belt Records']);
  });

  it('shows all active items when there are fewer than the daily number, and a plain row when none are', () => {
    const records = social(5);
    expect(picks(records, MONDAY)).toEqual(['Iron Tide', 'Rust Belt Records', 'Stone Dragon Media']);
    for (const id of ['p0', 'p1', 'p2']) apply(records, poolEdited(pool(records, id), { paused: true }));
    expect(open(records, MONDAY).entries.filter((e) => e.item.id === 'post')).toMatchObject([{ bucketEmpty: true }]);
  });

  it('adds items to the rotation the day after they join', () => {
    const records = social(5);
    apply(records, newPoolItem('p3', 'post', 'Fourth', 3, TUESDAY));
    expect(picks(records, TUESDAY)).toHaveLength(3);
    expect(picks(records, WEDNESDAY)).toHaveLength(4);
  });

  it('turns on for an older task from the next reset', () => {
    const records = store(newHabit('post', 'Post', EVERY_DAY, MONDAY, 1));
    apply(records, repeatChanged(item(records, 'post'), TUESDAY, EVERY_DAY, 'drop', 1));
    apply(records, newPoolItem('p0', 'post', 'Iron Tide', 0, TUESDAY));
    expect(picks(records, TUESDAY)).toEqual([null]);
    expect(picks(records, WEDNESDAY)).toEqual(['Iron Tide']);
  });

  it('lets two devices check different picks offline, and counts both', () => {
    const records = social(2);
    const view = todayView(records, MONDAY, () => MONDAY);
    const [a, b] = view.entries.filter((e) => e.pick);
    apply(records, pickChecked(a.pick!.record, true));
    apply(records, pickChecked(b.pick!.record, true));
    expect(open(records, MONDAY)).toMatchObject({ done: 2 });
    expect(picks(records, TUESDAY)).toEqual(['Stone Dragon Media', 'Iron Tide']);
  });

  it('lets two devices skip different picks offline, showing the next unskipped items', () => {
    const records = social(2);
    apply(records, newPoolItem('p3', 'post', 'Fourth', 3, '2026-11-01'));
    const [a, b] = open(records, MONDAY).entries.filter((e) => e.pick);
    // Each device skips one and records its own replacement, the same next item for both.
    const phone = [...pickSkipped(a.pick!.record)];
    const laptop = [...pickSkipped(b.pick!.record)];
    apply(records, phone); apply(records, laptop);
    expect(picks(records, MONDAY)).toEqual(['Stone Dragon Media', 'Fourth']);
  });

  it('places a dragged pick row today and its task from tomorrow', () => {
    const records = social(2);
    const view = open(records, MONDAY);
    const changes = reorderedToday(view.entries, 2, 0);
    expect(changes.map((r) => keyOf(r)).sort()).toEqual(['item/post', 'pick/post:2026-11-16:p0', 'pick/post:2026-11-16:p1']);
    apply(records, changes);
    expect(open(records, MONDAY).entries.map((e) => e.pick?.name ?? e.item.id)).toEqual(['Rust Belt Records', 'walk', 'Iron Tide']);
    expect(open(records, TUESDAY).entries[0].item.id).toBe('post');
  });

  it('stops reminding once all the day’s picks are done', () => {
    const records = social();
    apply(records, [{ ...item(records, 'post'), data: { ...item(records, 'post').data!, reminder: '17:00' } }]);
    const versions = [{ effectiveDay: '0001-01-01', timeZone: 'UTC', startHour: 0 }];
    const at = Date.parse(`${MONDAY}T17:00:00Z`);
    expect(remindersDue(records, versions, at - 1, at)).toHaveLength(1);
    doPick(records, MONDAY, 'Iron Tide');
    expect(remindersDue(records, versions, at - 1, at)).toEqual([]);
  });

  it('isn’t offered on a one-off, and is removed when a task becomes one', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    expect(repeatChanged(item(records, 'call'), MONDAY, [], 'carry', 2)[0].data).toMatchObject({ perDay: 0 });
  });
});

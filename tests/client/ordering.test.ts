import { describe, expect, it } from 'vitest';
import { edited, EVERY_DAY, newHabit, newTodayTask, reorderedToday, repositioned, todayBottom, todayView } from '../../src/sync/daily';
import { listView, newList, newListTask, newSubtask } from '../../src/sync/lists';
import { reorder, subtasksByParent } from '../../src/sync/records';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

// Priority order (#19): one Today list in the owner's order, and drag-to-reorder everywhere (D47–D50, D54, D65, D68).

const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
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
const ids = (map: Map<string, SyncRecord>, day = MONDAY) => todayView(map, day, () => day).entries.map((e) => e.item.id);
/** A record as v1 wrote it: a creation-time position and no Today place. */
const v1 = (records: SyncRecord[]) => records.map((r) => {
  if (r.entity !== 'item') return r;
  const data = { ...r.data as ItemData };
  delete data.todayPosition;
  return { ...r, data };
});

describe('one Today list', () => {
  function upgraded() {
    // Created in this order on v1, so a plain sort by position would interleave them.
    return store(
      v1(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1_790_000_000_000)),
      v1(newTodayTask('call', 'Call the bank', MONDAY, 1_790_000_001_000)),
      v1(newHabit('read', 'Read', EVERY_DAY, MONDAY, 1_790_000_002_000)),
      v1(newTodayTask('ship', 'Ship the release', MONDAY, 1_790_000_003_000)),
      v1(newHabit('stretch', 'Stretch', EVERY_DAY, MONDAY, 1_790_000_004_000)),
    );
  }

  it('converts v1 data to habits first, then tasks, each in its old order, without editing a record', () => {
    const records = upgraded();
    const before = [...records.values()];
    const view = todayView(records, MONDAY, () => MONDAY);
    expect(view.entries.map((e) => e.item.id)).toEqual(['walk', 'read', 'stretch', 'call', 'ship']);
    expect(view.entries.map((e) => e.source)).toEqual(['habit', 'habit', 'habit', 'today', 'today']);
    expect(view.entries[0].repeats).toEqual(EVERY_DAY);
    expect(view.entries[3].repeats).toBeUndefined();
    expect([...records.values()]).toEqual(before);
  });

  it('keeps a one-off dragged above a habit there, editing only that record', () => {
    const records = upgraded();
    const view = todayView(records, MONDAY, () => MONDAY);
    const changes = reorderedToday(view.entries, 4, 1);
    expect(changes.map((r) => r.id)).toEqual(['ship']);
    apply(records, changes);
    expect(ids(records)).toEqual(['walk', 'ship', 'read', 'stretch', 'call']);
    // The same order the next day, when the unfinished tasks roll over, and on another device.
    expect(ids(records, TUESDAY)).toEqual(['walk', 'ship', 'read', 'stretch', 'call']);
    expect(ids(store([...records.values()]))).toEqual(['walk', 'ship', 'read', 'stretch', 'call']);
  });

  it('moves one place at a time, as the arrow keys do', () => {
    const records = upgraded();
    apply(records, reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 0, 1));
    expect(ids(records)).toEqual(['read', 'walk', 'stretch', 'call', 'ship']);
    apply(records, reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 1, 0));
    expect(ids(records)).toEqual(['walk', 'read', 'stretch', 'call', 'ship']);
  });

  it('adds new tasks at the bottom, even below a task dragged there', () => {
    const records = upgraded();
    apply(records, reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 0, 4));
    const place = todayBottom(records, 1);
    apply(records, newTodayTask('new', 'New', MONDAY, place));
    apply(records, newHabit('habit', 'New habit', EVERY_DAY, MONDAY, todayBottom(records, 1)));
    expect(ids(records)).toEqual(['read', 'stretch', 'call', 'ship', 'walk', 'new', 'habit']);
  });

  it('keeps each device’s latest drag when two devices reorder offline', () => {
    const records = upgraded();
    const view = todayView(records, MONDAY, () => MONDAY);
    const phone = reorderedToday(view.entries, 4, 0); // ship to the top
    const laptop = reorderedToday(view.entries, 0, 2); // walk below read and stretch
    apply(records, laptop); apply(records, phone);
    const after = ids(records);
    expect(after[0]).toBe('ship');
    expect(after.indexOf('walk')).toBeGreaterThan(after.indexOf('stretch'));
    expect([...after].sort()).toEqual(['call', 'read', 'ship', 'stretch', 'walk']);
  });
});

describe('due list tasks on Today', () => {
  function withWork() {
    return store(
      newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 10),
      newTodayTask('call', 'Call', MONDAY, 20),
      newList('work', 'Work', 1),
      newListTask('report', 'work', 'Report', 1, MONDAY),
      newListTask('slides', 'work', 'Slides', 2, '2026-11-14'),
      newListTask('later', 'work', 'Later', 3, '2026-11-30'),
    );
  }

  it('shows them in the one list with their list name, at the top and most overdue first', () => {
    const view = todayView(withWork(), MONDAY, () => MONDAY);
    expect(view.entries.map((e) => [e.item.id, e.source, e.listTitle ?? null, e.place])).toEqual([
      ['slides', 'list', 'Work', null], ['report', 'list', 'Work', null], ['walk', 'habit', null, 10], ['call', 'today', null, 20],
    ]);
    expect(view.total).toBe(4);
  });

  it('gives a dragged one its own Today place without moving it in its list', () => {
    const records = withWork();
    const changes = reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 0, 3);
    expect(changes.map((r) => r.id)).toEqual(['slides']);
    expect(changes[0].data).toMatchObject({ position: 2, carryPosition: expect.any(Number), carryDay: '2026-11-14' });
    apply(records, changes);
    expect(ids(records)).toEqual(['report', 'walk', 'call', 'slides']);
    expect(listView(records, 'work')!.open.map((e) => e.item.id)).toEqual(['report', 'slides', 'later']);
  });

  it('places the waiting rows below it when one is dragged beneath them', () => {
    const records = withWork();
    // report moves above slides: slides still waits at the top unless it gets a place too.
    const changes = reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 1, 0);
    expect(changes.map((r) => r.id)).toEqual(['report', 'slides']);
    apply(records, changes);
    expect(ids(records)).toEqual(['report', 'slides', 'walk', 'call']);
  });

  it('returns to the top when its due date moves', () => {
    const records = withWork();
    apply(records, reorderedToday(todayView(records, MONDAY, () => MONDAY).entries, 0, 3));
    apply(records, edited(item(records, 'slides'), { dueDay: '2026-11-15' }));
    expect(ids(records)).toEqual(['slides', 'report', 'walk', 'call']);
  });
});

describe('lists and subtasks', () => {
  it('reorders a list’s open tasks by editing only the moved one', () => {
    const records = store(newList('work', 'Work', 1), newListTask('a', 'work', 'A', 1), newListTask('b', 'work', 'B', 2), newListTask('c', 'work', 'C', 3));
    const changes = repositioned(listView(records, 'work')!.open, 2, 0);
    expect(changes.map((r) => r.id)).toEqual(['c']);
    apply(records, changes);
    expect(listView(records, 'work')!.open.map((e) => e.item.id)).toEqual(['c', 'a', 'b']);
  });

  it('reorders subtasks', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, newSubtask('one', item(records, 'call'), 'One', 1));
    apply(records, newSubtask('two', item(records, 'call'), 'Two', 2));
    apply(records, repositioned(subtasksByParent(records).get('call')!, 0, 1));
    expect(subtasksByParent(records).get('call')!.map((e) => e.item.id)).toEqual(['two', 'one']);
  });
});

describe('reorder', () => {
  const place = (n: number | null) => n;
  it('places the moved item between its neighbours', () => {
    expect(reorder([1, 2, 3], place, 2, 0)).toEqual([{ item: 3, place: 1 - 1024 }]);
    expect(reorder([1, 2, 3], place, 0, 2)).toEqual([{ item: 1, place: 3 + 1024 }]);
    expect(reorder([1, 2, 3], place, 0, 1)).toEqual([{ item: 1, place: 2.5 }]);
    expect(reorder([1, 2, 3], place, 1, 1)).toEqual([]);
  });

  it('renumbers when there’s no room left between two places', () => {
    const tight = [1, 1 + Number.EPSILON, 2];
    const result = reorder(tight, place, 2, 1);
    expect(result).toHaveLength(3);
    const places = result.map((r) => r.place);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(result.map((r) => r.item)).toEqual([1, 2, 1 + Number.EPSILON]);
  });
});

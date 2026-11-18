import { describe, expect, it } from 'vitest';
import { checkedOff, EVERY_DAY, newHabit, newTodayTask, repeatChanged, todayView } from '../../src/sync/daily';
import { newSubtask } from '../../src/sync/lists';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

// Daily checklists on repeating tasks (#22: D55).

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
const row = (map: Map<string, SyncRecord>, day: string, id: string) => todayView(map, day, () => day).entries.find((e) => e.item.id === id)!;
const checks = (map: Map<string, SyncRecord>, day: string, id: string) => row(map, day, id).subtasks!.map((s) => s.done);
const checkSub = (map: Map<string, SyncRecord>, day: string, id: string, index: number) => {
  const entry = row(map, day, id);
  apply(map, checkedOff({ item: entry.subtasks![index].item, completionDay: entry.subtaskDay ?? null }, true));
};
function withChecklist(missed: 'drop' | 'carry') {
  const records = store(newHabit('post', 'Post', EVERY_DAY, MONDAY, 1, missed));
  for (const [i, title] of ['Write it', 'Schedule it', 'Share it'].entries()) apply(records, newSubtask(`s${i}`, item(records, 'post'), title, i));
  return records;
}

describe('daily checklists', () => {
  it('gives a repeating task subtasks that start unchecked each day', () => {
    const records = withChecklist('drop');
    expect(item(records, 's0').data).toMatchObject({ kind: 'habit', createdDay: MONDAY, parentId: 'post' });
    checkSub(records, MONDAY, 'post', 0);
    expect(checks(records, MONDAY, 'post')).toEqual([true, false, false]);
    expect(checks(records, TUESDAY, 'post')).toEqual([false, false, false]);
  });

  it('doesn’t check the task when every subtask is checked', () => {
    const records = withChecklist('drop');
    for (const i of [0, 1, 2]) checkSub(records, MONDAY, 'post', i);
    expect(row(records, MONDAY, 'post')).toMatchObject({ done: false });
  });

  it('keeps a carried task’s partly checked list until it’s done, then starts the next one clear', () => {
    const records = withChecklist('carry');
    checkSub(records, MONDAY, 'post', 0); checkSub(records, MONDAY, 'post', 1);
    expect(row(records, TUESDAY, 'post')).toMatchObject({ dayCount: 2, subtaskDay: MONDAY });
    expect(checks(records, TUESDAY, 'post')).toEqual([true, true, false]);
    checkSub(records, TUESDAY, 'post', 2);
    apply(records, checkedOff(row(records, TUESDAY, 'post'), true));
    expect(checks(records, WEDNESDAY, 'post')).toEqual([false, false, false]);
  });

  it('keeps a one-off’s own checklist on its itemId:task records, and clears it on its repeats', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, newSubtask('dial', item(records, 'call'), 'Dial', 1));
    checkSub(records, MONDAY, 'call', 0);
    expect(records.has('completion/dial:task')).toBe(true);
    apply(records, repeatChanged(item(records, 'call'), MONDAY, EVERY_DAY, 'carry'));
    // Carried into Tuesday's repeat, it's still Monday's occurrence, with Monday's checks.
    expect(row(records, TUESDAY, 'call')).toMatchObject({ subtaskDay: null, dayCount: 2 });
    expect(checks(records, TUESDAY, 'call')).toEqual([true]);
    apply(records, checkedOff(row(records, TUESDAY, 'call'), true));
    expect(checks(records, WEDNESDAY, 'call')).toEqual([false]);
  });
});

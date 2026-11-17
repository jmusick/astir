import { describe, expect, it } from 'vitest';
import { cleanNotes, edited, newTodayTask, NOTES_MAX, progressLabel, removed, setCompleted, todayView } from '../../src/sync/daily';
import { dueEntries, dueLabel, listSummaries, listView, newList, newListTask, newSubtask, removedList, renamedList } from '../../src/sync/lists';
import type { ListData } from '../../src/sync/lists';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

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
const list = (map: Map<string, SyncRecord>, id: string) => map.get(`list/${id}`) as SyncRecord<ListData>;
const titles = (entries: { item: SyncRecord<ItemData> }[]) => entries.map((e) => e.item.data!.title);
const alwaysMonday = () => MONDAY;

describe('named lists', () => {
  function workAndGroceries() {
    return store(
      newList('work', 'Work', 1),
      newList('groceries', 'Groceries', 2),
      newListTask('report', 'work', 'Write the report', 1, MONDAY),
      newListTask('slides', 'work', 'Draft slides', 2),
      newListTask('milk', 'groceries', 'Milk', 1),
    );
  }

  it('lists Work and Groceries in order with their open counts', () => {
    const records = workAndGroceries();
    apply(records, setCompleted(item(records, 'slides'), MONDAY, true));
    expect(listSummaries(records).map((s) => [s.list.data!.title, s.open])).toEqual([['Work', 1], ['Groceries', 1]]);
  });

  it('never resets: a task checked last week stays done, and open ones stay open', () => {
    const records = workAndGroceries();
    apply(records, setCompleted(item(records, 'slides'), MONDAY, true));
    const view = listView(records, 'work')!;
    expect(titles(view.open)).toEqual(['Write the report']);
    expect(titles(view.done)).toEqual(['Draft slides']);
  });

  it('shows the most recently checked tasks first under done', () => {
    const records = workAndGroceries();
    apply(records, setCompleted(item(records, 'report'), MONDAY, true));
    apply(records, setCompleted(item(records, 'slides'), MONDAY, true));
    expect(titles(listView(records, 'work')!.done)).toEqual(['Draft slides', 'Write the report']);
  });

  it('renames a list as a full record', () => {
    const records = workAndGroceries();
    const [renamedRecord] = renamedList(list(records, 'work'), 'Job');
    expect(renamedRecord.data).toEqual({ title: 'Job', position: 1 });
  });

  it('deletes a list together with its tasks and subtasks, keeping their data', () => {
    const records = workAndGroceries();
    apply(records, newSubtask('outline', item(records, 'report'), 'Outline', 1));
    const changes = removedList(records, list(records, 'work'));
    expect(changes.map((c) => `${c.entity}/${c.id}`).sort()).toEqual(['item/outline', 'item/report', 'item/slides', 'list/work']);
    expect(changes.every((c) => c.deleted && c.data)).toBe(true);
    apply(records, changes);
    expect(listSummaries(records).map((s) => s.list.id)).toEqual(['groceries']);
    expect(listView(records, 'work')).toBeUndefined();
  });

  it('makes the account no longer new, even with no habits', () => {
    expect(todayView(store(newList('work', 'Work', 1)), MONDAY, alwaysMonday).isNew).toBe(false);
  });

  it('shows an empty list as empty, not missing', () => {
    const records = store(newList('someday', 'Someday', 1));
    expect(listView(records, 'someday')).toMatchObject({ open: [], done: [] });
  });
});

describe('subtasks', () => {
  it('keep the parent unchecked when every subtask is checked', () => {
    const records = store(newList('work', 'Work', 1), newListTask('report', 'work', 'Write the report', 1));
    apply(records, newSubtask('outline', item(records, 'report'), 'Outline', 1));
    apply(records, newSubtask('draft', item(records, 'report'), 'Draft', 2));
    apply(records, setCompleted(item(records, 'outline'), MONDAY, true));
    apply(records, setCompleted(item(records, 'draft'), MONDAY, true));
    const [report] = listView(records, 'work')!.open;
    expect(report.done).toBe(false);
    expect(report.subtasks.map((s) => [s.item.data!.title, s.done])).toEqual([['Outline', true], ['Draft', true]]);
    expect(listSummaries(records)[0].open).toBe(1);
  });

  it('copy their parent’s kind, list and original day, one level deep', () => {
    const records = store(newTodayTask('call', 'Call the bank', MONDAY, 1), newList('work', 'Work', 1), newListTask('report', 'work', 'Report', 1));
    expect(newSubtask('s1', item(records, 'call'), 'Find the number', 1)[0].data).toMatchObject({ kind: 'today', originalDay: MONDAY, listId: null, parentId: 'call' });
    expect(newSubtask('s2', item(records, 'report'), 'Outline', 1)[0].data).toMatchObject({ kind: 'task', listId: 'work', originalDay: null, parentId: 'report' });
    apply(records, newSubtask('s1', item(records, 'call'), 'Find the number', 1));
    expect(() => newSubtask('s3', item(records, 's1'), 'Too deep', 1)).toThrow();
  });

  it('roll over with their today-only parent and don’t count toward the ring', () => {
    const records = store(newTodayTask('call', 'Call the bank', MONDAY, 1));
    apply(records, newSubtask('number', item(records, 'call'), 'Find the number', 1));
    apply(records, setCompleted(item(records, 'number'), MONDAY, true));
    const view = todayView(records, TUESDAY, alwaysMonday);
    expect(titles(view.tasks)).toEqual(['Call the bank']);
    expect(view.tasks[0].subtasks!.map((s) => s.done)).toEqual([true]);
    expect(view.total).toBe(1);
  });

  it('go with their parent when it’s deleted', () => {
    const records = store(newTodayTask('call', 'Call the bank', MONDAY, 1));
    apply(records, newSubtask('number', item(records, 'call'), 'Find the number', 1));
    expect(removed(item(records, 'call'), records).map((c) => [c.id, c.deleted])).toEqual([['call', true], ['number', true]]);
  });
});

describe('due from your lists (D27)', () => {
  function dueScenario() {
    return store(
      newList('work', 'Work', 1),
      newListTask('today', 'work', 'Due today', 2, TUESDAY),
      newListTask('late', 'work', 'Overdue', 3, MONDAY),
      newListTask('later', 'work', 'Due Friday', 4, '2026-11-20'),
      newListTask('whenever', 'work', 'No date', 5),
      newTodayTask('call', 'Call the bank', TUESDAY, 6),
    );
  }

  it('shows tasks due today or overdue, most overdue first, with their list', () => {
    const due = dueEntries(dueScenario(), TUESDAY, () => TUESDAY);
    expect(due.map((e) => [e.item.data!.title, e.overdue, e.listTitle])).toEqual([['Overdue', 1, 'Work'], ['Due today', 0, 'Work']]);
  });

  it('counts them toward the ring, and checking one there completes it in its list', () => {
    const records = dueScenario();
    apply(records, setCompleted(item(records, 'today'), TUESDAY, true));
    const view = todayView(records, TUESDAY, () => TUESDAY);
    expect(view.total).toBe(3);
    expect(progressLabel(view)).toBe('1 done · 2 to go');
    expect(titles(listView(records, 'work')!.done)).toEqual(['Due today']);
  });

  it('drops a task checked on an earlier day', () => {
    const records = dueScenario();
    apply(records, setCompleted(item(records, 'late'), MONDAY, true));
    expect(titles(dueEntries(records, TUESDAY, alwaysMonday))).toEqual(['Due today']);
  });
});

describe('item details (D26)', () => {
  it('edits notes, due date and reminder as a full record', () => {
    const records = store(newList('work', 'Work', 1), newListTask('report', 'work', 'Report', 1));
    const [next] = edited(item(records, 'report'), { notes: 'Ask Sam first', dueDay: TUESDAY, reminder: '2026-11-17T14:30:00.000Z' });
    expect(next.data).toEqual({ kind: 'task', title: 'Report', listId: 'work', dueDay: TUESDAY, position: 1, notes: 'Ask Sam first', reminder: '2026-11-17T14:30:00.000Z' });
  });

  it('caps notes and trims them', () => {
    expect(cleanNotes('  call first \n')).toEqual({ notes: 'call first' });
    expect(cleanNotes('')).toEqual({ notes: '' });
    expect(cleanNotes('x'.repeat(NOTES_MAX + 1))).toHaveProperty('error');
  });
});

describe('due labels', () => {
  it('reads naturally', () => {
    expect(dueLabel(TUESDAY, TUESDAY)).toBe('Due today');
    expect(dueLabel('2026-11-18', TUESDAY)).toBe('Due tomorrow');
    expect(dueLabel('2026-11-20', TUESDAY)).toBe('Due Nov 20');
    expect(dueLabel('2027-01-04', TUESDAY)).toBe('Due Jan 4, 2027');
    expect(dueLabel(MONDAY, TUESDAY)).toBe('1 day overdue');
    expect(dueLabel('2026-11-14', TUESDAY)).toBe('3 days overdue');
  });
});

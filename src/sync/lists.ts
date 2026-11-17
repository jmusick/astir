import { daysBetween } from './day';
import { blank, byPosition, checkedAt, subtasksByParent, tombstone } from './records';
import type { Entry } from './records';
import { recordKey } from './types';
import type { ItemData, SyncRecord } from './types';

// Named lists (D8): they never reset. Their tasks may have a due date (D26), and the ones due
// today or overdue also show in Today's "Due from your lists" panel (D27). Pure, like daily.ts.

export interface ListData { title: string; position?: number }

export interface ListSummary {
  list: SyncRecord<ListData>;
  /** Open top-level tasks; subtasks are a checklist inside their task. */
  open: number;
}

export interface TaskEntry extends Entry {
  subtasks: Entry[];
}

export interface ListView {
  list: SyncRecord<ListData>;
  open: TaskEntry[];
  /** Most recently checked first. */
  done: TaskEntry[];
}

export interface DueEntry extends TaskEntry {
  listTitle: string;
  /** Days past its due date: 0 when due today. */
  overdue: number;
}

const liveItems = function* (records: ReadonlyMap<string, SyncRecord>) {
  for (const record of records.values()) {
    if (record.entity === 'item' && !record.deleted && record.data) yield record as SyncRecord<ItemData>;
  }
};
const isListTask = (data: ItemData) => data.kind === 'task' && !!data.listId && !data.parentId;

/** Live lists in order, with how many tasks each has open. */
export function listSummaries(records: ReadonlyMap<string, SyncRecord>): ListSummary[] {
  const open = new Map<string, number>();
  for (const item of liveItems(records)) {
    const data = item.data!;
    if (isListTask(data) && checkedAt(records, item.id) === null) open.set(data.listId!, (open.get(data.listId!) ?? 0) + 1);
  }
  const lists: ListSummary[] = [];
  for (const record of records.values()) {
    if (record.entity !== 'list' || record.deleted || !record.data) continue;
    lists.push({ list: record as SyncRecord<ListData>, open: open.get(record.id) ?? 0 });
  }
  return lists.sort((a, b) => (a.list.data!.position ?? 0) - (b.list.data!.position ?? 0) || a.list.id.localeCompare(b.list.id));
}

/** One list's tasks, open ones in order and finished ones after. Undefined once the list is gone. */
export function listView(records: ReadonlyMap<string, SyncRecord>, listId: string): ListView | undefined {
  const list = records.get(recordKey('list', listId));
  if (!list || list.deleted || !list.data) return undefined;
  const subtasks = subtasksByParent(records);
  const open: TaskEntry[] = [];
  const done: { entry: TaskEntry; at: number }[] = [];
  for (const item of liveItems(records)) {
    if (!isListTask(item.data!) || item.data!.listId !== listId) continue;
    const at = checkedAt(records, item.id);
    const entry = { item, done: at !== null, subtasks: subtasks.get(item.id) ?? [] };
    if (at === null) open.push(entry); else done.push({ entry, at });
  }
  done.sort((a, b) => b.at - a.at || byPosition(a.entry, b.entry));
  return { list: list as SyncRecord<ListData>, open: open.sort(byPosition), done: done.map(({ entry }) => entry) };
}

/**
 * List tasks due on or before a day (D27), most overdue first. A task checked on an earlier day
 * is finished and leaves; one checked today stays, done, so the ring keeps counting it.
 */
export function dueEntries(records: ReadonlyMap<string, SyncRecord>, day: string, dayOf: (editedAt: number) => string,
  subtasks: ReadonlyMap<string, Entry[]> = subtasksByParent(records)): DueEntry[] {
  const entries: DueEntry[] = [];
  for (const item of liveItems(records)) {
    const data = item.data!;
    if (!isListTask(data) || !data.dueDay || data.dueDay > day) continue;
    const at = checkedAt(records, item.id);
    if (at !== null && dayOf(at) < day) continue;
    const list = records.get(recordKey('list', data.listId!));
    entries.push({
      item, done: at !== null, subtasks: subtasks.get(item.id) ?? [],
      listTitle: (list?.data as ListData | null)?.title ?? 'A list',
      overdue: daysBetween(data.dueDay, day),
    });
  }
  return entries.sort((a, b) => b.overdue - a.overdue || byPosition(a, b));
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "Due today", "Due tomorrow", "Due Nov 20", "1 day overdue", "3 days overdue" */
export function dueLabel(dueDay: string, day: string): string {
  const days = daysBetween(day, dueDay);
  if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const date = new Date(`${dueDay}T00:00:00Z`);
  return `Due ${(dueDay.slice(0, 4) === day.slice(0, 4) ? SHORT_DATE : SHORT_DATE_YEAR).format(date)}`;
}

// Record builders.

export function newList(id: string, title: string, position: number): SyncRecord[] {
  return [blank('list', id, { title, position } satisfies ListData)];
}

export function renamedList(list: SyncRecord<ListData>, title: string): SyncRecord[] {
  return [{ ...list, data: { ...list.data!, title } }];
}

export function newListTask(id: string, listId: string, title: string, position: number, dueDay: string | null = null): SyncRecord[] {
  return [blank('item', id, { kind: 'task', title, listId, dueDay, position } satisfies ItemData)];
}

/** A subtask shares its parent's kind, list and original day, as the sync API requires. */
export function newSubtask(id: string, parent: SyncRecord<ItemData>, title: string, position: number): SyncRecord[] {
  const { kind, listId = null, originalDay = null } = parent.data!;
  if (kind === 'habit' || parent.data!.parentId) throw new Error('Only top-level tasks have subtasks.');
  return [blank('item', id, { kind, title, listId, originalDay, parentId: parent.id, position } satisfies ItemData)];
}

/** The list's tasks and their subtasks, which a list delete takes with it. */
export function tasksInList(records: ReadonlyMap<string, SyncRecord>, listId: string): SyncRecord<ItemData>[] {
  return [...liveItems(records)].filter((item) => item.data!.listId === listId);
}

/** Deletes go as tombstones that keep their data; sync never cascades, so the tasks go too. */
export function removedList(records: ReadonlyMap<string, SyncRecord>, list: SyncRecord<ListData>): SyncRecord[] {
  return [tombstone(list), ...tasksInList(records, list.id).map(tombstone)];
}

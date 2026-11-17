import { recordKey } from './types';
import type { CompletionData, ItemData, SyncRecord } from './types';

// Shared pieces of the client model: record lookups, semantic IDs, text rules and the blank
// record builder. daily.ts (Today) and lists.ts (named lists) both build on these.

export const TITLE_MAX = 500;
export const NOTES_MAX = 20_000;
/** Edit stamps may run a few minutes ahead of the clock; D32 clamps at five. */
export const CLOCK_SLACK_MS = 5 * 60_000;

export const habitCompletionId = (itemId: string, day: string) => `${itemId}:${day}`;
export const taskCompletionId = (itemId: string) => `${itemId}:task`;
export const scheduleId = (itemId: string, effectiveDay: string) => `${itemId}:${effectiveDay}`;

export const live = <D>(records: ReadonlyMap<string, SyncRecord>, key: string) => {
  const record = records.get(key);
  return record && !record.deleted && record.data ? record as SyncRecord<D> : undefined;
};

export function isCompleted(records: ReadonlyMap<string, SyncRecord>, completionId: string): boolean {
  return live<CompletionData>(records, recordKey('completion', completionId))?.data?.completed === true;
}

/** When a task or subtask was checked, or null while it's open. Unchecking is an edit, so it reopens. */
export function checkedAt(records: ReadonlyMap<string, SyncRecord>, itemId: string): number | null {
  const completion = live<CompletionData>(records, recordKey('completion', taskCompletionId(itemId)));
  return completion?.data?.completed === true ? completion.editedAt : null;
}

export interface Entry {
  item: SyncRecord<ItemData>;
  done: boolean;
}

const position = (record: SyncRecord<ItemData>) => record.data!.position ?? 0;
export const byPosition = (a: { item: SyncRecord<ItemData> }, b: { item: SyncRecord<ItemData> }) =>
  position(a.item) - position(b.item) || a.item.id.localeCompare(b.item.id);

/** Live subtasks grouped by parent ID, in order. Subtasks go one level deep (D26). */
export function subtasksByParent(records: ReadonlyMap<string, SyncRecord>): Map<string, Entry[]> {
  const byParent = new Map<string, Entry[]>();
  for (const record of records.values()) {
    if (record.entity !== 'item' || record.deleted || !record.data) continue;
    const parentId = (record.data as ItemData).parentId;
    if (!parentId) continue;
    const item = record as SyncRecord<ItemData>;
    byParent.set(parentId, [...byParent.get(parentId) ?? [], { item, done: checkedAt(records, item.id) !== null }]);
  }
  for (const entries of byParent.values()) entries.sort(byPosition);
  return byParent;
}

function cleanText(text: string, max: number, required: boolean): { text: string } | { error: string } {
  const trimmed = text.trim();
  if (required && !trimmed) return { error: 'Give it a name first.' };
  if (trimmed.length > max) return { error: `Keep it under ${max.toLocaleString('en-US')} characters.` };
  return { text: trimmed };
}

/** A trimmed title, or an error message for the user. */
export function cleanTitle(title: string): { title: string } | { error: string } {
  const result = cleanText(title, TITLE_MAX, true);
  return 'error' in result ? result : { title: result.text };
}

/** Trimmed notes (empty is fine), or an error message for the user. */
export function cleanNotes(notes: string): { notes: string } | { error: string } {
  const result = cleanText(notes, NOTES_MAX, false);
  return 'error' in result ? result : { notes: result.text };
}

// editedAt is a placeholder: SyncEngine.change stamps the real edit time.
export const blank = <D>(entity: SyncRecord['entity'], id: string, data: D): SyncRecord => ({ entity, id, editedAt: 0, deleted: false, data });

/** A tombstone that keeps its data, so archived items stay in history and sync (D34). */
export const tombstone = (record: SyncRecord): SyncRecord => ({ ...record, deleted: true, data: record.data && { ...record.data } });

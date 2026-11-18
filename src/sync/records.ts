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

/** The gap left between neighbours when places are assigned fresh. */
const PLACE_STEP = 1024;

/**
 * Drag-to-reorder (D49): move `items[from]` to index `to` and return the new places of only the
 * items that need one, so two devices reordering offline each keep their own latest drag. Usually
 * that's just the moved item, placed between its new neighbours.
 *
 * `placeOf` gives an item's current place, or null for one that waits at the top until it's
 * dragged (D54). Those always sort first, so any of them that end up below the moved item get a
 * place too. If the neighbours are too close to fit a number between them, everything shown is
 * renumbered, except rows still waiting at the top above it: rare, and still only a list's worth of edits.
 */
export function reorder<T>(items: readonly T[], placeOf: (item: T) => number | null, from: number, to: number): { item: T; place: number }[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [];
  const order = [...items];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  // The moved item, then any waiting-at-the-top items it now sits above.
  const run = [moved];
  let next = to + 1;
  while (next < order.length && placeOf(order[next]) === null) run.push(order[next++]);
  const upper = next < order.length ? placeOf(order[next]) : null;
  let lower: number | null = null;
  for (let i = to - 1; i >= 0 && lower === null; i--) lower = placeOf(order[i]);
  const places = run.map((_, i) => lower !== null && upper !== null ? lower + ((upper - lower) * (i + 1)) / (run.length + 1)
    : upper !== null ? upper - PLACE_STEP * (run.length - i)
    : lower !== null ? lower + PLACE_STEP * (i + 1)
    : PLACE_STEP * (i + 1));
  const fits = places.every((place, i) => Number.isFinite(place) && Math.abs(place) <= Number.MAX_SAFE_INTEGER
    && (i === 0 ? lower === null || place > lower : place > places[i - 1])) && (upper === null || places.at(-1)! < upper);
  if (fits) return run.map((item, i) => ({ item, place: places[i] }));
  // Renumber from the lowest place shown, so the list stays roughly where it was among items not shown.
  const known = order.map(placeOf).filter((place): place is number => place !== null);
  const base = known.length ? Math.max(-Number.MAX_SAFE_INTEGER / 2, Math.min(...known)) : 0;
  // Rows still waiting at the top above the moved one keep waiting (D54); they sort first regardless.
  return order.filter((item) => placeOf(item) !== null || run.includes(item))
    .map((item, i) => ({ item, place: base + PLACE_STEP * i }));
}

/** A list's open tasks or a task's subtasks after a drag: only the moved records, with new positions. */
export function repositioned(entries: readonly Entry[], from: number, to: number): SyncRecord[] {
  return reorder(entries, (entry) => entry.item.data!.position ?? 0, from, to)
    .map(({ item: { item }, place }) => ({ ...item, data: { ...item.data!, position: place } }));
}

/** The place after every item given (D50): new items land at the bottom. */
export function bottomPlace(places: Iterable<number | null>, now: number): number {
  let max = -Infinity;
  for (const place of places) if (place !== null && place > max) max = place;
  return Math.max(now, max + PLACE_STEP);
}

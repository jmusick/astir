import { blank, cleanNotes, cleanTitle, tombstone } from './records';
import { recordKey } from './types';
import type { CompletionData, ItemKind, PickData, PoolData, ScheduleData, SyncRecord } from './types';

// Buckets (D56–D62): a repeating task cycles through its pool, picking each day the items that have
// gone longest without being done. A day's picks are worked out from what was done before it, so
// checking one never reshuffles another (D61), and each is recorded once decided. Pure, like daily.ts.

/** A pool's size cap, in the spirit of D31's 100 subtasks per task. */
export const POOL_MAX = 100;
/** The most picks a day. */
export const PER_DAY_MAX = 20;

export const pickId = (itemId: string, day: string, poolId: string) => `${itemId}:${day}:${poolId}`;

import { carryEnds, perDayOn } from './repeats';
export { perDayOn };

/** The first day of the bucket run that `day` belongs to: items added that day count straight away (D73). */
function bucketStart(sorted: readonly ScheduleData[], day: string): string | null {
  let start: string | null = null;
  let on = false;
  for (const version of sorted) {
    if (version.effectiveDay > day) break;
    if (version.perDay == null) continue;
    if (version.perDay > 0 && !on) start = version.effectiveDay;
    on = version.perDay > 0;
  }
  return on ? start : null;
}

export interface BucketRecords {
  /** Each task's pool items, deleted ones included so past picks keep their names. */
  pools: Map<string, SyncRecord<PoolData>[]>;
  /** Each task's live pick records. */
  picks: Map<string, SyncRecord<PickData>[]>;
}

export function bucketRecords(records: ReadonlyMap<string, SyncRecord>): BucketRecords {
  const pools = new Map<string, SyncRecord<PoolData>[]>();
  const picks = new Map<string, SyncRecord<PickData>[]>();
  for (const record of records.values()) {
    if (!record.data) continue;
    if (record.entity === 'pool') {
      const data = record.data as PoolData;
      pools.set(data.itemId, [...pools.get(data.itemId) ?? [], record as SyncRecord<PoolData>]);
    } else if (record.entity === 'pick' && !record.deleted) {
      const data = record.data as PickData;
      picks.set(data.itemId, [...picks.get(data.itemId) ?? [], record as SyncRecord<PickData>]);
    }
  }
  for (const list of pools.values()) list.sort(byPoolOrder);
  return { pools, picks };
}

const byPoolOrder = (a: SyncRecord<PoolData>, b: SyncRecord<PoolData>) =>
  (a.data!.position ?? 0) - (b.data!.position ?? 0) || a.id.localeCompare(b.id);
const active = (pool: SyncRecord<PoolData> | undefined) => !!pool && !pool.deleted && !pool.data!.paused;

export interface BucketPick {
  pool: SyncRecord<PoolData>;
  /** The pick's record: the stored one, or the one to record now that it's decided. */
  record: SyncRecord<PickData>;
  /** True when the record isn't stored yet. */
  fresh: boolean;
  /** For a carried pick, the day it was first missed (D53, D60). */
  carry?: string;
}

export interface DayPicks {
  /** The day's picks: carried ones first, then the day's slots, extras last (D66, D74). */
  picks: BucketPick[];
  /** The next item in line, for "Do another" (D57); null when none is left. */
  next: SyncRecord<PoolData> | null;
}

export interface DayPicksOptions {
  /** Whether the task is scheduled that day. An unscheduled day has no fresh picks, only carried ones. */
  scheduled?: boolean;
  /** A past day keeps every pick it recorded, so a missed one keeps its name even after a pause or delete (D61, D70). */
  past?: boolean;
}

/**
 * A bucket task's picks on a day (D56, D57, D60, D61, D62, D74). Missed picks of a task set to roll
 * over carry with the same item and fill slots before fresh picks; extras and skips never carry.
 * The line is the active pool items, never-done first in pool order, then by how long since each
 * was last done before this day. Recorded picks keep their slots unless skipped, or paused or deleted
 * while unchecked (D73); a checked pick always stands. Empty slots take the next item in line.
 */
export function dayPicks(buckets: BucketRecords, itemId: string, kind: ItemKind, sorted: readonly ScheduleData[], day: string,
  { scheduled = true, past = false }: DayPicksOptions = {}): DayPicks {
  const perDay = scheduled ? perDayOn(sorted, day) : 0;
  const pools = buckets.pools.get(itemId) ?? [];
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  const all = buckets.picks.get(itemId) ?? [];
  const lastDone = new Map<string, string>();
  // Each item's latest pick before this day that could be missed: not an extra, not skipped (D60, D74).
  const latest = new Map<string, SyncRecord<PickData>>();
  for (const pick of all) {
    const data = pick.data!;
    if (data.day >= day) continue;
    if (data.done && (lastDone.get(data.poolId) ?? '') < data.day) lastDone.set(data.poolId, data.day);
    if (!data.extra && !data.skipped && (latest.get(data.poolId)?.data!.day ?? '') < data.day) latest.set(data.poolId, pick);
  }
  const start = bucketStart(sorted, day);
  const line = pools.filter((pool) => active(pool) && (pool.data!.createdDay < day || pool.data!.createdDay === start))
    .sort((a, b) => (lastDone.get(a.id) ?? '').localeCompare(lastDone.get(b.id) ?? '') || byPoolOrder(a, b));
  const today = all.filter((pick) => pick.data!.day === day);
  const skipped = new Set(today.filter((pick) => pick.data!.skipped).map((pick) => pick.data!.poolId));
  const used = new Set<string>();
  const picks: BucketPick[] = [];
  const stands = (pick: SyncRecord<PickData>) => !pick.data!.skipped && byId.has(pick.data!.poolId)
    && !used.has(pick.data!.poolId) && (past || pick.data!.done || active(byId.get(pick.data!.poolId)));
  const take = (pick: SyncRecord<PickData>, fresh: boolean) => {
    used.add(pick.data!.poolId);
    picks.push({ pool: byId.get(pick.data!.poolId)!, record: pick, fresh, ...(pick.data!.from ? { carry: pick.data!.from } : {}) });
  };
  let slot = 0;
  // Carried picks fill slots first, oldest first: those already recorded today, then the rest (D74).
  const carriedToday = today.filter((pick) => pick.data!.from && !pick.data!.extra)
    .sort((a, b) => a.data!.from!.localeCompare(b.data!.from!) || a.data!.slot - b.data!.slot);
  for (const pick of carriedToday) if (stands(pick)) { take(pick, false); slot = Math.max(slot, pick.data!.slot + 1); }
  const carries = [...latest.values()].filter((pick) => {
    const data = pick.data!;
    if (data.done || used.has(data.poolId) || today.some((t) => t.data!.poolId === data.poolId) || !active(byId.get(data.poolId))) return false;
    const ends = carryEnds(kind, sorted, data.from ?? data.day);
    return ends === null || ends > day;
  }).sort((a, b) => (a.data!.from ?? a.data!.day).localeCompare(b.data!.from ?? b.data!.day));
  for (const pick of carries) {
    const data = pick.data!;
    // A carried pick keeps, for this carry, where it was dragged (D54); its checklist is keyed by `from` (D55).
    take(blank('pick', pickId(itemId, day, data.poolId), {
      itemId, day, poolId: data.poolId, slot: slot++, from: data.from ?? data.day, place: data.from ? data.place ?? null : null,
    } satisfies PickData) as SyncRecord<PickData>, true);
  }
  const nextInLine = () => line.find((pool) => !used.has(pool.id) && !skipped.has(pool.id)) ?? null;
  for (; slot < perDay; slot++) {
    // Two devices may have picked different items for a slot offline: a checked one stands, then the latest (D61).
    const recorded = today.filter((pick) => !pick.data!.extra && !pick.data!.from && pick.data!.slot === slot && stands(pick))
      .sort((a, b) => Number(!!b.data!.done) - Number(!!a.data!.done) || b.editedAt - a.editedAt)[0];
    if (recorded) { take(recorded, false); continue; }
    const pool = nextInLine();
    if (!pool) break;
    take(blank('pick', pickId(itemId, day, pool.id), { itemId, day, poolId: pool.id, slot } satisfies PickData) as SyncRecord<PickData>, true);
  }
  for (const extra of today.filter((pick) => pick.data!.extra).sort((a, b) => a.data!.slot - b.data!.slot)) if (stands(extra)) take(extra, false);
  // Do another skips items holding any record today, such as a slot another device lost, so it never rewrites one.
  const recordedToday = new Set(today.map((pick) => pick.data!.poolId));
  return { picks, next: perDay > 0 ? line.find((pool) => !used.has(pool.id) && !skipped.has(pool.id) && !recordedToday.has(pool.id)) ?? null : null };
}

// Record builders.

export function pickChecked(pick: SyncRecord<PickData>, done: boolean): SyncRecord[] {
  return [{ ...pick, data: { ...pick.data!, done } }];
}

/**
 * A pick row's own checklist (D59): a completion per subtask and pick, on the day the pick's carry
 * began, so a carried pick keeps its checks (D55) and two devices checking different steps never collide.
 */
export const pickCheckId = (subtaskId: string, pick: SyncRecord<PickData>) => `${subtaskId}:${pick.data!.from ?? pick.data!.day}:${pick.data!.poolId}`;
export function pickSubtaskChecked(pick: SyncRecord<PickData>, subtaskId: string, checked: boolean): SyncRecord[] {
  const data: CompletionData = { itemId: subtaskId, day: pick.data!.from ?? pick.data!.day, completed: checked, poolId: pick.data!.poolId };
  return [blank('completion', pickCheckId(subtaskId, pick), data)];
}

/** Skip swaps a pick for the next in line, today only; the skipped item keeps its place in line (D57, D74). */
export function pickSkipped(pick: SyncRecord<PickData>): SyncRecord[] {
  return [{ ...pick, data: { ...pick.data!, skipped: true, done: false } }];
}

/** Do another: the next item in line as an extra row for today (D57). */
export function extraPick(itemId: string, day: string, pool: SyncRecord<PoolData>, slot: number): SyncRecord[] {
  return [blank('pick', pickId(itemId, day, pool.id), { itemId, day, poolId: pool.id, slot, extra: true } satisfies PickData)];
}

export function newPoolItem(id: string, itemId: string, name: string, position: number, day: string): SyncRecord[] {
  const result = cleanTitle(name);
  if ('error' in result) throw new Error(result.error);
  return [blank('pool', id, { itemId, name: result.title, notes: '', paused: false, position, createdDay: day } satisfies PoolData)];
}

export function poolEdited(pool: SyncRecord<PoolData>, changes: Partial<Pick<PoolData, 'name' | 'notes' | 'paused'>>): SyncRecord[] {
  if (changes.notes !== undefined) { const r = cleanNotes(changes.notes); if ('error' in r) throw new Error(r.error); changes = { ...changes, notes: r.notes }; }
  return [{ ...pool, data: { ...pool.data!, ...changes } }];
}

/** A deleted pool item leaves the rotation; its tombstone keeps its name for past picks (D34). */
export const poolRemoved = (pool: SyncRecord<PoolData>): SyncRecord[] => [tombstone(pool)];

/** A task's live pool items, in pool order. */
export const livePool = (records: ReadonlyMap<string, SyncRecord>, itemId: string) => (bucketRecords(records).pools.get(itemId) ?? []).filter((pool) => !pool.deleted);

export const isPicked = (records: ReadonlyMap<string, SyncRecord>, pick: SyncRecord<PickData>) => records.has(recordKey('pick', pick.id));

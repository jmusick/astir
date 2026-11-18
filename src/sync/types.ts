// The wire and storage shape of a sync record. docs/sync-api.md owns the contract.
export type Entity = 'list' | 'item' | 'schedule' | 'completion' | 'day' | 'dismissal' | 'pool' | 'pick';

export interface SyncRecord<D = unknown> {
  entity: Entity;
  id: string;
  /** Client edit time in epoch milliseconds. The most recent edit wins (D32). */
  editedAt: number;
  /** Tombstones keep their data locally so archived habits stay in history (D34). */
  deleted: boolean;
  data: D | null;
  /** Local only, never sent: the server holds this tombstone without data and needs it back. */
  archive?: boolean;
}

export type ItemKind = 'habit' | 'today' | 'task';
export interface ItemData {
  kind: ItemKind;
  title: string;
  notes?: string;
  position?: number;
  listId?: string | null;
  parentId?: string | null;
  originalDay?: string | null;
  createdDay?: string | null;
  dueDay?: string | null;
  reminder?: string | null;
  /** A daily task's usual place on Today (D47, D48). Absent on v1 records: see `todayPlace`. */
  todayPosition?: number | null;
  /** Its place on Today for one carry or due date only, the one that began on carryDay (D54, D65). */
  carryPosition?: number | null;
  carryDay?: string | null;
}
/**
 * A daily task's repeat and missed setting from effectiveDay on (D40, D51, D52). No weekdays means it
 * doesn't repeat; a null or absent `missed` keeps the previous version's.
 */
export interface ScheduleData {
  itemId: string; effectiveDay: string; weekdays: number[]; missed?: 'drop' | 'carry' | null;
  /** A bucket's picks a day (D56): 0 for no bucket, null or absent to keep the previous version's. */
  perDay?: number | null;
}
/** A bucket's pool item (D58). It joins the rotation the day after createdDay, unless its bucket starts that day. */
export interface PoolData { itemId: string; name: string; notes?: string; paused?: boolean; position?: number; createdDay: string }
/**
 * A pool item picked for a day (D61), keyed itemId:day:poolId. `slot` orders the day's picks; an
 * extra comes from "Do another" (D57). `place` is where the owner dragged this row today (D66).
 */
export interface PickData { itemId: string; day: string; poolId: string; slot: number; extra?: boolean; done?: boolean; skipped?: boolean; place?: number | null }
export interface CompletionData { itemId: string; day: string | null; completed: boolean }
/** A reminder the user dismissed, so other devices skip it (D42). `reminder` is the time it was for. */
export interface DismissalData { itemId: string; day: string | null; reminder: string }
/** The account's day boundary from effectiveDay on: an IANA time zone and a day-start hour (D6, D34). */
export interface DayData { effectiveDay: string; timeZone: string; startHour: number }

export const recordKey = (entity: Entity, id: string) => `${entity}/${id}`;
export const keyOf = (record: Pick<SyncRecord, 'entity' | 'id'>) => recordKey(record.entity, record.id);

export interface PullPage { changes: SyncRecord[]; cursor: string; hasMore: boolean; serverTime: number }

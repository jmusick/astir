// The wire and storage shape of a sync record. docs/sync-api.md owns the contract.
export type Entity = 'list' | 'item' | 'schedule' | 'completion';

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
}
export interface ScheduleData { itemId: string; effectiveDay: string; weekdays: number[] }
export interface CompletionData { itemId: string; day: string | null; completed: boolean }

export const recordKey = (entity: Entity, id: string) => `${entity}/${id}`;
export const keyOf = (record: Pick<SyncRecord, 'entity' | 'id'>) => recordKey(record.entity, record.id);

export interface PullPage { changes: SyncRecord[]; cursor: string; hasMore: boolean; serverTime: number }

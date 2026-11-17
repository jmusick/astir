import type { SyncRecord } from './types';

// Storage for one account's local data. The engine keeps its working copy in memory and
// persists every change through this interface, so IndexedDB (web) and SQLite (Tauri, D13)
// can each implement it without the engine knowing which one it has.
export interface StoredState {
  records: SyncRecord[];
  /** Keys (entity/id) of records changed locally and not yet accepted by the server. */
  pending: string[];
  /** Opaque pull cursor; "0" for a fresh store. */
  cursor: string;
}

/** One atomic write. Implementations must apply all of it or none of it. */
export interface StoreWrite {
  put?: SyncRecord[];
  addPending?: string[];
  removePending?: string[];
  cursor?: string;
}

export interface SyncStore {
  load(): Promise<StoredState>;
  write(change: StoreWrite): Promise<void>;
  /** Close the store and remove all of this account's local data (D45). */
  destroy(): Promise<void>;
  close(): void;
}

/** Keeps data in memory only: for tests and browsers without IndexedDB. */
export class MemoryStore implements SyncStore {
  records = new Map<string, SyncRecord>();
  pending = new Set<string>();
  cursor = '0';
  writes = 0;

  async load(): Promise<StoredState> {
    return { records: [...this.records.values()].map((r) => structuredClone(r)), pending: [...this.pending], cursor: this.cursor };
  }
  async write(change: StoreWrite) {
    this.writes += 1;
    for (const record of change.put ?? []) this.records.set(`${record.entity}/${record.id}`, structuredClone(record));
    for (const key of change.removePending ?? []) this.pending.delete(key);
    for (const key of change.addPending ?? []) this.pending.add(key);
    if (change.cursor !== undefined) this.cursor = change.cursor;
  }
  async destroy() { this.records.clear(); this.pending.clear(); this.cursor = '0'; }
  close() { /* Nothing to release. */ }
}

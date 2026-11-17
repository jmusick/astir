import type { StoredState, StoreWrite, SyncStore } from './store';
import type { SyncRecord } from './types';

// The browser's SyncStore. Deliberately thin: all sync logic lives in the engine.
// One database per account (D45), so another user on this browser never opens it.

const VERSION = 1;
export const databaseName = (accountId: string) => `astir-${accountId}`;

const done = (request: IDBRequest) => new Promise<void>((resolve, reject) => {
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});
const finished = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Local save was aborted.'));
});
const all = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** onClosedElsewhere runs when another tab deletes or upgrades this database (for example, it signed out). */
export async function openIndexedDbStore(accountId: string, factory: IDBFactory = indexedDB, onClosedElsewhere?: () => void): Promise<SyncStore> {
  const name = databaseName(accountId);
  const request = factory.open(name, VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    // records: out-of-line key "entity/id"; pending: key -> true; meta: "cursor" -> string.
    for (const store of ['records', 'pending', 'meta']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
  };
  let db = await all(request);
  // Another tab deleting this account's data (sign-out) must not be blocked by us.
  db.onversionchange = () => { db.close(); onClosedElsewhere?.(); };

  return {
    async load(): Promise<StoredState> {
      const tx = db.transaction(['records', 'pending', 'meta'], 'readonly');
      const [records, pending, cursor] = await Promise.all([
        all(tx.objectStore('records').getAll() as IDBRequest<SyncRecord[]>),
        all(tx.objectStore('pending').getAllKeys()),
        all(tx.objectStore('meta').get('cursor') as IDBRequest<string | undefined>),
      ]);
      return { records, pending: pending.map(String), cursor: cursor ?? '0' };
    },
    async write(change: StoreWrite) {
      const tx = db.transaction(['records', 'pending', 'meta'], 'readwrite');
      const records = tx.objectStore('records');
      const pending = tx.objectStore('pending');
      for (const record of change.put ?? []) records.put(record, `${record.entity}/${record.id}`);
      for (const key of change.removePending ?? []) pending.delete(key);
      for (const key of change.addPending ?? []) pending.put(true, key);
      if (change.cursor !== undefined) tx.objectStore('meta').put(change.cursor, 'cursor');
      await finished(tx);
    },
    async destroy() {
      db.close();
      await done(factory.deleteDatabase(name));
      // Reopening after destroy would recreate an empty database; make misuse obvious instead.
      db = undefined as unknown as IDBDatabase;
    },
    close() { db?.close(); },
  };
}

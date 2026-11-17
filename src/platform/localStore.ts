import { databaseName, openIndexedDbStore } from '../sync/indexedDbStore';
import type { SyncStore } from '../sync/store';
import { isApp } from './platform';
import { openSqliteStore } from './sqliteStore';

/** This account's local store: SQLite in the app, IndexedDB in the browser (D13, D45). */
export function openLocalStore(accountId: string, onClosedElsewhere: () => void): Promise<SyncStore> {
  return isApp ? openSqliteStore(accountId) : openIndexedDbStore(accountId, indexedDB, onClosedElsewhere);
}

/** Remove an account's local data without opening the app for it (D29, D45). */
export async function wipeLocalData(accountId: string) {
  try {
    if (isApp) await (await openSqliteStore(accountId)).destroy();
    else indexedDB.deleteDatabase(databaseName(accountId));
  } catch { /* Nothing stored, or storage unavailable. */ }
}

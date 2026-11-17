import type { StoredState, StoreWrite, SyncStore } from '../sync/store';
import type { SyncRecord } from '../sync/types';

// The native apps' SyncStore (D13): SQLite through Tauri's SQL plugin, one database file per
// account (D45). Like the IndexedDB store it is deliberately thin; the engine owns sync logic.
//
// The plugin runs each call on a connection pool, so BEGIN/COMMIT across calls isn't safe. Every
// write is therefore one INSERT … ON CONFLICT over json_each, which SQLite applies atomically:
// records, pending flags and the pull cursor (row "#cursor") live in the same table.

/** The slice of @tauri-apps/plugin-sql's Database this store needs, so tests can use node:sqlite. */
export interface SqlDatabase {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<unknown>;
}

const CURSOR = '#cursor';
const SCHEMA = `CREATE TABLE IF NOT EXISTS local_records (
  key TEXT PRIMARY KEY,
  record TEXT,
  pending INTEGER NOT NULL DEFAULT -1
)`;
// pending: 1 waiting for the server, 0 settled, -1 "leave as it is" (only meaningful in a write).
const WRITE = `INSERT INTO local_records (key, record, pending)
  SELECT json_extract(value, '$.k'), json_extract(value, '$.r'), json_extract(value, '$.p') FROM json_each($1) WHERE true
  ON CONFLICT(key) DO UPDATE SET
    record = coalesce(excluded.record, local_records.record),
    pending = CASE WHEN excluded.pending = -1 THEN local_records.pending ELSE excluded.pending END`;

export const sqliteFileName = (accountId: string) => `astir-${accountId}.db`;

export async function sqliteStore(db: SqlDatabase): Promise<SyncStore> {
  await db.execute(SCHEMA);
  let open = true;
  return {
    async load(): Promise<StoredState> {
      const rows = await db.select<{ key: string; record: string | null; pending: number }[]>('SELECT key, record, pending FROM local_records');
      const records: SyncRecord[] = [];
      const pending: string[] = [];
      let cursor = '0';
      for (const row of rows) {
        if (row.key === CURSOR) { cursor = row.record ?? '0'; continue; }
        if (row.record != null) records.push(JSON.parse(row.record) as SyncRecord);
        if (row.pending === 1) pending.push(row.key);
      }
      return { records, pending, cursor };
    },
    async write(change: StoreWrite) {
      const ops = new Map<string, { k: string; r: string | null; p: number }>();
      const op = (key: string) => ops.get(key) ?? ops.set(key, { k: key, r: null, p: -1 }).get(key)!;
      for (const record of change.put ?? []) op(`${record.entity}/${record.id}`).r = JSON.stringify(record);
      for (const key of change.removePending ?? []) op(key).p = 0;
      for (const key of change.addPending ?? []) op(key).p = 1;
      if (change.cursor !== undefined) op(CURSOR).r = change.cursor;
      if (ops.size) await db.execute(WRITE, [JSON.stringify([...ops.values()])]);
    },
    async destroy() {
      open = false;
      // The plugin can't remove the file, so empty it and give the space back (D45).
      await db.execute('DELETE FROM local_records');
      await db.execute('VACUUM').catch(() => undefined);
      await db.close();
    },
    close() { if (open) { open = false; void db.close().catch(() => undefined); } },
  };
}

/** Opens this account's database through Tauri's SQL plugin. App only. */
export async function openSqliteStore(accountId: string): Promise<SyncStore> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  return sqliteStore(await Database.load(`sqlite:${sqliteFileName(accountId)}`) as SqlDatabase);
}

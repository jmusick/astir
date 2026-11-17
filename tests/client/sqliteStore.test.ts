/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sqliteStore } from '../../src/platform/sqliteStore';
import type { SqlDatabase } from '../../src/platform/sqliteStore';
import { SyncEngine } from '../../src/sync/engine';
import { newTodayTask } from '../../src/sync/daily';
import type { SyncRecord } from '../../src/sync/types';

// Tauri's SQL plugin over node:sqlite: $1 placeholders, select returns rows, execute runs one statement.
function nodeDatabase(sqlite = new DatabaseSync(':memory:')): SqlDatabase & { sqlite: DatabaseSync; closed: boolean } {
  const params = (values: unknown[] = []) => values as (string | number | null)[];
  // The plugin binds $1, $2 … by position; node:sqlite reads $1 as a name, so number them as ?1.
  const positional = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');
  return {
    sqlite, closed: false,
    async execute(sql, values) { sqlite.prepare(positional(sql)).run(...params(values)); return {}; },
    async select<T>(sql: string, values?: unknown[]) { return sqlite.prepare(positional(sql)).all(...params(values)) as T; },
    async close() { this.closed = true; return true; },
  };
}
const record = (id: string, title = id, editedAt = 1): SyncRecord => ({ entity: 'list', id, editedAt, deleted: false, data: { title } });

describe('SQLite store', () => {
  it('saves records, pending keys and the cursor, and reads them back after reopening', async () => {
    const db = nodeDatabase();
    const store = await sqliteStore(db);
    expect(await store.load()).toEqual({ records: [], pending: [], cursor: '0' });
    await store.write({ put: [record('a'), record('b')], addPending: ['list/a', 'list/b'] });
    await store.write({ put: [record('a', 'A2', 2)], removePending: ['list/b'], cursor: '42' });
    const again = await sqliteStore(db);
    const state = await again.load();
    expect(state.records.sort((x, y) => x.id.localeCompare(y.id))).toEqual([record('a', 'A2', 2), record('b')]);
    expect(state.pending).toEqual(['list/a']);
    expect(state.cursor).toBe('42');
  });

  it('applies a write all or nothing', async () => {
    const db = nodeDatabase();
    const store = await sqliteStore(db);
    await store.write({ put: [record('a')], addPending: ['list/a'] });
    // A failing statement leaves everything as it was.
    db.sqlite.exec(`CREATE TRIGGER refuse BEFORE INSERT ON local_records WHEN NEW.key = 'list/bad' BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(store.write({ put: [record('c'), record('bad')], removePending: ['list/a'], cursor: '9' })).rejects.toThrow();
    expect(await store.load()).toEqual({ records: [record('a')], pending: ['list/a'], cursor: '0' });
  });

  it('wipes the account’s data and closes on destroy', async () => {
    const db = nodeDatabase();
    const store = await sqliteStore(db);
    await store.write({ put: [record('a')], addPending: ['list/a'], cursor: '3' });
    await store.destroy();
    expect(db.closed).toBe(true);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM local_records').get()!.n).toBe(0);
  });

  it('runs the sync engine like any other store', async () => {
    const store = await sqliteStore(nodeDatabase());
    const pushed: SyncRecord[][] = [];
    const engine = await SyncEngine.open(store, {
      push: async (changes) => { pushed.push(changes); },
      pull: async (cursor) => ({ changes: [], cursor: String(Number(cursor) + 1), hasMore: false, serverTime: Date.now() }),
    }, { syncDelayMs: false });
    await engine.change(newTodayTask('t', 'Call the bank', '2026-11-17', 1));
    expect((await store.load()).pending).toEqual(['item/t']);
    await engine.sync();
    expect(pushed.flat().map((r) => r.id)).toEqual(['t']);
    expect(await store.load()).toMatchObject({ pending: [], cursor: '1' });
  });
});

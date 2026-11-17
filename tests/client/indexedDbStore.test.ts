import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { databaseName, openIndexedDbStore } from '../../src/sync/indexedDbStore';
import type { SyncRecord } from '../../src/sync/types';

const record = (id: string, title: string): SyncRecord => ({ entity: 'item', id, editedAt: 1, deleted: false, data: { kind: 'today', title, originalDay: '2026-11-16' } });

describe('IndexedDB store', () => {
  it('starts empty with cursor 0', async () => {
    const store = await openIndexedDbStore('user-a', new IDBFactory());
    expect(await store.load()).toEqual({ records: [], pending: [], cursor: '0' });
  });

  it('writes records, pending keys and the cursor together, and reloads them', async () => {
    const factory = new IDBFactory();
    const store = await openIndexedDbStore('user-a', factory);
    await store.write({ put: [record('a', 'A'), record('b', 'B')], addPending: ['item/a', 'item/b'], cursor: '4' });
    await store.write({ put: [record('a', 'A2')], removePending: ['item/a'] });
    store.close();
    const reopened = await openIndexedDbStore('user-a', factory);
    const state = await reopened.load();
    expect(state.records.map((r) => (r.data as { title: string }).title).sort()).toEqual(['A2', 'B']);
    expect(state.pending).toEqual(['item/b']);
    expect(state.cursor).toBe('4');
  });

  it('keeps each account in its own database and wipes one on destroy (D45)', async () => {
    const factory = new IDBFactory();
    const a = await openIndexedDbStore('user-a', factory);
    const b = await openIndexedDbStore('user-b', factory);
    await a.write({ put: [record('a', 'Mine')], cursor: '9' });
    expect((await b.load()).records).toEqual([]);
    await a.destroy();
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).toContain(databaseName('user-b'));
    expect(names).not.toContain(databaseName('user-a'));
    const fresh = await openIndexedDbStore('user-a', factory);
    expect(await fresh.load()).toEqual({ records: [], pending: [], cursor: '0' });
  });
});

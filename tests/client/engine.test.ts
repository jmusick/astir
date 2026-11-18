import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunk, mergePulled, parentsFirst, SyncEngine } from '../../src/sync/engine';
import type { EngineOptions } from '../../src/sync/engine';
import { EVERY_DAY, newHabit, newTodayTask, removed, renamed, setCompleted, todayView } from '../../src/sync/daily';
import { MemoryStore } from '../../src/sync/store';
import { httpTransport, SyncRequestError } from '../../src/sync/transport';
import type { SyncTransport } from '../../src/sync/transport';
import { keyOf } from '../../src/sync/types';
import type { ItemData, PullPage, SyncRecord } from '../../src/sync/types';
import type { TodayView } from '../../src/sync/daily';
const tasksOf = (v: TodayView) => v.entries.filter((e) => e.source === 'today');

const DAY = '2026-11-16';

/** A small stand-in for the Worker: last-write-wins, delete wins, revisions and pages. */
class FakeServer {
  rows = new Map<string, SyncRecord & { revision: number }>();
  revision = 0;
  pushes: SyncRecord[][] = [];
  pulls: string[] = [];
  fail: SyncRequestError | null = null;
  pageSize = 100;
  serverTime = 0;
  /** Like the Worker: completions must reference an item that has data. */
  checkReferences = false;

  transport(): SyncTransport {
    return {
      push: async (changes) => {
        if (this.fail) throw this.fail;
        this.pushes.push(structuredClone(changes));
        if (this.checkReferences) {
          const items = new Map([...this.rows.values()].filter((r) => r.entity === 'item').map((r) => [r.id, r.data]));
          for (const c of changes) if (c.entity === 'item' && (c.data || !items.has(c.id))) items.set(c.id, c.data ?? items.get(c.id) ?? null);
          const broken = changes.some((c) => c.entity === 'completion' && !c.deleted && !items.get((c.data as { itemId: string }).itemId));
          if (broken) throw new SyncRequestError('Invalid record reference.', 400);
        }
        for (const change of changes) {
          const key = keyOf(change);
          const row = this.rows.get(key);
          if (!row) { this.rows.set(key, { ...structuredClone(change), revision: ++this.revision }); continue; }
          if (row.deleted && row.data == null && change.data) { row.data = structuredClone(change.data); row.revision = ++this.revision; continue; }
          if (row.deleted) continue;
          if (change.deleted || change.editedAt > row.editedAt) {
            this.rows.set(key, { ...structuredClone(change), data: change.deleted ? row.data : structuredClone(change.data), editedAt: Math.max(row.editedAt, change.editedAt), revision: ++this.revision });
          }
        }
      },
      pull: async (cursor): Promise<PullPage> => {
        if (this.fail) throw this.fail;
        this.pulls.push(cursor);
        const rows = [...this.rows.values()].filter((r) => r.revision > Number(cursor)).sort((a, b) => a.revision - b.revision);
        const page = rows.slice(0, this.pageSize);
        return {
          changes: page.map((row) => { const record: SyncRecord & { revision?: number } = structuredClone(row); delete record.revision; return record; }),
          cursor: String(page.at(-1)?.revision ?? cursor), hasMore: rows.length > this.pageSize, serverTime: this.serverTime,
        };
      },
    };
  }
}

let clock = 1_000;
const options: EngineOptions = { now: () => clock, syncDelayMs: false };
async function device(server: FakeServer, store = new MemoryStore(), extra: EngineOptions = {}) {
  const engine = await SyncEngine.open(store, server.transport(), { ...options, ...extra });
  return { engine, store };
}
const item = (engine: SyncEngine, id: string) => engine.getSnapshot().records.get(`item/${id}`) as SyncRecord<ItemData>;

afterEach(() => { vi.useRealTimers(); });

describe('clock skew', () => {
  it('measures the device clock against server time at each pull', async () => {
    const server = new FakeServer();
    const { engine } = await device(server);
    expect(engine.getSnapshot().clockSkewMs).toBeNull();
    server.serverTime = clock + 10 * 60_000;
    await engine.sync();
    expect(engine.getSnapshot().clockSkewMs).toBe(10 * 60_000);
    server.serverTime = 0; // An old server without serverTime leaves the last reading alone.
    await engine.sync();
    expect(engine.getSnapshot().clockSkewMs).toBe(10 * 60_000);
  });
});

describe('local-first changes', () => {
  it('updates the snapshot at once and saves locally before any network call', async () => {
    const server = new FakeServer();
    const { engine, store } = await device(server);
    let notified = 0;
    engine.subscribe(() => { notified += 1; });
    const saved = engine.change(newTodayTask('t', 'Call', DAY, 1));
    expect(engine.getSnapshot().records.get('item/t')?.data).toMatchObject({ title: 'Call' });
    expect(engine.getSnapshot().status.pending).toBe(1);
    expect(notified).toBeGreaterThan(0);
    await saved;
    expect(store.records.get('item/t')).toBeDefined();
    expect([...store.pending]).toEqual(['item/t']);
    expect(server.pushes).toHaveLength(0);
  });

  it('reopens from the store with its records, pending changes and cursor', async () => {
    const server = new FakeServer();
    const first = await device(server);
    await first.engine.change(newTodayTask('t', 'Call', DAY, 1));
    first.engine.close();
    const again = await device(server, first.store);
    expect(again.engine.getSnapshot().status.pending).toBe(1);
    await again.engine.sync();
    expect(server.rows.get('item/t')).toBeDefined();
    expect(again.store.cursor).toBe('1');
  });

  it('stamps each local edit after the previous one, even with a stalled clock', async () => {
    const { engine } = await device(new FakeServer());
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.change(renamed(item(engine, 't'), 'Call mom'));
    expect(item(engine, 't').editedAt).toBe(clock + 1);
  });

  it('never resurrects a local tombstone', async () => {
    const { engine } = await device(new FakeServer());
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    const task = item(engine, 't');
    await engine.change(removed(task));
    await engine.change(renamed(task, 'Back'));
    expect(item(engine, 't')).toMatchObject({ deleted: true, data: { title: 'Call' } });
  });
});

describe('sync', () => {
  it('pushes parents before children, pulls afterwards, and clears pending', async () => {
    const server = new FakeServer();
    const { engine, store } = await device(server);
    await engine.change(newHabit('h', 'Walk', EVERY_DAY, DAY, 1));
    await engine.change(setCompleted(item(engine, 'h'), DAY, true));
    await engine.sync();
    expect(server.pushes[0].map((c) => c.entity)).toEqual(['item', 'schedule', 'completion']);
    expect(server.pulls).toEqual(['0']);
    expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
    expect(store.pending.size).toBe(0);
    expect(store.cursor).toBe('3');
  });

  it('dedupes one habit checked on two devices into one completion', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.change(newHabit('h', 'Walk', EVERY_DAY, DAY, 1));
    await a.engine.sync();
    const b = await device(server);
    await b.engine.sync();
    await a.engine.change(setCompleted(item(a.engine, 'h'), DAY, true));
    await b.engine.change(setCompleted(item(b.engine, 'h'), DAY, true));
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
    expect([...server.rows.keys()].filter((k) => k.startsWith('completion/'))).toEqual([`completion/h:${DAY}`]);
    expect(todayView(a.engine.getSnapshot().records, DAY, () => DAY).done).toBe(1);
    expect(todayView(b.engine.getSnapshot().records, DAY, () => DAY).done).toBe(1);
  });

  it('follows pages and stores each page with its cursor', async () => {
    const server = new FakeServer();
    server.pageSize = 2;
    const a = await device(server);
    for (let i = 0; i < 5; i++) await a.engine.change(newTodayTask(`t${i}`, `Task ${i}`, DAY, i));
    await a.engine.sync();
    const b = await device(server);
    const writes = b.store.writes;
    await b.engine.sync();
    expect(server.pulls.slice(-3)).toEqual(['0', '2', '4']);
    expect(b.store.writes - writes).toBe(3);
    expect(b.store.cursor).toBe('5');
    expect(tasksOf(todayView(b.engine.getSnapshot().records, DAY, () => DAY))).toHaveLength(5);
  });

  it('keeps work local and retries with backoff while offline', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    server.fail = new SyncRequestError('Astir could not be reached.', 0);
    const { engine } = await device(server, new MemoryStore(), { retryBaseMs: 1_000 });
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.sync();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'offline', pending: 1 });
    await vi.advanceTimersByTimeAsync(1_000); // First retry fails too.
    expect(engine.getSnapshot().status.state).toBe('offline');
    server.fail = null;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.rows.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1); // Second retry after 2 s succeeds.
    expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
    expect(server.rows.has('item/t')).toBe(true);
    engine.close();
  });

  it('syncs shortly after a local change when automatic sync is on', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const { engine } = await device(server, new MemoryStore(), { syncDelayMs: 300 });
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.change(newTodayTask('u', 'Write', DAY, 2));
    await vi.advanceTimersByTimeAsync(300);
    expect(server.pushes).toHaveLength(1);
    expect(server.pushes[0]).toHaveLength(2);
    engine.close();
  });

  it('shows a server rejection, keeps the changes, still pulls and does not retry by itself', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const transport = server.transport();
    transport.push = async () => { throw new SyncRequestError('You have reached 10000 open items.', 409); };
    const rejecting = await SyncEngine.open(new MemoryStore(), transport, options);
    await rejecting.change(newTodayTask('x', 'Extra', DAY, 1));
    await rejecting.sync();
    expect(rejecting.getSnapshot().status).toMatchObject({ state: 'rejected', message: 'You have reached 10000 open items.', pending: 1 });
    expect(server.pulls).toEqual(['0']);
    expect(vi.getTimerCount()).toBe(0);
    expect(rejecting.getSnapshot().records.get('item/x')).toBeDefined();
  });

  it('reports a revoked session as signed out and keeps the local data', async () => {
    const server = new FakeServer();
    server.fail = new SyncRequestError('Please sign in.', 401);
    const { engine } = await device(server);
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.sync();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'signed-out', pending: 1 });
  });

  it('reports an account deleted elsewhere so the device can clear itself', async () => {
    const server = new FakeServer();
    server.fail = new SyncRequestError('Please sign in.', 401, 'account-deleted');
    const { engine } = await device(server);
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.sync();
    expect(engine.getSnapshot().status.state).toBe('account-deleted');
  });

  it('keeps an edit made during a push pending for the next one', async () => {
    const server = new FakeServer();
    const transport = server.transport();
    const inner = transport.push;
    let edited = false;
    const racing = await SyncEngine.open(new MemoryStore(), {
      pull: transport.pull,
      push: async (changes) => {
        await inner(changes);
        if (!edited) { edited = true; clock += 10; void racing.change(renamed(item(racing, 't'), 'Call mom')); }
      },
    }, options);
    await racing.change(newTodayTask('t', 'Call', DAY, 1));
    await racing.sync();
    expect(racing.getSnapshot().status.pending).toBe(1);
    expect(item(racing, 't').data!.title).toBe('Call mom');
    await racing.sync();
    expect(server.rows.get('item/t')?.data).toMatchObject({ title: 'Call mom' });
    expect(racing.getSnapshot().status.pending).toBe(0);
  });

  it('sends deletes in the same push as other changes', async () => {
    const server = new FakeServer();
    const { engine } = await device(server);
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.sync();
    await engine.change(removed(item(engine, 't')));
    await engine.change(newTodayTask('u', 'Write', DAY, 2));
    await engine.sync();
    expect(server.pushes[1].map((c) => `${c.id}:${c.deleted}`).sort()).toEqual(['t:true', 'u:false']);
    expect(server.pushes[1].find((c) => c.id === 't')?.data).toBeNull();
    expect(server.rows.get('item/t')).toMatchObject({ deleted: true, data: { title: 'Call' } });
  });

  it('gives the server a deleted item’s archive copy when it stored the tombstone without data', async () => {
    const server = new FakeServer();
    const { engine } = await device(server);
    await engine.change(newTodayTask('t', 'Call', DAY, 1));
    await engine.change(removed(item(engine, 't')));
    await engine.sync();
    expect(server.pushes.map((p) => p.map((c) => `${c.id}:${c.deleted}`))).toEqual([['t:true'], ['t:false']]);
    expect(server.rows.get('item/t')).toMatchObject({ deleted: true, data: { title: 'Call' } });
    expect(item(engine, 't').archive).toBeUndefined();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
  });

  it('sends the archive copy before the tombstone when a completion references an unsynced deleted item', async () => {
    const server = new FakeServer();
    server.checkReferences = true;
    const { engine } = await device(server);
    await engine.change(newHabit('h', 'Walk', EVERY_DAY, DAY, 1));
    await engine.change(setCompleted(item(engine, 'h'), DAY, true));
    await engine.change(removed(item(engine, 'h')));
    await engine.sync();
    expect(server.pushes).toHaveLength(3); // Rejected combined push, archive copies, tombstone.
    expect(server.pushes[1].find((c) => c.id === 'h')).toMatchObject({ deleted: false, data: { title: 'Walk' } });
    expect(server.pushes[2]).toEqual([{ entity: 'item', id: 'h', editedAt: item(engine, 'h').editedAt, deleted: true, data: null }]);
    expect(server.rows.get('item/h')).toMatchObject({ deleted: true, data: { title: 'Walk' } });
    expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
  });

  it('keeps a failed local save visible until a later save works', async () => {
    const store = new MemoryStore();
    const { engine } = await device(new FakeServer(), store);
    const write = store.write.bind(store);
    store.write = async () => { throw new Error('QuotaExceededError'); };
    await expect(engine.change(newTodayTask('t', 'Call', DAY, 1))).rejects.toThrow();
    expect(engine.getSnapshot().status.message).toMatch(/couldn’t save/);
    await engine.sync();
    expect(engine.getSnapshot().status.message).toMatch(/couldn’t save/);
    store.write = write;
    await engine.change(newTodayTask('u', 'Write', DAY, 2));
    expect(engine.getSnapshot().status.message).toBe('');
  });

  it('splits large pushes, keeping parents first across requests', async () => {
    const server = new FakeServer();
    const { engine } = await device(server, new MemoryStore(), { maxChanges: 2 });
    await engine.change(newHabit('h', 'Walk', EVERY_DAY, DAY, 1));
    await engine.change(setCompleted(item(engine, 'h'), DAY, true));
    await engine.change(newTodayTask('t', 'Call', DAY, 2));
    await engine.sync();
    expect(server.pushes.map((p) => p.map((c) => c.entity))).toEqual([['item', 'item'], ['schedule', 'completion']]);
  });
});

describe('merging pulled records', () => {
  const base: SyncRecord = { entity: 'item', id: 't', editedAt: 10, deleted: false, data: { kind: 'today', title: 'Server', originalDay: DAY } };
  const local: SyncRecord = { ...base, editedAt: 20, data: { kind: 'today', title: 'Local', originalDay: DAY } };

  it('takes the server record when nothing is pending', () => {
    expect(mergePulled(local, base, false)).toEqual({ record: base, pending: false });
  });
  it('keeps a newer unpushed local edit', () => {
    expect(mergePulled(local, base, true)).toEqual({ record: local, pending: true });
    expect(mergePulled({ ...local, editedAt: 5 }, base, true)).toEqual({ record: base, pending: false });
  });
  it('lets a delete win both ways', () => {
    const serverDelete = { ...base, deleted: true };
    expect(mergePulled(local, serverDelete, true).record.deleted).toBe(true);
    const localDelete = { ...local, editedAt: 1, deleted: true };
    expect(mergePulled(localDelete, base, true)).toEqual({ record: localDelete, pending: true });
  });
  it('restores archive data to a tombstone stored without it, and pushes it back', () => {
    const bare = { entity: 'item' as const, id: 't', editedAt: 30, deleted: true, data: null };
    expect(mergePulled(local, bare, false)).toEqual({ record: { ...bare, data: local.data, archive: true }, pending: true });
  });
});

describe('push helpers', () => {
  it('orders lists, items, subtasks, then schedules and completions', () => {
    const r = (entity: SyncRecord['entity'], id: string, data: Record<string, unknown> = {}): SyncRecord => ({ entity, id, editedAt: 1, deleted: false, data });
    const sorted = parentsFirst([r('completion', 'c'), r('item', 'sub', { parentId: 'p' }), r('schedule', 's'), r('item', 'p'), r('list', 'l')]);
    expect(sorted.map((x) => x.id)).toEqual(['l', 'p', 'sub', 'c', 's']);
  });
  it('chunks by count and by size', () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ entity: 'item' as const, id: `i${i}`, editedAt: 1, deleted: false, data: { title: 'x'.repeat(100) } }));
    expect(chunk(records, 2, 1e6).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunk(records, 500, 400).map((c) => c.length)).toEqual([2, 2, 1]);
  });
});

describe('http transport', () => {
  it('sends the web client header and JSON, and surfaces server messages', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const transport = httpTransport(async (url, init) => {
      calls.push([url, init]);
      if (init?.method === 'POST') return Response.json({ error: 'You have reached 100 lists.' }, { status: 409 });
      return Response.json({ changes: [], cursor: '7', hasMore: false, serverTime: 1 });
    });
    await expect(transport.pull('3')).resolves.toMatchObject({ cursor: '7', hasMore: false });
    expect(calls[0][0]).toBe('/api/sync/pull?cursor=3');
    expect(calls[0][1]?.headers).toMatchObject({ 'X-Astir-Client': 'web' });
    const error = await transport.push([]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncRequestError);
    expect(error).toMatchObject({ status: 409, message: 'You have reached 100 lists.' });
    expect(calls[1][1]?.body).toBe('{"changes":[]}');
  });
  it('reports network failures as status 0', async () => {
    const transport = httpTransport(async () => { throw new TypeError('Failed to fetch'); });
    await expect(transport.pull('0')).rejects.toMatchObject({ status: 0 });
  });
});

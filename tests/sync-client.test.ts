import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import worker from '../worker/index';
import { SyncEngine } from '../src/sync/engine';
import { EVERY_DAY, newHabit, newTodayTask, removed, renamed, setCompleted, todayView } from '../src/sync/daily';
import { MemoryStore } from '../src/sync/store';
import { SyncRequestError, httpTransport } from '../src/sync/transport';
import type { SyncTransport } from '../src/sync/transport';
import type { ItemData, SyncRecord } from '../src/sync/types';
import { testDatabase } from './helpers/d1';

// The client engine against the real Worker handler and migration SQL: the wire contract end to end.
const ORIGIN = 'https://astir.stonedragonmedia.com';
const SECRET = 'sync-client-test-secret-with-32-bytes!';
const MONDAY = '2026-11-16';
let store: ReturnType<typeof testDatabase>;
let env: Env;

async function session(user: string) {
  const now = Date.now();
  store.sqlite.prepare('INSERT INTO users (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, 1, ?)').run(user, `${user}@example.test`, 'unused', now);
  store.sqlite.prepare('INSERT INTO browser_sessions (id, user_id, token_version, name, created_at, last_active_at, expires_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
    .run(`session-${user}`, user, 'Test browser', now, now, now + 86_400_000);
  const jwt = await new SignJWT({ sid: `session-${user}`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setSubject(user)
    .setIssuer('astir').setAudience('astir-api').setIssuedAt().setExpirationTime('1d').sign(new TextEncoder().encode(SECRET));
  return `__Host-astir-session=${jwt}`;
}
function transportFor(cookie: string) {
  return httpTransport(async (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', cookie); headers.set('Origin', ORIGIN);
    return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }) as never, env) as unknown as Response;
  });
}
const device = (cookie: string) => SyncEngine.open(new MemoryStore(), transportFor(cookie), { syncDelayMs: false });
const item = (engine: SyncEngine, id: string) => engine.getSnapshot().records.get(`item/${id}`) as SyncRecord<ItemData>;

beforeEach(() => { store = testDatabase(); env = { DB: store.db, APP_URL: ORIGIN, JWT_SECRET: SECRET } as Env; });
afterEach(() => { store.sqlite.close(); });

describe('sync engine against the Worker', () => {
  it('syncs a day planned offline to a second device, including an archived habit', async () => {
    const cookie = await session('owner');
    const laptop = await device(cookie);
    await laptop.change(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    await laptop.change(newHabit('read', 'Read', [1, 3, 5], MONDAY, 2));
    await laptop.change(newHabit('old', 'Old habit', EVERY_DAY, MONDAY, 3));
    await laptop.change(newTodayTask('call', 'Call the bank', MONDAY, 4));
    await laptop.change(setCompleted(item(laptop, 'walk'), MONDAY, true));
    await laptop.change(setCompleted(item(laptop, 'call'), MONDAY, true));
    await laptop.change(setCompleted(item(laptop, 'old'), MONDAY, true));
    // Deleted before it ever synced, with a completion that references it.
    await laptop.change(removed(item(laptop, 'old')));
    await laptop.sync();
    expect(laptop.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });

    const phone = await device(cookie);
    await phone.sync();
    const view = todayView(phone.getSnapshot().records, MONDAY, () => MONDAY);
    expect(view.habits.map((e) => e.item.id)).toEqual(['walk', 'read']);
    expect(view.tasks.map((e) => e.item.id)).toEqual(['call']);
    expect(view.done).toBe(2);
    expect(item(phone, 'old')).toMatchObject({ deleted: true, data: { title: 'Old habit' } });
    expect(phone.getSnapshot().records.get(`completion/old:${MONDAY}`)?.data).toMatchObject({ completed: true });
  });

  it('keeps one completion when two devices check the same habit', async () => {
    const cookie = await session('owner');
    const a = await device(cookie);
    await a.change(newHabit('walk', 'Walk', EVERY_DAY, MONDAY, 1));
    await a.sync();
    const b = await device(cookie);
    await b.sync();
    await a.change(setCompleted(item(a, 'walk'), MONDAY, true));
    await b.change(setCompleted(item(b, 'walk'), MONDAY, true));
    await a.sync(); await b.sync();
    expect(Number(store.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE entity = 'completion'").get()!.n)).toBe(1);
  });

  it('keeps accounts apart', async () => {
    const mine = await device(await session('owner'));
    await mine.change(newTodayTask('call', 'Call', MONDAY, 1));
    await mine.sync();
    const theirs = await device(await session('other'));
    await theirs.sync();
    expect(theirs.getSnapshot().records.size).toBe(0);
  });

  it('keeps a rejected push local and shows the server’s message', async () => {
    const cookie = await session('owner');
    const engine = await device(cookie);
    await engine.change([{ entity: 'completion', id: 'missing:task', editedAt: 0, deleted: false, data: { itemId: 'missing', day: null, completed: true } }]);
    await engine.sync();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'rejected', message: 'Invalid record reference.', pending: 1 });
  });

  it('keeps the later offline rename from two browsers, even when it syncs first (D32)', async () => {
    const cookie = await session('owner');
    const tenAm = Date.now() - 3_600_000;
    const clocks = { a: tenAm - 60_000, b: tenAm - 60_000 };
    let online = true;
    const unreachable = () => Promise.reject(new SyncRequestError('Astir could not be reached.', 0));
    const browser = (name: 'a' | 'b') => {
      const http = transportFor(cookie);
      const transport: SyncTransport = {
        push: (changes) => online ? http.push(changes) : unreachable(),
        pull: (cursor) => online ? http.pull(cursor) : unreachable(),
      };
      return SyncEngine.open(new MemoryStore(), transport, { syncDelayMs: false, retryBaseMs: 3_600_000, now: () => clocks[name] });
    };
    const a = await browser('a');
    const b = await browser('b');
    await a.change(newTodayTask('t', 'Call the bank', MONDAY, 1));
    await a.sync(); await b.sync();

    online = false;
    clocks.a = tenAm;
    await a.change(renamed(item(a, 't'), 'Call the bank at 10:00'));
    clocks.b = tenAm + 5 * 60_000;
    await b.change(renamed(item(b, 't'), 'Call the bank at 10:05'));
    await a.sync(); await b.sync();
    expect(a.getSnapshot().status).toMatchObject({ state: 'offline', pending: 1 });
    expect(item(a, 't').data?.title).toBe('Call the bank at 10:00');

    // The later rename reaches the server first; the earlier one then arrives and loses.
    online = true;
    await b.sync(); await a.sync(); await b.sync();
    for (const engine of [a, b]) {
      expect(item(engine, 't').data?.title).toBe('Call the bank at 10:05');
      expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
      engine.close();
    }
  });

  it('shows a quiet offline state while D1 is down, keeps the change, and syncs once it is back', async () => {
    const cookie = await session('owner');
    const engine = await SyncEngine.open(new MemoryStore(), transportFor(cookie), { syncDelayMs: false, retryBaseMs: 3_600_000 });
    const db = env.DB;
    env.DB = { prepare() { throw new Error('D1_ERROR: storage unavailable'); }, batch() { throw new Error('D1_ERROR: storage unavailable'); } } as unknown as D1Database;
    await engine.change(newTodayTask('t', 'Call the bank', MONDAY, 1));
    await engine.sync();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'offline', message: '', pending: 1 });
    env.DB = db;
    await engine.sync();
    expect(engine.getSnapshot().status).toMatchObject({ state: 'synced', pending: 0 });
    engine.close();
  });
});

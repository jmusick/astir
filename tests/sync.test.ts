import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import worker from '../worker/index';
import { testDatabase } from './helpers/d1';

const ORIGIN = 'https://astir.stonedragonmedia.com';
const SECRET = 'sync-test-secret-with-at-least-32-bytes';
const NOW = Date.now();
const DAY = '2026-11-16';
type Change = { entity: string; id: string; editedAt: number; deleted: boolean; data?: Record<string, unknown> | null };
type Page = { changes: Change[]; cursor: string; hasMore: boolean; serverTime: number };
let store: ReturnType<typeof testDatabase>;
let env: Env;
let cookie: string;
let otherCookie: string;
const change = (entity: string, id: string, data: Record<string, unknown>, editedAt = NOW): Change => ({ entity, id, data, editedAt, deleted: false });
const list = (id = 'work', editedAt = NOW) => change('list', id, { title: 'Work' }, editedAt);
const today = (id = 'today', extra: Record<string, unknown> = {}, editedAt = NOW) => change('item', id, { kind: 'today', title: 'Today', originalDay: DAY, ...extra }, editedAt);
const habit = (id = 'habit', editedAt = NOW) => change('item', id, { kind: 'habit', title: 'Read', createdDay: DAY }, editedAt);
const completion = (itemId: string, day: string | null = null, completed = true, editedAt = NOW) => change('completion', `${itemId}:${day ?? 'task'}`, { itemId, day, completed }, editedAt);
const schedule = (day = DAY, weekdays = [0, 1, 2, 3, 4, 5, 6]) => change('schedule', `habit:${day}`, { itemId: 'habit', effectiveDay: day, weekdays });
const deleted = (c: Change, editedAt = NOW): Change => ({ entity: c.entity, id: c.id, editedAt, deleted: true });
async function session(user: string) {
  store.sqlite.prepare('INSERT INTO users (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, 1, ?)').run(user, `${user}@example.test`, 'unused', NOW);
  store.sqlite.prepare('INSERT INTO browser_sessions (id, user_id, token_version, name, created_at, last_active_at, expires_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
    .run(`session-${user}`, user, 'Test browser', NOW, NOW, NOW + 86_400_000);
  const jwt = await new SignJWT({ sid: `session-${user}`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setSubject(user)
    .setIssuer('astir').setAudience('astir-api').setIssuedAt().setExpirationTime('1d').sign(new TextEncoder().encode(SECRET));
  return `__Host-astir-session=${jwt}`;
}
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => worker.fetch(new Request(`${ORIGIN}/api/sync/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: ORIGIN, 'X-Astir-Client': 'web', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
}) as never, env);
const push = (changes: Change[], headers?: Record<string, string>) => request('push', { changes }, headers);
const pull = async (cursor = '0', headers?: Record<string, string>) => (await request(`pull?cursor=${cursor}`, undefined, headers)).json() as Promise<Page>;
const count = () => Number(store.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_records').get()!.n);
beforeEach(async () => {
  store = testDatabase(); env = { DB: store.db, APP_URL: ORIGIN, JWT_SECRET: SECRET } as Env;
  cookie = await session('owner'); otherCookie = await session('other');
});
afterEach(() => { store.sqlite.close(); vi.restoreAllMocks(); });

describe('sync model and conflicts', () => {
  it('accepts unordered related entities, versioned schedules, reminders, and one-level subtasks', async () => {
    const task = change('item', 'task', { kind: 'task', title: 'Ship', listId: 'work', dueDay: DAY, notes: 'Notes', reminder: `${DAY}T17:30:00.000Z` });
    const child = today('child', { parentId: 'today', reminder: '17:30' });
    expect((await push([completion('habit', DAY), schedule(), child, task, completion('task'), habit(), today(), list()])).status).toBe(200);
    expect((await push([schedule('2026-11-17', [1, 3, 5])])).status).toBe(200);
    const page = await pull(); expect(page.changes).toHaveLength(9);
    expect(page.changes.filter((c) => c.entity === 'schedule')).toHaveLength(2);
    expect(page.changes.find((c) => c.id === 'child')?.data?.parentId).toBe('today');
    expect(page.changes.find((c) => c.id === 'task')?.data?.notes).toBe('Notes');
  });
  it('uses client edit times, keeps equal-time first writers, and does not allocate revisions for retries', async () => {
    await push([list('work', NOW - 100)]);
    const page = await pull();
    await push([change('list', 'work', { title: 'Older' }, NOW - 200), today()]);
    await push([change('list', 'work', { title: 'Equal' }, NOW - 100)]);
    expect((await pull()).changes.find((c) => c.id === 'work')?.data?.title).toBe('Work');
    const fresh = change('list', 'work', { title: 'Newer' }, NOW);
    await push([fresh]); const updated = await pull(page.cursor);
    expect(updated.changes.find((c) => c.id === 'work')?.data?.title).toBe('Newer');
    await push([fresh]); expect((await pull(updated.cursor)).changes).toEqual([]);
  });
  it('clamps clocks more than five minutes ahead and returns server time', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await push([list('future', now + 300_001), list('allowed', now + 300_000)]);
    const page = await pull(); expect(page.serverTime).toBe(now);
    expect(page.changes.find((c) => c.id === 'future')?.editedAt).toBe(now);
    expect(page.changes.find((c) => c.id === 'allowed')?.editedAt).toBe(now + 300_000);
  });
  it('makes older deletes win, preserves archived data, and blocks resurrection including unseen deletes', async () => {
    await push([habit(), schedule(), completion('habit', DAY)]);
    await push([deleted(habit(), NOW - 1000), deleted(today('unseen'))]);
    await push([habit('habit', NOW + 1000), today('unseen', {}, NOW + 1000)]);
    const page = await pull();
    const archived = page.changes.find((c) => c.id === 'habit')!;
    expect(archived.deleted).toBe(true); expect(archived.data?.title).toBe('Read');
    expect(page.changes.find((c) => c.id === 'unseen')).toMatchObject({ deleted: true, data: { title: 'Today' } });
    expect(page.changes.find((c) => c.entity === 'completion')?.data?.completed).toBe(true);
    // An offline completion still arrives after the parent was archived.
    expect((await push([completion('habit', '2026-11-17')])).status).toBe(200);
  });
  it('recovers archive metadata when a delete arrives before creation, without resurrecting the item', async () => {
    await push([deleted(habit())]);
    expect((await pull()).changes[0]).toMatchObject({ deleted: true, data: null });
    expect((await push([completion('habit', DAY), habit(), schedule()])).status).toBe(200);
    expect((await pull()).changes.find((c) => c.id === 'habit')).toMatchObject({ deleted: true, data: { title: 'Read' } });
  });
  it('deduplicates two devices checking the same habit/day and keeps completion edits independent', async () => {
    await push([habit(), today()]);
    const check = completion('habit', DAY);
    const results = await Promise.all([push([check]), push([check])]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    await push([completion('habit', DAY, false, NOW + 1), habit('habit', NOW + 2), completion('today')]);
    const checks = (await pull()).changes.filter((c) => c.entity === 'completion');
    expect(checks).toHaveLength(2); expect(checks.find((c) => c.id === check.id)?.data?.completed).toBe(false);
    expect((await push([{ ...check, id: 'arbitrary-device-id' }])).status).toBe(400);
  });
  it('rolls back a whole push, including revisions, when any reference is invalid', async () => {
    await push([today()]); const before = await pull();
    expect((await push([list(), today('bad', { parentId: 'missing' })])).status).toBe(400);
    expect(count()).toBe(1); expect((await pull(before.cursor)).changes).toEqual([]);
    expect(store.sqlite.prepare('SELECT revision FROM sync_clock').get()!.revision).toBe(Number(before.cursor));
  });
  it('rejects deep subtasks, cross-list parents, wrong completion days and changes to item identity', async () => {
    await push([today(), today('child', { parentId: 'today' }), habit(), list()]);
    for (const c of [today('grandchild', { parentId: 'child' }), completion('today', DAY), completion('habit'),
      schedule('2026-11-15'), today('today', { parentId: 'child' }, NOW + 10),
      change('item', 'bad-task', { kind: 'task', title: 'Bad', listId: 'work', parentId: 'today' })]) {
      expect((await push([c])).status, JSON.stringify(c)).toBe(400);
    }
    expect(count()).toBe(4);
  });
});

describe('pull cursors and authentication', () => {
  it('paginates by server revisions even for old client timestamps and same-millisecond edits', async () => {
    expect((await push(Array.from({ length: 205 }, (_, i) => today(`item-${i}`, {}, 1)))).status).toBe(200);
    const first = await pull(); expect(first.changes).toHaveLength(100); expect(first.hasMore).toBe(true);
    // A record from the already-delivered page moves forward; another unseen record is deleted.
    await push([today('item-0', { title: 'Changed' }, 2), deleted(today('item-204'), 0)]);
    const second = await pull(first.cursor); const third = await pull(second.cursor);
    expect(second.changes).toHaveLength(100); expect(third.hasMore).toBe(false);
    const all = [...first.changes, ...second.changes, ...third.changes];
    expect(new Set(all.map((c) => c.id)).size).toBe(205);
    expect(all.findLast((c) => c.id === 'item-0')?.data?.title).toBe('Changed');
    expect(all.findLast((c) => c.id === 'item-204')?.deleted).toBe(true);
    expect((await pull(third.cursor)).cursor).toBe(third.cursor);
  });
  it('requires real revocable browser sessions on every sync endpoint', async () => {
    for (const path of ['pull', 'push']) {
      expect((await request(path, path === 'push' ? { changes: [] } : undefined, { Cookie: '' })).status).toBe(401);
    }
    store.sqlite.exec("UPDATE browser_sessions SET revoked_at = 1 WHERE user_id = 'owner'");
    expect((await push([list()])).status).toBe(401);
    store.sqlite.exec("UPDATE browser_sessions SET revoked_at = NULL; UPDATE users SET token_version = 1 WHERE id = 'owner'");
    expect((await request('pull')).status).toBe(401);
  });
  it('scopes keys, references, pulls and mutations to the authenticated account', async () => {
    await push([list(), today()]);
    expect((await pull('0', { Cookie: otherCookie })).changes).toEqual([]);
    expect((await push([completion('today')], { Cookie: otherCookie })).status).toBe(400);
    expect((await push([change('item', 'task', { kind: 'task', title: 'Bad', listId: 'work' })], { Cookie: otherCookie })).status).toBe(400);
    expect((await push([change('list', 'work', { title: 'Other' })], { Cookie: otherCookie })).status).toBe(200);
    await push([deleted(list())], { Cookie: otherCookie });
    expect((await pull()).changes.find((c) => c.id === 'work')?.deleted).toBe(false);
    expect((await push([{ ...list(), data: { title: 'X', user_id: 'owner' } }], { Cookie: otherCookie })).status).toBe(400);
  });
  it('enforces the web header and origin and hardens sync error responses', async () => {
    expect((await push([list()], { Origin: 'https://evil.example' })).status).toBe(403);
    const response = await request('pull', undefined, { 'X-Astir-Client': '' });
    expect(response.status).toBe(403); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
  it('cascades account deletion but retains records and history when individual items are deleted', async () => {
    await push([habit(), schedule(), completion('habit', DAY)]);
    await push([deleted(habit())]); expect(count()).toBe(3);
    store.sqlite.exec("DELETE FROM users WHERE id = 'owner'"); expect(count()).toBe(0);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_quota_checks').get()!.n).toBe(0);
  });
});

describe('limits and malformed input', () => {
  it('enforces the list limit atomically, allows final-state replacement and survives concurrent pushes', async () => {
    await push(Array.from({ length: 99 }, (_, i) => list(`list-${i}`)));
    const responses = await Promise.all([push([list('last-a')]), push([list('last-b')])]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]); expect(count()).toBe(100);
    const full = await push([list('overflow'), today()]); expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'You have reached 100 lists.' }); expect(count()).toBe(100);
    expect((await push([list('replacement'), deleted(list('list-0'))])).status).toBe(200);
  });
  it('limits active subtasks without removing completed records or history', async () => {
    await push([today(), ...Array.from({ length: 100 }, (_, i) => today(`child-${i}`, { parentId: 'today' }))]);
    expect((await push([today('overflow', { parentId: 'today' })])).status).toBe(409);
    expect((await push([deleted(today('child-0')), today('replacement', { parentId: 'today' })])).status).toBe(200);
  });
  it('counts open items including habits and subtasks, and checks unchecking at the limit', async () => {
    // Populate the real tables/SQL in one call, avoiding 20 HTTP pushes for the boundary fixture.
    store.sqlite.prepare(`INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data)
      SELECT 'owner', 'item', 'seed-' || value, 1, 0,
        json_object('kind', 'today', 'title', 'Seed', 'originalDay', ?, 'parentId', NULL, 'listId', NULL)
      FROM json_each(?)`).run(DAY, JSON.stringify(Array.from({ length: 10_000 }, (_, i) => i)));
    expect((await push([today()])).status).toBe(409); expect(count()).toBe(10_000);
    expect((await push([today(), completion('seed-0')])).status).toBe(200);
    expect((await push([completion('seed-0', null, false, NOW + 1)])).status).toBe(409);
    expect((await push([habit()])).status).toBe(409);
    expect((await push([deleted(today('seed-1')), habit()])).status).toBe(200);
    expect((await pull()).changes.length).toBe(100);
    expect(store.sqlite.prepare("SELECT json_extract(data, '$.completed') AS done FROM sync_records WHERE entity = 'completion'").get()!.done).toBe(1);
  });
  it('bounds JSON, change count, text and streamed bytes even without Content-Length', async () => {
    expect((await request('push', '{')).status).toBe(400);
    expect((await request('push', [], { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await request('push', { changes: 'bad' })).status).toBe(400);
    expect((await push(Array.from({ length: 501 }, (_, i) => today(`item-${i}`)))).status).toBe(413);
    expect((await request('push', ' '.repeat(1_048_577))).status).toBe(413);
    expect((await push([today('x', { title: 'a'.repeat(501) })])).status).toBe(400);
    expect((await push([today('x', { notes: 'a'.repeat(20_001) })])).status).toBe(400);
    expect((await push([today('x', { title: 'a'.repeat(500), notes: 'a'.repeat(20_000) })])).status).toBe(200);
  });
  it('rejects bad days, time values, kind-specific fields, duplicate records and cursors', async () => {
    for (const c of [today('x', { originalDay: '2026-02-30' }), today('x', { originalDay: '2026-99-99' }),
      today('x', { reminder: '24:00' }), today('x', { dueDay: DAY }), today('x', { title: '  ' }),
      today('x', { kind: ['today'] }), { ...today(), entity: ['item'] },
      { ...today(), editedAt: -1 }, { ...today(), deleted: undefined }, schedule(DAY, [1, 1]),
      change('item', 'h', { kind: 'habit', title: 'H', createdDay: DAY, parentId: 'x' })]) {
      expect((await push([c as Change])).status, JSON.stringify(c)).toBe(400);
    }
    expect((await push([today(), today()])).status).toBe(400);
    for (const cursor of ['-1', 'NaN', '1.5', '9007199254740992']) expect((await request(`pull?cursor=${cursor}`)).status).toBe(400);
    expect(count()).toBe(0);
  });
});

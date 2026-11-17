import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import worker from '../worker/index';
import { deviceName } from '../worker/auth';
import { testDatabase } from './helpers/d1';

const ORIGIN = 'https://astir.stonedragonmedia.com';
const SECRET = 'account-test-secret-with-at-least-32-bytes';
const PASSWORD = 'a-unique-astir-test-password';
const NOW = Date.now();
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let passwordHash: string;
let store: ReturnType<typeof testDatabase>;
let env: Env;

async function sessionCookie(user: string, sid: string, name = CHROME, expiresIn = '1d') {
  store.sqlite.prepare('INSERT INTO browser_sessions (id, user_id, token_version, name, created_at, last_active_at, expires_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
    .run(sid, user, name, NOW, NOW, NOW + 86_400_000);
  const jwt = await new SignJWT({ sid, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setSubject(user)
    .setIssuer('astir').setAudience('astir-api').setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(SECRET));
  return `__Host-astir-session=${jwt}`;
}
const addUser = (id: string) => store.sqlite.prepare('INSERT INTO users (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, 1, ?)')
  .run(id, `${id}@example.test`, passwordHash, NOW);
const call = (path: string, cookie: string, body?: unknown) => worker.fetch(new Request(`${ORIGIN}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Origin: ORIGIN, 'X-Astir-Client': 'web', 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': '192.0.2.1' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}) as never, env);
const count = (table: string) => Number(store.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

beforeAll(async () => { passwordHash = await bcrypt.hash(PASSWORD, 10); });
beforeEach(() => {
  store = testDatabase();
  env = { DB: store.db, APP_URL: ORIGIN, JWT_SECRET: SECRET } as Env;
  addUser('owner'); addUser('other');
});
afterEach(() => { store.sqlite.close(); vi.restoreAllMocks(); });

describe('signed-in devices', () => {
  it('lists this account’s live browser sessions with friendly names and marks this one', async () => {
    const cookie = await sessionCookie('owner', 'here');
    await sessionCookie('owner', 'phone', SAFARI);
    await sessionCookie('other', 'theirs');
    store.sqlite.prepare('INSERT INTO browser_sessions (id, user_id, token_version, name, created_at, last_active_at, expires_at, revoked_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)')
      .run('gone', 'owner', CHROME, NOW, NOW, NOW + 86_400_000, NOW);
    const response = await call('auth/devices', cookie);
    expect(response.status).toBe(200);
    const { devices } = await response.json() as { devices: { id: string; name: string; current: boolean; kind: string }[] };
    expect(devices.map((d) => d.id).sort()).toEqual(['here', 'phone']);
    expect(devices.find((d) => d.id === 'here')).toMatchObject({ name: 'Chrome on Windows', current: true, kind: 'browser' });
    expect(devices.find((d) => d.id === 'phone')).toMatchObject({ name: 'Safari on iOS', current: false });
  });

  it('revokes another device, which then fails to sync, but never this one or another account’s', async () => {
    const cookie = await sessionCookie('owner', 'here');
    const phone = await sessionCookie('owner', 'phone', SAFARI);
    const theirs = await sessionCookie('other', 'theirs');
    expect((await call('auth/devices/revoke', cookie, { id: 'here' })).status).toBe(400);
    expect((await call('auth/devices/revoke', cookie, { id: 'theirs' })).status).toBe(404);
    expect((await call('sync/pull?cursor=0', theirs)).status).toBe(200);
    expect((await call('auth/devices/revoke', cookie, { id: 'phone' })).status).toBe(200);
    const refused = await call('sync/pull?cursor=0', phone);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'Please sign in.' });
    expect((await call('sync/pull?cursor=0', cookie)).status).toBe(200);
  });

  it('names devices from their user agent', () => {
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140 Safari/537.36 Edg/140')).toBe('Edge on Windows');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on macOS');
    expect(deviceName('Web browser')).toBe('A browser');
  });
});

describe('account deletion', () => {
  it('needs the password and the confirmation word', async () => {
    const cookie = await sessionCookie('owner', 'here');
    expect((await call('auth/delete-account', cookie, { password: PASSWORD })).status).toBe(400);
    expect((await call('auth/delete-account', cookie, { password: 'wrong-password', confirmation: 'DELETE' })).status).toBe(401);
    expect(count('users')).toBe(2);
  });

  it('removes everything at once, and other devices learn the account is gone', async () => {
    const cookie = await sessionCookie('owner', 'here');
    const phone = await sessionCookie('owner', 'phone', SAFARI);
    const theirs = await sessionCookie('other', 'theirs');
    const push = (c: string, id: string) => call('sync/push', c, { changes: [{ entity: 'list', id, editedAt: NOW, deleted: false, data: { title: 'Work' } }] });
    expect((await push(cookie, 'mine')).status).toBe(200);
    expect((await push(theirs, 'yours')).status).toBe(200);
    store.sqlite.prepare('INSERT INTO auth_events (event_type, email, ip, created_at) VALUES (?, ?, ?, ?)').run('login_failed', 'owner@example.test', '192.0.2.1', NOW);

    const response = await call('auth/delete-account', cookie, { password: PASSWORD, confirmation: 'DELETE' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(store.sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'owner'").get()!.n).toBe(0);
    expect(store.sqlite.prepare("SELECT COUNT(*) AS n FROM browser_sessions WHERE user_id = 'owner'").get()!.n).toBe(0);
    expect(store.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE user_id = 'owner'").get()!.n).toBe(0);
    expect(store.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE email = 'owner@example.test'").get()!.n).toBe(0);
    // The other account is untouched.
    expect(store.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE user_id = 'other'").get()!.n).toBe(1);

    const sync = await call('sync/pull?cursor=0', phone);
    expect(sync.status).toBe(401);
    expect(await sync.json()).toMatchObject({ reason: 'account-deleted' });
    expect(await (await call('auth/me', phone)).json()).toMatchObject({ reason: 'account-deleted' });
  });

  it('reports a deleted account even once the session token has expired', async () => {
    const stale = await sessionCookie('owner', 'old', CHROME, '1s');
    store.sqlite.prepare("DELETE FROM users WHERE id = 'owner'").run();
    vi.useFakeTimers({ now: NOW + 10 * 86_400_000, toFake: ['Date'] });
    try {
      expect(await (await call('auth/me', stale)).json()).toMatchObject({ reason: 'account-deleted' });
    } finally { vi.useRealTimers(); }
  });

  it('never reports deletion for a token this server didn’t sign', async () => {
    store.sqlite.prepare("DELETE FROM users WHERE id = 'owner'").run();
    const forged = await new SignJWT({ sid: 'x', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setSubject('owner')
      .setIssuer('astir').setAudience('astir-api').setIssuedAt().setExpirationTime('1d').sign(new TextEncoder().encode('another-secret-with-at-least-32-bytes!'));
    expect(await (await call('auth/me', `__Host-astir-session=${forged}`)).json()).toEqual({ error: 'Please sign in.' });
  });
});

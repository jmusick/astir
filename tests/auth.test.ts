import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import worker from '../worker/index';
import { newPasswordError } from '../src/passwordPolicy';
import { testDatabase } from './helpers/d1';

const ORIGIN = 'https://astir.stonedragonmedia.com';
const PASSWORD = 'a-unique-astir-test-password';
let passwordHash: string;
let store: ReturnType<typeof testDatabase>;
let env: Env;
let sent: { to: string; text: string; subject: string }[];
let failEmail = false;
let captcha: Record<string, unknown> | undefined;
let pwned = '';
const request = (path: string, body?: Record<string, unknown>, options: { cookie?: string; headers?: Record<string, string>; base?: string; waitUntil?: (task: Promise<unknown>) => void } = {}) => {
  const base = options.base || ORIGIN;
  return worker.fetch(new Request(`${base}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: base, 'X-Astir-Client': 'web', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1',
      ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as never, env, options.waitUntil ? { waitUntil: options.waitUntil } : undefined);
};
const login = (email = 'owner@example.test', password = PASSWORD) => request('login', { email, password, turnstileToken: 'login' });
const tokenIn = (mail = sent.at(-1)) => new URL(mail!.text.match(/https?:\/\/\S+\?token=[a-f0-9]+/)![0]).searchParams.get('token')!;
const cookieIn = (response: Response) => response.headers.get('Set-Cookie')!.split(';')[0];
const seed = (verified = 1) => store.sqlite.prepare('INSERT INTO users (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)')
  .run('owner-id', 'owner@example.test', passwordHash, verified, Date.now());
const resetLink = async () => { await request('forgot-password', { email: 'owner@example.test' }); return tokenIn(); };

beforeAll(async () => { passwordHash = await bcrypt.hash(PASSWORD, 10); });
beforeEach(() => {
  store = testDatabase(); sent = []; failEmail = false; captcha = undefined; pwned = '';
  env = { DB: store.db, APP_URL: ORIGIN, JWT_SECRET: 'test-only-secret-with-at-least-32-bytes',
    TURNSTILE_SECRET_KEY: 'test-fixture-real-format', CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account', EMAIL_FROM: 'astir@example.test' } as Env;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('siteverify')) return Response.json(captcha || { success: true, hostname: new URL(ORIGIN).hostname, action: JSON.parse(init.body as string).response });
    if (url.includes('pwnedpasswords')) return new Response(pwned);
    if (url.includes('/email/sending/send')) {
      if (failEmail) return Response.json({ success: false }, { status: 500 });
      sent.push(JSON.parse(init.body as string));
      return Response.json({ success: true });
    }
    throw new Error('Unexpected upstream');
  }));
});
afterEach(() => { store.sqlite.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('registration and verification', () => {
  it('verifies an address before login and never stores raw email tokens or passwords', async () => {
    const response = await request('register', { email: ' Owner@Example.Test ', password: PASSWORD, turnstileToken: 'register' });
    expect(response.status).toBe(201);
    const user = store.sqlite.prepare('SELECT * FROM users').get()!;
    expect(user.email).toBe('owner@example.test'); expect(user.password_hash).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, user.password_hash as string)).toBe(true);
    expect((await login()).status).toBe(403);
    const token = tokenIn();
    expect(store.sqlite.prepare('SELECT token_hash FROM email_tokens').get()!.token_hash).not.toBe(token);
    const verified = await request('verify-email', { token });
    expect(verified.status).toBe(200); expect(verified.headers.get('Set-Cookie')).toBeNull();
    expect((await request('verify-email', { token })).status).toBe(400);
    expect((await login()).status).toBe(200);
  });
  it('returns the same registration response for a registered address without replacing its password', async () => {
    const first = await request('register', { email: 'owner@example.test', password: PASSWORD, turnstileToken: 'register' });
    const second = await request('register', { email: 'owner@example.test', password: 'another-unique-password', turnstileToken: 'register' });
    expect(first.status).toBe(second.status); expect(await first.json()).toEqual(await second.json());
    const row = store.sqlite.prepare('SELECT password_hash FROM users').get()!;
    expect(await bcrypt.compare(PASSWORD, row.password_hash as string)).toBe(true);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
  });
  it('keeps new users recoverable after a provider failure', async () => {
    failEmail = true;
    expect((await request('register', { email: 'owner@example.test', password: PASSWORD, turnstileToken: 'register' })).status).toBe(201);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM email_tokens').get()!.n).toBe(0);
    failEmail = false;
    expect((await request('resend-verification', { email: 'owner@example.test' })).status).toBe(200);
    expect((await request('verify-email', { token: tokenIn() })).status).toBe(200);
  });
  it('rejects expired verification links and allows one simultaneous claim', async () => {
    seed(0); await request('resend-verification', { email: 'owner@example.test' });
    const token = tokenIn();
    store.sqlite.prepare('UPDATE email_tokens SET expires_at = ?').run(Date.now() - 1);
    expect((await request('verify-email', { token })).status).toBe(400);
    store.sqlite.prepare('UPDATE email_tokens SET expires_at = ?').run(Date.now() + 60_000);
    const responses = await Promise.all([request('verify-email', { token }), request('verify-email', { token })]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  });
  it('does not wait for address-dependent emails before responding in a Worker', async () => {
    seed(0);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.includes('/email/sending/send')) await blocked;
      return originalFetch(url, init);
    });
    const tasks: Promise<unknown>[] = [];
    const response = await request('resend-verification', { email: 'owner@example.test' }, { waitUntil: (task) => tasks.push(task) });
    expect(response.status).toBe(200); expect(tasks).toHaveLength(1); expect(sent).toHaveLength(0);
    release(); await Promise.all(tasks); expect(sent).toHaveLength(1);
  });
});

describe('cookie sessions', () => {
  it('uses a server-side, seven-day HttpOnly host cookie; logout revokes a copied cookie', async () => {
    seed(); const response = await login();
    expect(response.status).toBe(200);
    const header = response.headers.get('Set-Cookie')!;
    expect(header).toContain('__Host-astir-session='); expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure'); expect(header).toContain('SameSite=Lax'); expect(header).toContain('Max-Age=604800');
    expect(await response.json()).not.toHaveProperty('token');
    const cookie = cookieIn(response);
    expect((await request('me', undefined, { cookie })).status).toBe(200);
    const out = await request('logout', {}, { cookie });
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await request('me', undefined, { cookie })).status).toBe(401);
    expect(store.sqlite.prepare('SELECT revoked_at, last_active_at, name FROM browser_sessions').get()!.revoked_at).toBeTruthy();
  });
  it('rejects revoked, missing, expired and version-mismatched server sessions', async () => {
    seed();
    for (const sql of ['UPDATE browser_sessions SET revoked_at = 1', 'UPDATE browser_sessions SET expires_at = 1', 'UPDATE users SET token_version = token_version + 1', 'DELETE FROM browser_sessions']) {
      const cookie = cookieIn(await login()); store.sqlite.exec(sql);
      expect((await request('me', undefined, { cookie })).status).toBe(401);
    }
    expect((await request('me')).status).toBe(401);
  });
  it('refuses bearer authentication, tampered cookies and malformed signed claims', async () => {
    seed(); const cookie = cookieIn(await login());
    expect((await request('me', undefined, { headers: { Authorization: `Bearer ${cookie.split('=')[1]}` } })).status).toBe(401);
    expect((await request('me', undefined, { cookie: cookie + 'x' })).status).toBe(401);
    const sid = store.sqlite.prepare('SELECT id FROM browser_sessions').get()!.id;
    for (const claims of [{ sid, tv: 0 }, { sid, tv: 0, iat: 9999999999, exp: 99999999999 }, { sid, tv: 0, iat: 1, exp: 99999999999 }]) {
      const jwt = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject('owner-id').setIssuer('astir').setAudience('astir-api')
        .sign(new TextEncoder().encode(env.JWT_SECRET!));
      expect((await request('me', undefined, { cookie: `__Host-astir-session=${jwt}` })).status).toBe(401);
    }
  });
  it('uses an insecure cookie only for HTTP loopback', async () => {
    seed(); const response = await request('login', { email: 'owner@example.test', password: PASSWORD, turnstileToken: 'login' }, { base: 'http://localhost:5173' });
    expect(response.headers.get('Set-Cookie')).toMatch(/^astir-session=/);
    expect(response.headers.get('Set-Cookie')).not.toContain('; Secure');
  });
  it('accepts the official dummy response only with a local test secret', async () => {
    seed();
    captcha = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
    const body = { email: 'owner@example.test', password: PASSWORD, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' };
    expect((await request('login', body, { base: 'http://localhost:5173' })).status).toBe(400);
    env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    expect((await request('login', body, { base: 'http://localhost:5173' })).status).toBe(200);
    expect((await request('login', body)).status).toBe(503);
    captcha = { success: false };
    expect((await request('login', body, { base: 'http://localhost:5173' })).status).toBe(400);
  });
});

describe('password recovery', () => {
  it('makes reset requests indistinguishable for known and unknown addresses', async () => {
    seed();
    const known = await request('forgot-password', { email: 'owner@example.test' });
    const unknown = await request('forgot-password', { email: 'unknown@example.test' });
    expect(known.status).toBe(unknown.status); expect(await known.json()).toEqual(await unknown.json()); expect(sent).toHaveLength(1);
  });
  it('resets once, clears lockout and invalidates every old browser session', async () => {
    seed(); const cookie = cookieIn(await login()); const token = await resetLink();
    store.sqlite.prepare('INSERT INTO login_attempts VALUES (?, 8, ?, ?)').run('owner@example.test', Date.now() + 900_000, Date.now());
    const response = await request('reset-password', { token, password: 'replacement-astir-password' });
    expect(response.status).toBe(200); expect(response.headers.get('Set-Cookie')).toBeNull();
    expect((await request('me', undefined, { cookie })).status).toBe(401);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM login_attempts').get()!.n).toBe(0);
    expect((await request('reset-password', { token, password: 'another-password' })).status).toBe(400);
    expect((await login('owner@example.test', 'replacement-astir-password')).status).toBe(200);
    expect((await login()).status).toBe(401);
  });
  it('allows only one concurrent reset, without revoking a later session on replay', async () => {
    seed(); const token = await resetLink();
    const results = await Promise.all(['one', 'two'].map((suffix) => request('reset-password', { token, password: `replacement-password-${suffix}` })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = results[0].status === 200 ? 'one' : 'two';
    const cookie = cookieIn(await login('owner@example.test', `replacement-password-${winner}`));
    expect((await request('reset-password', { token, password: 'replay-password' })).status).toBe(400);
    expect((await request('me', undefined, { cookie })).status).toBe(200);
  });
  it('invalidates rotated links and refuses expired links', async () => {
    seed(); const old = await resetLink();
    store.sqlite.exec('DELETE FROM auth_events'); const fresh = await resetLink();
    expect((await request('reset-password', { token: old, password: PASSWORD })).status).toBe(400);
    store.sqlite.prepare('UPDATE email_tokens SET expires_at = ?').run(Date.now() - 1);
    expect((await request('reset-password', { token: fresh, password: PASSWORD })).status).toBe(400);
  });
});

describe('abuse controls and validation', () => {
  it.each(['owner@example.test', 'unknown@example.test'])('locks %s on the eighth failure and releases it after 15 minutes', async (email) => {
    seed();
    for (let n = 1; n <= 8; n++) expect((await login(email, 'wrong-password')).status).toBe(n < 8 ? 401 : 429);
    expect((await login(email)).status).toBe(429);
    const later = Date.now() + 16 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect((await login(email, 'wrong-password')).status).toBe(401);
  });
  it('keeps concurrent failures atomic', async () => {
    seed();
    const results = await Promise.all(Array.from({ length: 8 }, () => login('owner@example.test', 'wrong')));
    expect(results.filter((r) => r.status === 429)).toHaveLength(1);
    expect(store.sqlite.prepare('SELECT failed_attempts FROM login_attempts').get()!.failed_attempts).toBe(8);
  });
  it('refuses a correct password when another request locks the address during bcrypt', async () => {
    seed();
    let release!: (matches: boolean) => void;
    const gate = new Promise<boolean>((resolve) => { release = resolve; });
    const compare = vi.spyOn(bcrypt, 'compare').mockImplementationOnce(() => gate);
    const pending = login();
    await vi.waitFor(() => expect(compare).toHaveBeenCalled());
    store.sqlite.prepare('INSERT INTO login_attempts VALUES (?, 8, ?, ?)').run('owner@example.test', Date.now() + 900_000, Date.now());
    release(true);
    expect((await pending).status).toBe(429);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get()!.n).toBe(0);
  });
  it('refuses an old password if recovery finishes during login', async () => {
    seed();
    let release!: (matches: boolean) => void;
    const gate = new Promise<boolean>((resolve) => { release = resolve; });
    const compare = vi.spyOn(bcrypt, 'compare').mockImplementationOnce(() => gate);
    const pending = login();
    await vi.waitFor(() => expect(compare).toHaveBeenCalled());
    store.sqlite.exec('UPDATE users SET token_version = token_version + 1');
    release(true);
    expect((await pending).status).toBe(409);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get()!.n).toBe(0);
  });
  it('does not partially consume a recovery link when a transaction fails', async () => {
    seed(); const cookie = cookieIn(await login()); const token = await resetLink();
    store.sqlite.exec("CREATE TRIGGER refuse_revoke BEFORE UPDATE OF revoked_at ON browser_sessions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect((await request('reset-password', { token, password: 'replacement-password' })).status).toBe(503);
    expect(store.sqlite.prepare('SELECT used_at FROM email_tokens').get()!.used_at).toBeNull();
    expect(store.sqlite.prepare('SELECT token_version FROM users').get()!.token_version).toBe(0);
    expect((await request('me', undefined, { cookie })).status).toBe(200);
  });
  it('throttles reset and verification resends before user lookup, even for nonexistent addresses', async () => {
    for (const path of ['forgot-password', 'resend-verification']) {
      for (const email of ['owner@example.test', 'unknown@example.test']) {
        expect((await request(path, { email })).status).toBe(200);
        expect((await request(path, { email })).status).toBe(429);
      }
    }
  });
  it('caps registration and login failures per IP in code', async () => {
    const insert = store.sqlite.prepare('INSERT INTO auth_events (event_type, email, ip, created_at) VALUES (?, ?, ?, ?)');
    for (let n = 0; n < 20; n++) insert.run(n < 10 ? 'register_attempt' : 'login_failed', null, '192.0.2.1', Date.now());
    expect((await request('register', { email: 'x@example.test', password: PASSWORD, turnstileToken: 'register' })).status).toBe(429);
    for (let n = 0; n < 10; n++) insert.run('login_failed', null, '192.0.2.1', Date.now());
    expect((await login()).status).toBe(429);
  });
  it('checks Turnstile success, action and hostname and fails closed without credentials', async () => {
    seed();
    for (const result of [{ success: false }, { success: true, action: 'register', hostname: new URL(ORIGIN).hostname }, { success: true, action: 'login', hostname: 'evil.example' }]) {
      captcha = result; expect((await login()).status).toBe(400);
    }
    captcha = undefined; env.TURNSTILE_SECRET_KEY = undefined; expect((await login()).status).toBe(503);
    env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'; expect((await login()).status).toBe(503);
    env.JWT_SECRET = undefined; expect((await request('me')).status).toBe(503);
  });
  it('refuses missing or foreign origins and absent client headers', async () => {
    const attempts: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }, { 'X-Astir-Client': '' }];
    for (const headers of attempts) {
      expect((await request('logout', {}, { headers })).status).toBe(403);
    }
  });
  it('returns a consistent 503 for email routes without sending configuration', async () => {
    seed(); env.CLOUDFLARE_API_TOKEN = undefined;
    for (const path of ['register', 'forgot-password', 'resend-verification']) {
      for (const email of ['owner@example.test', 'unknown@example.test']) {
        expect((await request(path, { email, password: PASSWORD, turnstileToken: 'register' })).status).toBe(503);
      }
    }
  });
  it('bounds JSON input and handles malformed payloads', async () => {
    for (const [body, status] of [['{', 400], ['[]', 400], ['null', 400], ['x'.repeat(17_000), 413]] as const) {
      const response = await worker.fetch(new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { Origin: ORIGIN, 'X-Astir-Client': 'web', 'Content-Type': 'application/json' }, body }) as never, env);
      expect(response.status).toBe(status);
    }
    expect((await request('login', { email: [], password: PASSWORD })).status).toBe(400);
    expect((await request('login', { email: 'a@b.test', password: {} })).status).toBe(400);
  });
  it('bounds new passwords by code points and bytes, and refuses breached passwords', async () => {
    expect(newPasswordError('😀'.repeat(7))).toBeTruthy();
    expect(newPasswordError('😀'.repeat(8))).toBeNull();
    expect(newPasswordError('😀'.repeat(19))).toContain('72');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(PASSWORD)))).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    pwned = `${digest.slice(5)}:5`;
    expect((await request('register', { email: 'x@example.test', password: PASSWORD, turnstileToken: 'register' })).status).toBe(400);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(0);
  });
  it('keeps security headers on authentication errors', async () => {
    const response = await login();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

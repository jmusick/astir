import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { newPasswordError } from '../src/passwordPolicy';
import { isAllowedOrigin } from './headers';

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUER = 'astir';
const AUDIENCE = 'astir-api';
// A real cost-10 hash gives unknown addresses the same bcrypt work as known accounts.
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
const ACCEPTED = { message: 'Check your email for the next step. If you already have an account, sign in or reset your password.' };
const LINK_ACCEPTED = { message: 'If that address has an eligible account, an email has been sent. Check your inbox and spam folder.' };
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
class AuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type User = { id: string; email: string; password_hash: string; email_verified: number; token_version: number };
type EmailToken = { token_hash: string; user_id: string; purpose: 'verify' | 'reset'; expires_at: number; used_at: number | null };
type Background = Pick<ExecutionContext, 'waitUntil'> | undefined;

const localRequest = (request: Request) => {
  const url = new URL(request.url);
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
};
const cookieName = (request: Request) => localRequest(request) ? 'astir-session' : '__Host-astir-session';
const cookie = (request: Request, value: string, age = SESSION_SECONDS) =>
  `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${localRequest(request) ? '' : '; Secure'}`;
const getCookie = (request: Request) => {
  const prefix = `${cookieName(request)}=`;
  return request.headers.get('Cookie')?.split(';').map((v) => v.trim()).find((v) => v.startsWith(prefix))?.slice(prefix.length);
};
const signingKey = (env: Env) => {
  if (!env.JWT_SECRET || new TextEncoder().encode(env.JWT_SECRET).length < 32) {
    throw new AuthError('Authentication is not configured. Please try again later.', 503);
  }
  return new TextEncoder().encode(env.JWT_SECRET);
};
const emailReady = (env: Env) => {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.EMAIL_FROM) {
    throw new AuthError('Email delivery is not configured. Please try again later.', 503);
  }
};
const emailAddress = (value: unknown) => {
  if (typeof value !== 'string') throw new AuthError('Enter a valid email address.', 400);
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('Enter a valid email address.', 400);
  return email;
};
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AuthError('Send JSON.', 415);
  // Bound the streamed body too: Content-Length alone is caller controlled.
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('Send a JSON object.', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new AuthError('Request is too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AuthError('Send a JSON object.', 400); }
}
async function upstream(url: string, init: RequestInit, timeout: number): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new AuthError('A verification service is temporarily unavailable. Please try again.', 502); }
}
async function turnstile(request: Request, env: Env, token: unknown, action: string) {
  if (!env.TURNSTILE_SECRET_KEY) throw new AuthError('Sign-in verification is not configured.', 503);
  // Cloudflare test secrets must never validate a deployed HTTPS request.
  if (!localRequest(request) && /^[123]x0/.test(env.TURNSTILE_SECRET_KEY)) throw new AuthError('Sign-in verification is not configured.', 503);
  if (typeof token !== 'string' || !token || token.length > 2048) throw new AuthError('Complete the verification challenge.', 400);
  const response = await upstream('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
  }, 5000);
  if (!response.ok) throw new AuthError('Could not verify the challenge. Please try again.', 502);
  const result = await response.json().catch(() => null) as { success?: boolean; hostname?: string; action?: string } | null;
  if (!result) throw new AuthError('Could not verify the challenge. Please try again.', 502);
  const hosts = [new URL(request.url).hostname, new URL(env.APP_URL).hostname];
  // Cloudflare's public dummy secrets return neither the widget action nor its real host.
  // Only HTTP loopback with those secrets may skip the action check; success is still required.
  const localTestKey = localRequest(request) && /^[123]x0+AA$/.test(env.TURNSTILE_SECRET_KEY);
  if (!result.success || (!localTestKey && result.action !== action) || (!localRequest(request) && !hosts.includes(result.hostname || ''))) {
    throw new AuthError('Complete the verification challenge again.', 400);
  }
}
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes)).map((v) => v.toString(16).padStart(2, '0')).join('');
const hash = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function validatePassword(value: unknown, breachCheck = false): Promise<string> {
  if (typeof value !== 'string') throw new AuthError('Enter a password.', 400);
  const error = newPasswordError(value);
  if (error) throw new AuthError(error, 400);
  if (breachCheck) {
    // Tagstash's privacy-preserving range lookup: only five SHA-1 characters leave the Worker.
    const digest = hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))).toUpperCase();
    let breached = false;
    try {
      const response = await upstream(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } }, 3000);
      if (response.ok) breached = (await response.text()).split(/\r?\n/).some((line) => {
        const [suffix, count] = line.split(':');
        return suffix === digest.slice(5) && Number(count) > 0;
      });
    } catch { /* Advisory service fails open, as in Tagstash. */ }
    if (breached) throw new AuthError('That password appears in a known breach. Choose another password.', 400);
  }
  return value;
}
// Soft event caps, as in Tagstash. Atomic login_attempts below is the hard lockout.
async function limited(db: D1Database, event: string, column: 'ip' | 'email', value: string | null, max: number, minutes: number) {
  if (!value) return false;
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM auth_events WHERE event_type = ? AND ${column} = ? AND created_at > ?`)
    .bind(event, value, Date.now() - minutes * 60_000).first<{ n: number }>();
  return Number(row?.n || 0) >= max;
}
async function event(db: D1Database, request: Request, type: string, email: string) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO auth_events (event_type, email, ip, created_at) VALUES (?, ?, ?, ?)').bind(type, email, request.headers.get('CF-Connecting-IP'), now),
    db.prepare('DELETE FROM auth_events WHERE created_at < ?').bind(now - 30 * DAY_MS),
    db.prepare('DELETE FROM login_attempts WHERE updated_at < ?').bind(now - 30 * DAY_MS),
  ]);
}
async function throttle(db: D1Database, request: Request, type: string, email: string, ipMax: number, emailCaps: boolean) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (await limited(db, type, 'ip', ip, ipMax, 60)
    || (emailCaps && (await limited(db, type, 'email', email, 5, 60) || await limited(db, type, 'email', email, 1, 1)))) {
    throw new AuthError('Too many attempts. Please try again later.', 429);
  }
  await event(db, request, type, email);
}
async function sendEmail(env: Env, to: string, subject: string, text: string) {
  emailReady(env);
  const response = await upstream(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text, ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}) }),
  }, 10_000);
  const result = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok || !result?.success) throw new AuthError('Email delivery failed.', 502);
}
async function issueLink(db: D1Database, env: Env, user: User, purpose: 'verify' | 'reset') {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await hash(raw);
  const now = Date.now();
  await db.prepare(`INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, purpose) DO UPDATE SET
    token_hash = excluded.token_hash, created_at = excluded.created_at, expires_at = excluded.expires_at, used_at = NULL, claim_id = NULL`)
    .bind(digest, user.id, purpose, now, now + (purpose === 'verify' ? DAY_MS : 60 * 60_000)).run();
  const link = new URL(purpose === 'verify' ? '/verify-email' : '/reset-password', env.APP_URL);
  link.searchParams.set('token', raw);
  try {
    await sendEmail(env, user.email, purpose === 'verify' ? 'Verify your Astir email address' : 'Reset your Astir password',
      `${purpose === 'verify' ? 'Verify your email address to start using Astir' : 'Reset your Astir password'}:\n\n${link}\n\nThis link expires in ${purpose === 'verify' ? '24 hours' : '1 hour'}. If you did not request this, ignore this email.`);
  } catch (error) {
    await db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').bind(digest).run();
    throw error;
  }
}
async function background(context: Background, task: () => Promise<void>) {
  const work = task().catch(() => { console.warn('[auth] background email failed'); });
  if (context) context.waitUntil(work);
  else await work;
}
export async function currentSession(request: Request, env: Env) {
  const key = signingKey(env);
  const token = getCookie(request);
  if (!token) return null;
  let claims;
  try {
    claims = (await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ['iat', 'exp', 'sub', 'sid', 'tv'] })).payload;
  } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || !Number.isInteger(claims.tv)
    || typeof claims.iat !== 'number' || typeof claims.exp !== 'number'
    || claims.iat > now || claims.exp <= claims.iat || claims.exp - claims.iat > SESSION_SECONDS) return null;
  const row = await env.DB.prepare(`SELECT u.id, u.email, s.id AS session_id FROM users u JOIN browser_sessions s ON s.user_id = u.id
    WHERE u.id = ? AND s.id = ? AND u.token_version = ? AND s.token_version = u.token_version
    AND u.email_verified = 1 AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .bind(claims.sub, claims.sid, claims.tv, Date.now()).first<{ id: string; email: string; session_id: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE browser_sessions SET last_active_at = ? WHERE id = ?').bind(Date.now(), row.session_id).run();
  return row;
}

export async function handleAuth(request: Request, env: Env, context?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    // A custom header forces a preflight; mutations additionally require a trusted origin.
    if (request.headers.get('X-Astir-Client') !== 'web') throw new AuthError('Use the Astir web client.', 403);
    if (request.method !== 'GET' && !isAllowedOrigin(request.headers.get('Origin'), request, env)) throw new AuthError('Untrusted request origin.', 403);
    if (request.method === 'GET' && path === '/api/auth/me') {
      const session = await currentSession(request, env);
      return session ? json({ user: { id: session.id, email: session.email } }) : json({ error: 'Please sign in.' }, 401, { 'Set-Cookie': cookie(request, '', 0) });
    }
    if (request.method !== 'POST') return json({ error: 'Route not found' }, 404);
    const db = env.DB;
    if (path === '/api/auth/logout') {
      const session = await currentSession(request, env);
      if (session) await db.prepare('UPDATE browser_sessions SET revoked_at = ? WHERE id = ?').bind(Date.now(), session.session_id).run();
      return json({ message: 'Signed out.' }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    }
    const body = await bodyOf(request);
    if (path === '/api/auth/register') {
      signingKey(env);
      const email = emailAddress(body.email);
      const password = await validatePassword(body.password);
      emailReady(env);
      await throttle(db, request, 'register_attempt', email, 10, false);
      await turnstile(request, env, body.turnstileToken, 'register');
      await validatePassword(password, true);
      const passwordHash = await bcrypt.hash(password, 10);
      await db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
        .bind(crypto.randomUUID(), email, passwordHash, Date.now()).run();
      await background(context, async () => {
        const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
        if (!user) return;
        if (!await limited(db, 'register_owner_notified', 'email', email, 3, 24 * 60)) {
          await event(db, request, 'register_owner_notified', email);
          if (!user.email_verified) await issueLink(db, env, user, 'verify');
          else await sendEmail(env, email, 'Your Astir account', 'Someone tried to sign up for Astir using your address. You already have an account. Sign in at ' + env.APP_URL + ' or use Forgot password. If this was not you, ignore this email.');
        }
      });
      return json(ACCEPTED, 201);
    }
    if (path === '/api/auth/login') {
      const key = signingKey(env);
      const email = emailAddress(body.email);
      if (typeof body.password !== 'string' || !body.password) throw new AuthError('Enter your email and password.', 400);
      if (await limited(db, 'login_failed', 'ip', request.headers.get('CF-Connecting-IP'), 20, 15)) throw new AuthError('Too many attempts. Please try again later.', 429);
      await turnstile(request, env, body.turnstileToken, 'login');
      const now = Date.now();
      const attempts = await db.prepare('SELECT locked_until FROM login_attempts WHERE email = ?').bind(email).first<{ locked_until: number }>();
      if (attempts && attempts.locked_until > now) throw new AuthError('Too many attempts. Try again in 15 minutes.', 429);
      const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
      const matches = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);
      if (!matches || !user) {
        const time = Date.now();
        const attempt = await db.prepare(`INSERT INTO login_attempts (email, failed_attempts, locked_until, updated_at) VALUES (?, 1, 0, ?)
          ON CONFLICT(email) DO UPDATE SET
          failed_attempts = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 1 ELSE failed_attempts + 1 END,
          locked_until = CASE WHEN locked_until > 0 AND locked_until <= ? THEN 0 WHEN failed_attempts + 1 >= 8 THEN ? ELSE 0 END,
          updated_at = ? WHERE locked_until <= ? RETURNING locked_until`)
          .bind(email, time, time, time, time + LOCK_MS, time, time).first<{ locked_until: number }>();
        await event(db, request, 'login_failed', email);
        if (!attempt || attempt.locked_until > time) throw new AuthError('Too many attempts. Try again in 15 minutes.', 429);
        throw new AuthError('Invalid email or password.', 401);
      }
      // Do not clear a lock established by another guess while bcrypt was running.
      const lock = await db.prepare('SELECT locked_until FROM login_attempts WHERE email = ?').bind(email).first<{ locked_until: number }>();
      if (lock && lock.locked_until > Date.now()) throw new AuthError('Too many attempts. Try again in 15 minutes.', 429);
      if (!user.email_verified) throw new AuthError('Verify your email address before signing in. You can request a new verification email below.', 403);
      await db.prepare('DELETE FROM login_attempts WHERE email = ? AND locked_until <= ?').bind(email, Date.now()).run();
      const sid = crypto.randomUUID();
      const created = Date.now();
      const result = await db.prepare(`INSERT INTO browser_sessions (id, user_id, token_version, name, created_at, last_active_at, expires_at)
        SELECT ?, id, token_version, ?, ?, ?, ? FROM users WHERE id = ? AND token_version = ? AND email_verified = 1
        AND NOT EXISTS (SELECT 1 FROM login_attempts WHERE email = ? AND locked_until > ?)`)
        .bind(sid, (request.headers.get('User-Agent') || 'Web browser').slice(0, 200), created, created, created + SESSION_SECONDS * 1000, user.id, user.token_version, email, created).run();
      if (!result.meta.changes) throw new AuthError('Your account changed while signing in. Please try again.', 409);
      const token = await new SignJWT({ sid, tv: user.token_version }).setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`).sign(key);
      return json({ user: { id: user.id, email: user.email } }, 200, { 'Set-Cookie': cookie(request, token) });
    }
    if (path === '/api/auth/forgot-password' || path === '/api/auth/resend-verification') {
      const email = emailAddress(body.email);
      emailReady(env);
      const purpose = path.endsWith('forgot-password') ? 'reset' : 'verify';
      await throttle(db, request, purpose === 'reset' ? 'password_reset_requested' : 'verification_resend_requested', email, 10, true);
      await background(context, async () => {
        const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
        if (user && (purpose === 'reset' || !user.email_verified)) await issueLink(db, env, user, purpose);
      });
      return json(LINK_ACCEPTED);
    }
    if (path === '/api/auth/verify-email' || path === '/api/auth/reset-password') {
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new AuthError('Invalid or expired link. Request a new one.', 400);
      const purpose = path.endsWith('verify-email') ? 'verify' : 'reset';
      if (purpose === 'reset') await validatePassword(body.password);
      const digest = await hash(body.token);
      const token = await db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?')
        .bind(digest, purpose, Date.now()).first<EmailToken>();
      if (!token) throw new AuthError('Invalid or expired link. Request a new one.', 400);
      const passwordHash = purpose === 'reset' ? await bcrypt.hash(await validatePassword(body.password, true), 10) : null;
      const now = Date.now();
      // D1 batches are transactions. The first conditional write wins; changes() gates every
      // subsequent side effect so replay, expiry and simultaneous redemption cannot reset twice.
      const first = purpose === 'verify'
        ? db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ? AND email_verified = 0 AND EXISTS
          (SELECT 1 FROM email_tokens WHERE token_hash = ? AND purpose = 'verify' AND used_at IS NULL AND expires_at > ?)`)
          .bind(token.user_id, digest, now)
        : db.prepare(`UPDATE users SET password_hash = ?, email_verified = 1, token_version = token_version + 1 WHERE id = ? AND EXISTS
          (SELECT 1 FROM email_tokens WHERE token_hash = ? AND purpose = 'reset' AND used_at IS NULL AND expires_at > ?)`)
          .bind(passwordHash, token.user_id, digest, now);
      const claim = crypto.randomUUID();
      const statements = [first,
        db.prepare(`UPDATE email_tokens SET used_at = ?, claim_id = ? WHERE user_id = ? AND used_at IS NULL
          AND (purpose = ? OR ? = 'reset') AND changes() > 0`).bind(now, claim, token.user_id, purpose, purpose),
      ];
      if (purpose === 'reset') {
        // The token's unique claim_id marks this transaction; changes() cannot be
        // chained through optional rows (there may be no browser sessions or lockout row).
        const won = 'EXISTS (SELECT 1 FROM email_tokens WHERE token_hash = ? AND claim_id = ?)';
        statements.push(db.prepare(`UPDATE browser_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${won}`).bind(now, token.user_id, digest, claim));
        statements.push(db.prepare(`DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?) AND ${won}`).bind(token.user_id, digest, claim));
      }
      const [changed] = await db.batch(statements);
      if (!changed.meta.changes) throw new AuthError('Invalid or expired link. Request a new one.', 400);
      return json({ message: purpose === 'verify' ? 'Email verified. You can now sign in.' : 'Password reset. Sign in with your new password.' });
    }
    return json({ error: 'Route not found' }, 404);
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.message }, error.status);
    // Never log bodies, provider messages, addresses, passwords or tokens.
    console.warn('[auth] request failed');
    return json({ error: 'Authentication is temporarily unavailable. Please try again.' }, 503);
  }
}

import { describe, expect, it } from 'vitest';
import worker from '../worker/index';

const APP_URL = 'https://astir.stonedragonmedia.com';

const okDb = { prepare: () => ({ first: async () => ({ 1: 1 }) }) } as unknown as D1Database;
const brokenDb = {
  prepare: () => ({
    first: async () => {
      throw new Error('D1 down');
    },
  }),
} as unknown as D1Database;

const envWith = (db?: D1Database) => ({ APP_URL, DB: db }) as unknown as Env;

const call = (path: string, init: RequestInit = {}, env = envWith(okDb), base = APP_URL) =>
  worker.fetch(new Request(new URL(path, base), init) as never, env);

describe('GET /api/health', () => {
  it('answers with the database status', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers without D1 configured', async () => {
    const response = await call('/api/health', {}, envWith());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'not configured' });
  });

  it('answers HEAD for uptime monitors', async () => {
    const response = await call('/api/health', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('still answers when D1 fails', async () => {
    const response = await call('/api/health', {}, envWith(brokenDb));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'error' });
  });
});

describe('other routes', () => {
  it('404s an unknown API route', async () => {
    const response = await call('/api/nope');
    expect(response.status).toBe(404);
  });

  it('500s an API route when D1 is missing', async () => {
    const response = await call('/api/nope', {}, envWith());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'D1 binding DB is not configured' });
  });

  it('answers a preflight with 204', async () => {
    const response = await call('/api/health', { method: 'OPTIONS', headers: { Origin: APP_URL } });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_URL);
  });
});

describe('API headers', () => {
  it('sets security headers, no-store and HSTS over HTTPS on every response', async () => {
    for (const response of [await call('/api/health'), await call('/api/nope'), await call('/api/nope', {}, envWith())]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
      expect(response.headers.get('Vary')).toBe('Origin');
    }
  });

  it('leaves out HSTS over plain HTTP', async () => {
    const response = await call('/api/health', {}, envWith(okDb), 'http://localhost:5173');
    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
  });
});

describe('CORS allowlist', () => {
  const allowOrigin = async (origin: string, base = APP_URL) =>
    (await call('/api/health', { headers: { Origin: origin } }, envWith(okDb), base)).headers.get(
      'Access-Control-Allow-Origin',
    );

  it('allows the production origin with credentials', async () => {
    const response = await call('/api/health', { headers: { Origin: APP_URL } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_URL);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('refuses other origins', async () => {
    expect(await allowOrigin('https://evil.example')).toBeNull();
    expect(await allowOrigin('null')).toBeNull();
    expect(await allowOrigin('https://astir.stonedragonmedia.com.evil.example')).toBeNull();
  });

  it('allows the Vite dev origin only on a local request', async () => {
    expect(await allowOrigin('http://localhost:5173', 'http://localhost:8787')).toBe('http://localhost:5173');
    expect(await allowOrigin('http://localhost:5173')).toBeNull();
  });
});

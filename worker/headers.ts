// Headers for every response the Worker builds. Static assets get theirs from public/_headers,
// which never reaches Worker responses, so the API hardens its own here. Adapted from Tagstash.

const PRODUCTION_ORIGIN = 'https://astir.stonedragonmedia.com';
// Vite's dev server. Only trusted when the request itself is local, so a deployed Worker never
// grants a localhost page access.
const LOCAL_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
// The Tauri webview's own origins (Windows and Linux use http(s)://tauri.localhost, macOS
// tauri://localhost). They may read API responses but never with credentials: the apps send a
// bearer device token, and any Tauri app has these origins, so cookies must never be trusted here.
const APP_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

// The API only ever answers JSON or empty bodies, so nothing may sniff, frame or render it as a
// document. HSTS matches public/_headers and is sent only over HTTPS; no `preload`.
const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};
const HSTS = 'max-age=63072000; includeSubDomains';

const isLocalRequest = (url: URL) =>
  url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

const originOf = (value: string | undefined) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

// CORS is an allowlist, not a wildcard. The web app is same-origin in production and in
// `npm run dev`, so this matters only for other local setups. The Tauri app gets APP_ORIGINS below.
export const isAllowedOrigin = (origin: string | null, request: Request, env: Pick<Env, 'APP_URL'>) => {
  if (!origin || origin === 'null') return false;
  const url = new URL(request.url);
  if (origin === url.origin || origin === PRODUCTION_ORIGIN) return true;
  if (origin === originOf(env.APP_URL)) return true;
  return isLocalRequest(url) && LOCAL_DEV_ORIGINS.includes(origin);
};

const corsHeadersFor = (request: Request, env: Pick<Env, 'APP_URL'>): Record<string, string> => {
  const origin = request.headers.get('Origin');
  const allowed = isAllowedOrigin(origin, request, env);
  return {
    ...(allowed && origin
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
      : origin && APP_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Astir-Client',
    Vary: 'Origin',
  };
};

export const withApiHeaders = (response: Response, request: Request, env: Pick<Env, 'APP_URL'>) => {
  // Responses from fetch() or the assets binding have immutable headers, so copy first.
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) result.headers.set(name, value);
  if (new URL(request.url).protocol === 'https:') result.headers.set('Strict-Transport-Security', HSTS);
  for (const [name, value] of Object.entries(corsHeadersFor(request, env))) result.headers.set(name, value);
  return result;
};

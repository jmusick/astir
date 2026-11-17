import { deviceToken } from '../rememberedAccount';
import { isApp, serverOrigin } from './platform';

/**
 * Every request to Astir's API. The web view sends its session cookie same-origin; the app sends
 * its device token (D28) and never cookies, so the server's CSRF rules don't apply to it.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (isApp) {
    headers.set('X-Astir-Client', 'app');
    const token = deviceToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  } else headers.set('X-Astir-Client', 'web');
  return fetch(`${serverOrigin()}${path}`, { ...init, headers, credentials: isApp ? 'omit' : 'same-origin' });
}

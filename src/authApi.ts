import { apiFetch } from './platform/api';

export type Account = { id: string; email: string };
/** A signed-in browser session or (from #11) a native app's device token (D44). */
export type Device = { id: string; kind: 'browser' | 'app'; name: string; createdAt: number; lastActiveAt: number; current: boolean };
/** Set on a 401 when the account itself is gone, so this device clears its copy (D29). */
export type SignedOutReason = 'account-deleted';
export class AuthApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: SignedOutReason) { super(message); }
}

export async function authApi(path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await apiFetch(`/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AuthApiError('Astir could not be reached. Check your connection and try again.', 0);
  }
  const data = await response.json().catch(() => ({})) as {
    error?: string; message?: string; user?: Account; devices?: Device[]; reason?: string;
  };
  if (!response.ok) {
    throw new AuthApiError(data.error || (response.status === 429 ? 'Too many attempts. Please try again later.' : 'Could not reach Astir. Please try again.'),
      response.status, data.reason === 'account-deleted' ? 'account-deleted' : undefined);
  }
  return data;
}

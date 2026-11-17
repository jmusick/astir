export type Account = { id: string; email: string };
/** A signed-in browser session or (from #11) a native app's device token (D44). */
export type Device = { id: string; kind: 'browser' | 'app'; name: string; createdAt: number; lastActiveAt: number; current: boolean };
/** Set on a 401 when the account itself is gone, so this device clears its copy (D29). */
export type SignedOutReason = 'account-deleted';
export class AuthApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: SignedOutReason) { super(message); }
}

export async function authApi(path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { 'X-Astir-Client': 'web', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const data = await response.json().catch(() => ({})) as {
    error?: string; message?: string; user?: Account; devices?: Device[]; reason?: string;
  };
  if (!response.ok) {
    throw new AuthApiError(data.error || (response.status === 429 ? 'Too many attempts. Please try again later.' : 'Could not reach Astir. Please try again.'),
      response.status, data.reason === 'account-deleted' ? 'account-deleted' : undefined);
  }
  return data;
}

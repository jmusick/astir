export type Account = { id: string; email: string };

export async function authApi(path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { 'X-Astir-Client': 'web', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const data = await response.json().catch(() => ({})) as {
    error?: string; message?: string; user?: Account;
  };
  if (!response.ok) {
    throw Object.assign(new Error(data.error || (response.status === 429 ? 'Too many attempts. Please try again later.' : 'Could not reach Astir. Please try again.')), { status: response.status });
  }
  return data;
}

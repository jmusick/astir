export async function authApi(path: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { 'X-Astir-Client': 'web', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const data = await response.json().catch(() => ({})) as {
    error?: string; message?: string; user?: { id: string; email: string };
  };
  if (!response.ok) throw new Error(data.error || (response.status === 429 ? 'Too many attempts. Please try again later.' : 'Could not reach Astir. Please try again.'));
  return data;
}

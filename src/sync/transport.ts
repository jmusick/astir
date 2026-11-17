import type { PullPage, SyncRecord } from './types';

// The HTTP half of sync: /api/sync/push and /api/sync/pull (docs/sync-api.md).
export interface SyncTransport {
  push(changes: SyncRecord[]): Promise<void>;
  pull(cursor: string): Promise<PullPage>;
}

/** A failed sync request. status 0 means the network itself failed. */
export class SyncRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function httpTransport(fetcher: Fetch = (input, init) => fetch(input, init), base = ''): SyncTransport {
  async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      // Same-origin requests send the session cookie by default.
      response = await fetcher(`${base}/api/sync/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Astir-Client': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SyncRequestError('Astir could not be reached.', 0);
    }
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new SyncRequestError(typeof data.error === 'string' ? data.error : `Sync failed (${response.status}).`, response.status);
    }
    return data;
  }
  return {
    async push(changes) {
      await call('push', { changes });
    },
    async pull(cursor) {
      const data = await call(`pull?cursor=${encodeURIComponent(cursor)}`);
      if (!Array.isArray(data.changes) || typeof data.cursor !== 'string') throw new SyncRequestError('Sync returned an unexpected response.', 502);
      return { changes: data.changes as SyncRecord[], cursor: data.cursor, hasMore: data.hasMore === true, serverTime: Number(data.serverTime) || 0 };
    },
  };
}

import type { SyncStore, StoreWrite } from './store';
import { SyncRequestError } from './transport';
import type { SyncTransport } from './transport';
import { keyOf } from './types';
import type { SyncRecord } from './types';

// The one TypeScript sync engine (D13). It is local-first: every change lands in memory and the
// local store before any network call, and sync runs in the background. It knows nothing about
// IndexedDB, SQLite or fetch; those come in through SyncStore and SyncTransport.

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'rejected' | 'signed-out' | 'account-deleted';
export interface SyncStatus {
  state: SyncState;
  /** The server's message for a rejected push, or a local storage problem. */
  message: string;
  /** Records saved on this device that the server hasn't accepted yet. */
  pending: number;
}
export interface Snapshot {
  records: ReadonlyMap<string, SyncRecord>;
  status: SyncStatus;
  /** Server time minus this device's clock at the last pull, or null before one. */
  clockSkewMs: number | null;
}
export interface EngineOptions {
  now?: () => number;
  /** Push limits from docs/sync-api.md, kept slightly under the server's 1 MiB. */
  maxChanges?: number;
  maxBytes?: number;
  /** Retry backoff for network and server failures. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Debounce for syncing after a local change; false disables automatic sync (tests). */
  syncDelayMs?: number | false;
}

/**
 * Decide what a pulled record does to the local copy. The server already applied the conflict
 * rules (D32), so its record wins unless this device holds a newer unpushed edit or an unpushed
 * delete. A tombstone the server stored without data gets this device's archive copy back.
 */
export function mergePulled(local: SyncRecord | undefined, server: SyncRecord, pending: boolean): { record: SyncRecord; pending: boolean } {
  let record = server;
  let stillPending = false;
  if (local && pending) {
    const localWins = local.deleted ? !server.deleted : !server.deleted && local.editedAt > server.editedAt;
    if (localWins) { record = local; stillPending = true; }
  }
  if (record.deleted && record.data == null && local?.data != null) {
    record = { ...record, data: local.data };
    // Children, completions and picks reference an item's, list's or pool item's data, so push the archive copy back.
    if (record.entity === 'item' || record.entity === 'list' || record.entity === 'pool') { record.archive = true; stillPending = true; }
  }
  return { record, pending: stillPending };
}

type Outgoing = { record: SyncRecord; send: SyncRecord; finishes: boolean };
const RANK = (r: SyncRecord) => r.entity === 'list' ? 0 : r.entity === 'item' ? ((r.data as { parentId?: unknown } | null)?.parentId ? 2 : 1) : r.entity === 'pick' ? 4 : 3;
/** Parents before children, within and across pushes. */
export function parentsFirst<T = SyncRecord>(items: T[], recordOf: (item: T) => SyncRecord = (item) => item as SyncRecord): T[] {
  return [...items].sort((a, b) => RANK(recordOf(a)) - RANK(recordOf(b)));
}

const wire = (r: SyncRecord): SyncRecord => r.deleted
  ? { entity: r.entity, id: r.id, editedAt: r.editedAt, deleted: true, data: null }
  : { entity: r.entity, id: r.id, editedAt: r.editedAt, deleted: false, data: r.data };

export function chunk<T = SyncRecord>(items: T[], maxChanges: number, maxBytes: number, recordOf: (item: T) => SyncRecord = (item) => item as SyncRecord): T[][] {
  const encoder = new TextEncoder();
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const record of items) {
    const size = encoder.encode(JSON.stringify(wire(recordOf(record)))).length + 1;
    if (current.length && (current.length >= maxChanges || bytes + size > maxBytes)) { chunks.push(current); current = []; bytes = 0; }
    current.push(record); bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Errors that mean "the server refused this push": keep the work local and show the message. */
const isRejection = (error: unknown) => error instanceof SyncRequestError
  && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);

export class SyncEngine {
  private records = new Map<string, SyncRecord>();
  private pending = new Set<string>();
  private cursor: string;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private status: Omit<SyncStatus, 'pending'> = { state: 'idle', message: '' };
  private writes: Promise<void> = Promise.resolve();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerIsRetry = false;
  private attempt = 0;
  private closed = false;
  private saveFailed = false;
  private clockSkewMs: number | null = null;
  private readonly now: () => number;
  private readonly options: Required<Omit<EngineOptions, 'now'>>;

  private constructor(private readonly store: SyncStore, private readonly transport: SyncTransport, state: Awaited<ReturnType<SyncStore['load']>>, options: EngineOptions) {
    for (const record of state.records) this.records.set(keyOf(record), record);
    for (const key of state.pending) if (this.records.has(key)) this.pending.add(key);
    this.cursor = state.cursor || '0';
    this.now = options.now ?? Date.now;
    this.options = { maxChanges: 500, maxBytes: 900_000, retryBaseMs: 2_000, retryMaxMs: 300_000, syncDelayMs: 300, ...options };
    this.snapshot = this.build();
  }

  static async open(store: SyncStore, transport: SyncTransport, options: EngineOptions = {}) {
    return new SyncEngine(store, transport, await store.load(), options);
  }

  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /**
   * Save local edits (full records). The snapshot updates synchronously, so the UI never waits;
   * the returned promise settles once the local store has them. Sync follows in the background.
   */
  change(records: SyncRecord[]): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Astir is closed.'));
    const now = this.now();
    const saved: SyncRecord[] = [];
    for (const record of records) {
      const key = keyOf(record);
      const previous = this.records.get(key);
      if (previous?.deleted) continue; // Tombstones never come back (D32).
      // Strictly after the previous edit, so a slow clock can't make a new edit lose locally.
      const next = { ...record, editedAt: Math.max(now, (previous?.editedAt ?? -1) + 1) };
      this.records.set(key, next); this.pending.add(key); saved.push(next);
    }
    this.publish();
    const done = this.persist({ put: saved, addPending: saved.map(keyOf) });
    // Sync even if the local write failed: the server is then the only other copy.
    done.then(() => this.requestSync(), () => this.requestSync());
    return done;
  }

  /** Push pending changes, then pull everything new. Concurrent calls share one run. */
  sync(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.clearTimer();
    this.running = (async () => {
      do {
        this.again = false;
        if (!await this.runOnce()) break;
      } while (this.again && !this.closed);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Sync now and report how many changes still haven't reached the server (D45 sign-out). */
  async flush(): Promise<number> {
    await this.writes;
    await this.sync();
    return this.pending.size;
  }

  close() {
    this.closed = true;
    this.clearTimer();
    this.listeners.clear();
    this.store.close();
  }

  /** Stop and wipe this account's local data. */
  async destroy() {
    // Don't wait for an in-flight request: once closed, it writes nothing more.
    this.closed = true;
    this.clearTimer();
    await this.writes;
    this.listeners.clear();
    await this.store.destroy();
  }

  private async runOnce(): Promise<boolean> {
    await this.writes;
    this.setStatus('syncing');
    let rejected: SyncRequestError | null = null;
    try {
      try { await this.pushPending(); } catch (error) {
        if (!isRejection(error)) throw error;
        rejected = error as SyncRequestError;
      }
      await this.pullAll();
      this.attempt = 0;
      if (rejected) this.setStatus('rejected', rejected.message);
      else this.setStatus(this.pending.size ? 'idle' : 'synced');
      return !rejected;
    } catch (error) {
      if (this.closed) return false;
      if (error instanceof SyncRequestError && error.status === 401 && error.reason === 'account-deleted') {
        // Nothing here can sync anywhere any more; the UI explains and clears this device (D29).
        this.setStatus('account-deleted', 'This account was deleted, so Astir is removing its data from this device.');
      } else if (error instanceof SyncRequestError && error.status === 401) {
        this.setStatus('signed-out', 'You were signed out. Your changes are kept on this device until you sign in again.');
      } else if (!(error instanceof SyncRequestError)) {
        // A local save failed, not the network; persist() already shows that. Retry later.
        this.setStatus(this.pending.size ? 'idle' : 'synced');
        this.scheduleRetry();
      } else {
        this.setStatus('offline');
        this.scheduleRetry();
      }
      return false;
    }
  }

  private async pushPending() {
    const live: Outgoing[] = [];
    const tombstones: Outgoing[] = [];
    const archiveCopies: Outgoing[] = [];
    for (const key of this.pending) {
      const record = this.records.get(key);
      if (!record) continue;
      if (!record.deleted) live.push({ record, send: record, finishes: true });
      // The server holds this tombstone without data: send the archive copy back to fill it.
      else if (record.archive) live.push({ record, send: { ...record, deleted: false }, finishes: true });
      else {
        tombstones.push({ record, send: record, finishes: true });
        if (record.data && (record.entity === 'item' || record.entity === 'list' || record.entity === 'pool')) archiveCopies.push({ record, send: { ...record, deleted: false }, finishes: false });
      }
    }
    try {
      // Deletes travel with everything else, so quotas are checked against the final state.
      await this.pushAll([...live, ...tombstones]);
    } catch (error) {
      // The server ignores data on deletes, so an item deleted before it ever synced has no data
      // there, and its completions or children are rejected as invalid references. Send the
      // archive copy first, then the tombstone (D34).
      if (!(error instanceof SyncRequestError && error.status === 400 && archiveCopies.length)) throw error;
      await this.pushAll([...live, ...archiveCopies]);
      await this.pushAll(tombstones);
    }
  }

  private async pushAll(outgoing: Outgoing[]) {
    const send = (o: Outgoing) => o.send;
    for (const batch of chunk(parentsFirst(outgoing, send), this.options.maxChanges, this.options.maxBytes, send)) {
      if (this.closed) return;
      await this.transport.push(batch.map((o) => wire(o.send)));
      this.settle(batch);
    }
  }

  /** Clear pending flags for pushed records that haven't been edited again since. */
  private settle(batch: Outgoing[]) {
    const settled: string[] = [];
    const put: SyncRecord[] = [];
    for (const { record, finishes } of batch) {
      if (!finishes) continue;
      const key = keyOf(record);
      const current = this.records.get(key);
      if (!current || current.editedAt !== record.editedAt || current.deleted !== record.deleted || !this.pending.delete(key)) continue;
      settled.push(key);
      if (current.archive) {
        const filled = { ...current };
        delete filled.archive;
        this.records.set(key, filled); put.push(filled);
      }
    }
    if (settled.length) { this.publish(); this.persist({ put, removePending: settled }).catch(() => undefined); }
  }

  private async pullAll() {
    for (;;) {
      if (this.closed) return;
      const page = await this.transport.pull(this.cursor);
      if (this.closed) return;
      if (page.serverTime > 0) this.clockSkewMs = page.serverTime - this.now();
      const put: SyncRecord[] = [];
      const addPending: string[] = [];
      const removePending: string[] = [];
      for (const server of page.changes) {
        const key = keyOf(server);
        const wasPending = this.pending.has(key);
        const { record, pending } = mergePulled(this.records.get(key), server, wasPending);
        this.records.set(key, record); put.push(record);
        if (pending) { this.pending.add(key); if (!wasPending) { addPending.push(key); this.again = true; } }
        else if (wasPending) { this.pending.delete(key); removePending.push(key); }
      }
      const previous = this.cursor;
      this.cursor = page.cursor;
      this.publish();
      // The page and its cursor are stored together, so a crash never skips or half-applies one.
      await this.persist({ put, addPending, removePending, cursor: page.cursor });
      if (!page.hasMore || page.cursor === previous) return;
    }
  }

  private requestSync() {
    if (this.closed || this.options.syncDelayMs === false) return;
    if (this.timer && this.timerIsRetry) return; // Offline: the backoff (or an "online" event) retries.
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = undefined; void this.sync(); }, this.options.syncDelayMs);
  }

  private scheduleRetry() {
    if (this.closed) return;
    this.clearTimer();
    const delay = Math.min(this.options.retryBaseMs * 2 ** this.attempt, this.options.retryMaxMs);
    this.attempt += 1;
    this.timerIsRetry = true;
    this.timer = setTimeout(() => { this.timer = undefined; this.timerIsRetry = false; void this.sync(); }, delay);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.timerIsRetry = false;
  }

  private persist(change: StoreWrite): Promise<void> {
    if (this.closed) return Promise.resolve(); // Closed or destroyed: nothing left to save into.
    const write = this.writes.then(() => this.store.write(change));
    this.writes = write.catch(() => undefined);
    return write.then(() => {
      if (this.saveFailed) { this.saveFailed = false; this.publish(); }
    }, (error: unknown) => {
      this.saveFailed = true; this.publish();
      throw error;
    });
  }

  private setStatus(state: SyncState, message = '') {
    this.status = { state, message };
    this.publish();
  }

  private build(): Snapshot {
    // A failed local save stays visible until a later save succeeds.
    const message = this.status.message || (this.saveFailed ? 'This device couldn’t save your latest change. Keep this tab open until it syncs.' : '');
    return { records: new Map(this.records), status: { ...this.status, message, pending: this.pending.size }, clockSkewMs: this.clockSkewMs };
  }

  private publish() {
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }
}

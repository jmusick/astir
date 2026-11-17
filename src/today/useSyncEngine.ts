import { useEffect, useState, useSyncExternalStore } from 'react';
import { SyncEngine } from '../sync/engine';
import type { Snapshot } from '../sync/engine';
import { openIndexedDbStore } from '../sync/indexedDbStore';
import { MemoryStore } from '../sync/store';
import type { SyncStore } from '../sync/store';
import { httpTransport } from '../sync/transport';

const PULL_EVERY_MS = 60_000;
const noSubscribe = () => () => undefined;
const noSnapshot = () => null;

/** Opens this account's local store and engine, and keeps it syncing while the page is open. */
export function useSyncEngine(accountId: string) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [localOnly, setLocalOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let opened: SyncEngine | null = null;
    (async () => {
      let store: SyncStore | null = null;
      let next: SyncEngine;
      try {
        // Another tab signed out (and wiped this data) or upgraded it: reload to match.
        store = await openIndexedDbStore(accountId, indexedDB, () => window.location.reload());
        next = await SyncEngine.open(store, httpTransport());
      } catch {
        // Some private windows refuse IndexedDB. Keep working in memory; sync still saves the work.
        store?.close();
        next = await SyncEngine.open(new MemoryStore(), httpTransport());
        if (!cancelled) setLocalOnly(true);
      }
      if (cancelled) { next.close(); return; }
      opened = next;
      setEngine(next);
      void next.sync();
    })();
    return () => { cancelled = true; opened?.close(); };
  }, [accountId]);

  useEffect(() => {
    if (!engine) return;
    const sync = () => { if (document.visibilityState === 'visible') void engine.sync(); };
    const timer = setInterval(sync, PULL_EVERY_MS);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [engine]);

  const snapshot: Snapshot | null = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getSnapshot ?? noSnapshot);
  return { engine, snapshot, localOnly };
}

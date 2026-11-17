import { useEffect } from 'react';
import type { SyncEngine } from '../sync/engine';
import { isApp } from './platform';
import { onShellEvent, setBadge, stayAwakeInTray } from './nativeShell';

/**
 * Wires the native shell to the open account: the badge follows what's left today, and the tray's
 * Sync now and Quick add reach the engine and the UI. Does nothing in the browser.
 */
export function useNativeShell(engine: SyncEngine | null, left: number | null, onQuickAdd: () => void) {
  useEffect(() => { if (isApp) stayAwakeInTray(); }, []);

  useEffect(() => {
    if (!isApp || left === null) return;
    void setBadge(left).catch(() => undefined);
  }, [left]);
  // Signing out or closing the account clears the badge.
  useEffect(() => () => { if (isApp) void setBadge(0).catch(() => undefined); }, []);

  useEffect(() => {
    if (!isApp || !engine) return;
    const stops: Promise<() => void>[] = [
      onShellEvent('sync-now', () => void engine.sync()),
      onShellEvent('quick-add', onQuickAdd),
    ];
    return () => { for (const stop of stops) void stop.then((fn) => fn()).catch(() => undefined); };
  }, [engine, onQuickAdd]);
}

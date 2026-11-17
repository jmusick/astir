import { useEffect, useRef } from 'react';
import { newTodayTask } from '../sync/daily';
import type { SyncEngine } from '../sync/engine';
import { isApp } from './platform';
import { onShellEvent, setBadge, stayAwakeInTray } from './nativeShell';
import { showQuickAddBox, startQuickAdd, SUBMIT_EVENT } from './quickAdd';

/**
 * Wires the native shell to the open account: the badge follows what's left today, the tray's
 * Sync now reaches the engine, and the quick-add shortcut and tray item open the box whose titles
 * land in today's "Today only" panel. Does nothing in the browser.
 */
export function useNativeShell(engine: SyncEngine | null, left: number | null, day: string) {
  const today = useRef(day);
  useEffect(() => { today.current = day; }, [day]);

  useEffect(() => { if (isApp) stayAwakeInTray(); }, []);

  useEffect(() => {
    if (!isApp || left === null) return;
    void setBadge(left).catch(() => undefined);
  }, [left]);
  // Signing out or closing the account clears the badge.
  useEffect(() => () => { if (isApp) void setBadge(0).catch(() => undefined); }, []);

  useEffect(() => {
    if (!isApp || !engine) return;
    const open = () => void showQuickAddBox().catch(() => undefined);
    const stops: Promise<() => void>[] = [
      onShellEvent('sync-now', () => void engine.sync()),
      onShellEvent('quick-add', open),
      startQuickAdd(open),
      import('@tauri-apps/api/event').then(({ listen }) => listen<{ title?: unknown }>(SUBMIT_EVENT, ({ payload }) => {
        // The box already trimmed and checked the title; check again, since any window can emit.
        if (typeof payload?.title !== 'string' || !payload.title.trim()) return;
        void engine.change(newTodayTask(crypto.randomUUID(), payload.title.trim().slice(0, 500), today.current, Date.now())).catch(() => undefined);
      })),
    ];
    return () => { for (const stop of stops) void stop.then((fn) => fn()).catch(() => undefined); };
  }, [engine]);
}

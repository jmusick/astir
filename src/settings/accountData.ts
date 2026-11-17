import type { SyncEngine } from '../sync/engine';
import { downloadExport, exportData } from '../sync/exportData';

const EXPORT_SYNC_MS = 5_000;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function lastActive(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 5) return 'Active now';
  if (minutes < 60) return `Active ${relative.format(-minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Active ${relative.format(-hours, 'hour')}`;
  return `Active ${relative.format(-Math.round(hours / 24), 'day')}`;
}

/** Download everything this device holds, syncing first when it can (D29). */
export async function exportNow(engine: SyncEngine, email: string) {
  let unsynced = engine.getSnapshot().status.pending;
  try {
    unsynced = await Promise.race([engine.flush(), new Promise<number>((resolve) => setTimeout(() => resolve(engine.getSnapshot().status.pending), EXPORT_SYNC_MS))]);
  } catch { /* Offline or signed out: export what's here. */ }
  downloadExport(exportData(engine.getSnapshot().records, email, unsynced));
}

import { addDays, dayAt, dayVersions } from './day';
import { historyDay, historyRange } from './history';
import type { SyncRecord } from './types';

// The JSON export (D29): every list, item, schedule, completion, day setting and dismissal this
// device holds, plus each past day's history as History shows it. It's built from the local copy,
// so it works offline and after a revoked sign-in, before anything is cleared.

export const EXPORT_FORMAT = 'astir-export';
export const EXPORT_VERSION = 1;

export interface ExportedRecord { id: string; editedAt: string; deleted?: true; [field: string]: unknown }
export interface ExportedDay {
  day: string;
  /** A bucket task appears once per pick, named by `pick` (D70). */
  habits: { id: string; title: string; pick?: string; done: boolean }[];
  tasks: { id: string; title: string; pick?: string; list?: string }[];
  /** One-off tasks dropped unfinished after this day (D70). */
  dropped?: { id: string; title: string }[];
}
export interface AstirExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  account: { email: string };
  /** Changes made on this device that hadn't reached the server when the export was made. */
  unsynced: number;
  lists: ExportedRecord[];
  items: ExportedRecord[];
  schedules: ExportedRecord[];
  completions: ExportedRecord[];
  daySettings: ExportedRecord[];
  dismissals: ExportedRecord[];
  /** Bucket pool items and the picks each day recorded (D56, D61). */
  pools: ExportedRecord[];
  picks: ExportedRecord[];
  history: ExportedDay[];
}

const exported = (record: SyncRecord): ExportedRecord => ({
  id: record.id, editedAt: new Date(record.editedAt).toISOString(),
  // Deleted lists and items keep their data as archives (D34), so the export keeps them too.
  ...(record.deleted ? { deleted: true as const } : {}),
  ...(record.data as Record<string, unknown> | null ?? {}),
});

export function exportData(records: ReadonlyMap<string, SyncRecord>, email: string, unsynced = 0, now = Date.now()): AstirExport {
  const of = (entity: SyncRecord['entity']) => [...records.values()]
    .filter((r) => r.entity === entity && (r.data != null || !r.deleted))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(exported);
  const versions = dayVersions(records);
  const dayOf = (instant: number) => dayAt(versions, instant);
  const history: ExportedDay[] = [];
  const range = historyRange(records, dayAt(versions, now), dayOf);
  for (let day = range?.first; range && day && day <= range.last; day = addDays(day, 1)) {
    const view = historyDay(records, day, dayOf);
    if (!view.habits.length && !view.tasks.length && !view.dropped.length) continue;
    history.push({
      day,
      habits: view.habits.map(({ item, done, pick }) => ({ id: item.id, title: item.data!.title, ...(pick ? { pick } : {}), done })),
      tasks: view.tasks.map(({ item, listTitle, pick }) => ({ id: item.id, title: item.data!.title, ...(pick ? { pick } : {}), ...(listTitle ? { list: listTitle } : {}) })),
      ...(view.dropped.length ? { dropped: view.dropped.map(({ item }) => ({ id: item.id, title: item.data!.title })) } : {}),
    });
  }
  return {
    format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date(now).toISOString(), account: { email }, unsynced,
    lists: of('list'), items: of('item'), schedules: of('schedule'), completions: of('completion'),
    daySettings: of('day'), dismissals: of('dismissal'), pools: of('pool'), picks: of('pick'), history,
  };
}

export const exportFileName = (now = Date.now()) => `astir-export-${new Date(now).toISOString().slice(0, 10)}.json`;

/** Hands the export to the browser as a file download. */
export function downloadExport(data: AstirExport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = exportFileName(Date.parse(data.exportedAt));
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

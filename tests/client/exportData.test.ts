import { describe, expect, it } from 'vitest';
import { EVERY_DAY, newHabit, newTodayTask, removed, setCompleted } from '../../src/sync/daily';
import { firstDaySettings } from '../../src/sync/day';
import { exportData, exportFileName } from '../../src/sync/exportData';
import { newList, newListTask } from '../../src/sync/lists';
import { keyOf } from '../../src/sync/types';
import type { ItemData, SyncRecord } from '../../src/sync/types';

const at = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
function put(records: Map<string, SyncRecord>, editedAt: number, changes: SyncRecord[]) {
  for (const record of changes) records.set(keyOf(record), { ...record, editedAt });
}
const item = (records: Map<string, SyncRecord>, id: string) => records.get(`item/${id}`) as SyncRecord<ItemData>;

describe('JSON export', () => {
  it('covers every list, item, completion and setting, archives included, plus past days’ history', () => {
    const records = new Map<string, SyncRecord>();
    put(records, at('2026-11-01', 0), firstDaySettings({ timeZone: 'UTC', startHour: 0 }));
    put(records, at('2026-11-02'), [...newHabit('walk', 'Walk', EVERY_DAY, '2026-11-02', 1), ...newList('home', 'Home', 1), ...newListTask('tap', 'home', 'Fix the tap', 1)]);
    put(records, at('2026-11-02', 13), newTodayTask('call', 'Call the bank', '2026-11-02', 2));
    put(records, at('2026-11-02', 14), setCompleted(item(records, 'walk'), '2026-11-02', true));
    put(records, at('2026-11-02', 15), setCompleted(item(records, 'call'), '2026-11-02', true));
    put(records, at('2026-11-03'), setCompleted(item(records, 'tap'), '2026-11-03', true));
    put(records, at('2026-11-03', 13), newTodayTask('old', 'Old idea', '2026-11-03', 3));
    put(records, at('2026-11-03', 14), removed(item(records, 'old')));

    const data = exportData(records, 'owner@example.test', 2, at('2026-11-04'));
    expect(data).toMatchObject({ format: 'astir-export', version: 1, account: { email: 'owner@example.test' }, unsynced: 2, exportedAt: '2026-11-04T12:00:00.000Z' });
    expect(data.lists).toEqual([{ id: 'home', editedAt: '2026-11-02T12:00:00.000Z', title: 'Home', position: 1 }]);
    expect(data.items.map((i) => i.id)).toEqual(['call', 'old', 'tap', 'walk']);
    expect(data.items.find((i) => i.id === 'old')).toMatchObject({ deleted: true, title: 'Old idea' });
    expect(data.schedules).toHaveLength(1);
    expect(data.completions.map((c) => c.id).sort()).toEqual(['call:task', 'tap:task', 'walk:2026-11-02']);
    expect(data.daySettings).toEqual([{ id: '0001-01-01', editedAt: '2026-11-01T00:00:00.000Z', effectiveDay: '0001-01-01', timeZone: 'UTC', startHour: 0 }]);
    expect(data.history).toEqual([
      { day: '2026-11-02', habits: [{ id: 'walk', title: 'Walk', done: true }], tasks: [{ id: 'call', title: 'Call the bank' }] },
      { day: '2026-11-03', habits: [{ id: 'walk', title: 'Walk', done: false }], tasks: [{ id: 'tap', title: 'Fix the tap', list: 'Home' }] },
    ]);
    // Plain data only, so JSON.stringify round-trips it.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('exports an empty account and names the file by date', () => {
    const data = exportData(new Map(), 'new@example.test', 0, at('2026-11-04'));
    expect(data).toMatchObject({ lists: [], items: [], history: [] });
    expect(exportFileName(at('2026-11-04'))).toBe('astir-export-2026-11-04.json');
  });
});

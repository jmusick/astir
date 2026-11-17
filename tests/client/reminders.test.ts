import { describe, expect, it } from 'vitest';
import { edited, newHabit, newTodayTask, removed, setCompleted } from '../../src/sync/daily';
import { firstDaySettings, zonedInstant } from '../../src/sync/day';
import { newList, newListTask, newSubtask } from '../../src/sync/lists';
import { dismissed, reminderInstant, remindersDue } from '../../src/sync/reminders';
import { keyOf } from '../../src/sync/types';
import type { DayData, ItemData, SyncRecord } from '../../src/sync/types';

const ZONE = 'America/New_York';
const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const WEDNESDAY = '2026-11-18';
let stamp = 1;
const store = (...groups: SyncRecord[][]) => {
  const map = new Map<string, SyncRecord>();
  for (const record of groups.flat()) map.set(keyOf(record), { ...record, editedAt: stamp++ });
  return map;
};
const apply = (map: Map<string, SyncRecord>, records: SyncRecord[]) => {
  for (const record of records) map.set(keyOf(record), { ...record, editedAt: stamp++ });
};
const item = (map: Map<string, SyncRecord>, id: string) => map.get(`item/${id}`) as SyncRecord<ItemData>;
const at = (day: string, time: string) => zonedInstant(day, time, ZONE);
const versionsFor = (startHour: number): DayData[] => firstDaySettings({ timeZone: ZONE, startHour }).map((r) => r.data as DayData);
const midnight = versionsFor(0);
/** IDs of the reminders due in the minute up to a wall-clock time. */
const firing = (records: Map<string, SyncRecord>, day: string, time: string, versions = midnight) =>
  remindersDue(records, versions, at(day, time) - 60_000, at(day, time)).map((r) => r.id);

describe('reminders', () => {
  it('fires a today-only task on its day, a habit on each scheduled day and a list task at its date and time', () => {
    const records = store(
      newTodayTask('call', 'Call the bank', MONDAY, 1),
      newHabit('walk', 'Walk', [1, 3], MONDAY, 2),
      newList('work', 'Work', 1),
      newListTask('report', 'work', 'Send the report', 3),
    );
    apply(records, edited(item(records, 'call'), { reminder: '09:00' }));
    apply(records, edited(item(records, 'walk'), { reminder: '17:30' }));
    apply(records, edited(item(records, 'report'), { reminder: new Date(at(TUESDAY, '14:15')).toISOString() }));

    expect(firing(records, MONDAY, '09:00')).toEqual(['call:task']);
    expect(firing(records, MONDAY, '17:30')).toEqual([`walk:${MONDAY}`]);
    expect(firing(records, TUESDAY, '17:30')).toEqual([]); // Not scheduled on Tuesdays.
    expect(firing(records, WEDNESDAY, '17:30')).toEqual([`walk:${WEDNESDAY}`]);
    expect(firing(records, TUESDAY, '14:15')).toEqual(['report:task']);
    expect(remindersDue(records, midnight, at(MONDAY, '17:30') - 60_000, at(MONDAY, '17:30'))[0]).toMatchObject({ day: MONDAY, reminder: '17:30' });
  });

  it('does not fire again once a task rolls over or becomes overdue', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1), newList('work', 'Work', 1), newListTask('report', 'work', 'Report', 2, MONDAY));
    apply(records, edited(item(records, 'call'), { reminder: '09:00' }));
    apply(records, edited(item(records, 'report'), { reminder: new Date(at(MONDAY, '10:00')).toISOString() }));
    // Still open on Tuesday: the today-only task rolled over and the list task is overdue.
    expect(firing(records, TUESDAY, '09:00')).toEqual([]);
    expect(firing(records, TUESDAY, '10:00')).toEqual([]);
  });

  it('only looks back to the start of the window, so a reminder that passed earlier is not shown', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1));
    apply(records, edited(item(records, 'call'), { reminder: '09:00' }));
    expect(remindersDue(records, midnight, at(MONDAY, '09:00'), at(MONDAY, '09:05'))).toEqual([]);
    expect(remindersDue(records, midnight, at(MONDAY, '08:59'), at(MONDAY, '08:59'))).toEqual([]);
  });

  it('skips finished, deleted and subtask items', () => {
    const records = store(newTodayTask('call', 'Call', MONDAY, 1), newTodayTask('gone', 'Gone', MONDAY, 2), newHabit('walk', 'Walk', [0, 1, 2, 3, 4, 5, 6], MONDAY, 3));
    for (const id of ['call', 'gone', 'walk']) apply(records, edited(item(records, id), { reminder: '09:00' }));
    apply(records, newSubtask('step', item(records, 'call'), 'Step', 1));
    apply(records, edited(item(records, 'step'), { reminder: '09:00' }));
    apply(records, setCompleted(item(records, 'call'), MONDAY, true));
    apply(records, setCompleted(item(records, 'walk'), MONDAY, true));
    apply(records, removed(item(records, 'gone')));
    expect(firing(records, MONDAY, '09:00')).toEqual([]);
    expect(firing(records, TUESDAY, '09:00')).toEqual([`walk:${TUESDAY}`]); // The habit is back the next day.
  });

  it('skips a reminder dismissed on another device, until its time changes', () => {
    const records = store(newHabit('walk', 'Walk', [0, 1, 2, 3, 4, 5, 6], MONDAY, 1));
    apply(records, edited(item(records, 'walk'), { reminder: '17:30' }));
    const [due] = remindersDue(records, midnight, at(MONDAY, '17:29'), at(MONDAY, '17:30'));
    const dismissal = dismissed(due);
    expect(dismissal).toEqual([{ entity: 'dismissal', id: `walk:${MONDAY}`, editedAt: 0, deleted: false, data: { itemId: 'walk', day: MONDAY, reminder: '17:30' } }]);
    apply(records, dismissal);
    expect(firing(records, MONDAY, '17:30')).toEqual([]);
    expect(firing(records, TUESDAY, '17:30')).toEqual([`walk:${TUESDAY}`]); // A new day is a new reminder.
    apply(records, edited(item(records, 'walk'), { reminder: '18:00' }));
    expect(firing(records, MONDAY, '18:00')).toEqual([`walk:${MONDAY}`]);
  });

  it('puts a time before the day-start hour after midnight, on the same account day', () => {
    const late = versionsFor(4);
    expect(reminderInstant(late, MONDAY, '02:00')).toBe(at(TUESDAY, '02:00'));
    expect(reminderInstant(late, MONDAY, '05:00')).toBe(at(MONDAY, '05:00'));
    const records = store(newHabit('wind', 'Wind down', [1], MONDAY, 1));
    apply(records, edited(item(records, 'wind'), { reminder: '02:00' }));
    // 2 AM Tuesday is still Monday's account day, when the habit is scheduled.
    expect(firing(records, TUESDAY, '02:00', late)).toEqual([`wind:${MONDAY}`]);
  });
});

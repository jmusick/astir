import { describe, expect, it } from 'vitest';
import {
  addDays, changeDaySettings, dayAt, dayIn, daysBetween, dayVersions, FIRST_DAY, firstDaySettings, hourLabel,
  nextEffectiveDay, settingsOn, wallTime, weekdayOf, zonedInstant,
} from '../../src/sync/day';
import { keyOf } from '../../src/sync/types';
import type { DayData, SyncRecord } from '../../src/sync/types';

const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const version = (effectiveDay: string, startHour: number, timeZone = NY): DayData => ({ effectiveDay, timeZone, startHour });
const versionsOf = (...groups: SyncRecord[][]) => {
  const map = new Map<string, SyncRecord>();
  for (const record of groups.flat()) map.set(keyOf(record), record);
  return dayVersions(map);
};

describe('the account day', () => {
  it('counts 1:30 AM on Nov 17 as Nov 16 with a 4 AM day start in New York', () => {
    // 1:30 AM EST is 06:30 UTC.
    expect(dayAt([version(FIRST_DAY, 4)], at('2026-11-17T06:30:00Z'))).toBe('2026-11-16');
    expect(dayAt([version(FIRST_DAY, 4)], at('2026-11-17T09:00:00Z'))).toBe('2026-11-17');
    expect(dayAt([version(FIRST_DAY, 0)], at('2026-11-17T06:30:00Z'))).toBe('2026-11-17');
  });

  it('uses the account’s zone, not the device’s', () => {
    // 23:00 UTC on Nov 16 is already Nov 17 in Tokyo and still Nov 16 in New York.
    expect(dayAt([version(FIRST_DAY, 0, 'Asia/Tokyo')], at('2026-11-16T23:00:00Z'))).toBe('2026-11-17');
    expect(dayAt([version(FIRST_DAY, 0, NY)], at('2026-11-16T23:00:00Z'))).toBe('2026-11-16');
  });

  it('follows the zone’s wall clock across daylight saving changes', () => {
    // Nov 1, 2026: clocks fall back at 2 AM. 3:30 AM EST is 08:30 UTC.
    expect(dayIn(at('2026-11-01T07:30:00Z'), { timeZone: NY, startHour: 4 })).toBe('2026-10-31'); // 2:30 AM EST
    expect(dayIn(at('2026-11-01T09:00:00Z'), { timeZone: NY, startHour: 4 })).toBe('2026-11-01'); // 4:00 AM EST
  });

  it('moves a later day start in at the next reset, making one long day rather than two', () => {
    const versions = [version(FIRST_DAY, 0), version('2026-11-17', 4)];
    expect(dayAt(versions, at('2026-11-17T04:59:00Z'))).toBe('2026-11-16'); // 11:59 PM
    expect(dayAt(versions, at('2026-11-17T07:00:00Z'))).toBe('2026-11-16'); // 2 AM, still the long day
    expect(dayAt(versions, at('2026-11-17T09:00:00Z'))).toBe('2026-11-17'); // 4 AM
  });

  it('moves an earlier day start in without splitting the current day', () => {
    // At 1 AM on Nov 17 with a 4 AM start, the day is still Nov 16. Midnight can only govern from Nov 18.
    const before = [version(FIRST_DAY, 4)];
    const instant = at('2026-11-17T06:00:00Z');
    expect(nextEffectiveDay(before, { timeZone: NY, startHour: 0 }, instant)).toBe('2026-11-18');
    const versions = versionsOf(firstDaySettings({ timeZone: NY, startHour: 4 }), changeDaySettings(before, { timeZone: NY, startHour: 0 }, instant));
    expect(dayAt(versions, instant)).toBe('2026-11-16');
    expect(dayAt(versions, at('2026-11-17T10:00:00Z'))).toBe('2026-11-17');
    expect(dayAt(versions, at('2026-11-18T05:00:00Z'))).toBe('2026-11-18'); // midnight Nov 18
  });

  it('never moves backwards or skips a day hour by hour through a change', () => {
    const versions = [version(FIRST_DAY, 4), version('2026-11-17', 0, 'Asia/Tokyo')];
    let previous = dayAt(versions, at('2026-11-15T00:00:00Z'));
    for (let t = at('2026-11-15T00:00:00Z'); t < at('2026-11-20T00:00:00Z'); t += 15 * 60_000) {
      const day = dayAt(versions, t);
      expect(daysBetween(previous, day)).toBeGreaterThanOrEqual(0);
      expect(daysBetween(previous, day)).toBeLessThanOrEqual(1);
      previous = day;
    }
  });

  it('applies changes from the next reset and lets the latest pending change win', () => {
    const now = at('2026-11-16T20:00:00Z'); // 3 PM on Nov 16
    const first = [version(FIRST_DAY, 0)];
    const [change] = changeDaySettings(first, { timeZone: NY, startHour: 4 }, now);
    expect(change).toMatchObject({ entity: 'day', id: '2026-11-17', data: { effectiveDay: '2026-11-17', timeZone: NY, startHour: 4 } });
    expect(dayAt([...first, change.data as DayData], now)).toBe('2026-11-16');
    const queued = [...first, version('2026-11-17', 4), version('2026-11-18', 6)];
    const again = changeDaySettings(queued, { timeZone: NY, startHour: 5 }, now);
    expect(again.map((r) => [r.id, (r.data as DayData).startHour])).toEqual([['2026-11-17', 5], ['2026-11-18', 5]]);
  });

  it('reports the settings that govern a day and labels hours', () => {
    const versions = [version(FIRST_DAY, 0), version('2026-11-17', 4)];
    expect(settingsOn(versions, '2026-11-16').startHour).toBe(0);
    expect(settingsOn(versions, '2026-11-17').startHour).toBe(4);
    expect([0, 4, 12, 23].map(hourLabel)).toEqual(['midnight', '4 AM', 'noon', '11 PM']);
  });

  it('works without any settings yet, using this device at midnight', () => {
    expect(dayAt([], at('2026-11-16T12:00:00Z'))).toMatch(/^2026-11-1[67]$/);
    expect(settingsOn([], '2026-11-16')).toMatchObject({ effectiveDay: FIRST_DAY, startHour: 0 });
  });

  it('does day arithmetic in UTC', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-14', '2026-11-18')).toBe(4);
    expect(weekdayOf('2026-11-16')).toBe(1);
    expect(weekdayOf('2026-11-22')).toBe(0);
  });
});

describe('wall-clock times in the account zone', () => {
  it('turns a New York date and time into the instant and back', () => {
    const instant = zonedInstant('2026-11-17', '17:30', NY);
    expect(new Date(instant).toISOString()).toBe('2026-11-17T22:30:00.000Z');
    expect(wallTime(instant, NY)).toEqual({ day: '2026-11-17', time: '17:30' });
  });

  it('handles both sides of daylight saving', () => {
    expect(new Date(zonedInstant('2026-07-01', '09:00', NY)).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    // 2:30 AM doesn't exist on March 8, 2026; it moves past the jump.
    expect(new Date(zonedInstant('2026-03-08', '02:30', NY)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 1:30 AM happens twice on November 1, 2026; the first one wins.
    expect(new Date(zonedInstant('2026-11-01', '01:30', NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

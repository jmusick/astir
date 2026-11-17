import type { DayData, SyncRecord } from './types';

// The one place that decides what "today" is (D6, D30). The account's day settings are synced
// `day` records, versioned by the day they take effect (D34), so every device computes the same
// day from its own clock, offline too, with no server cron.

/** The first version's effective day: it covers everything before any later change. */
export const FIRST_DAY = '0001-01-01';
export type DaySettings = Pick<DayData, 'timeZone' | 'startHour'>;

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(instant: number, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    const zone = isTimeZone(timeZone) ? timeZone : deviceTimeZone();
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    formatters.set(timeZone, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) parts[part.type] = part.value;
  return { day: `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const earlier = (a: string, b: string) => a < b ? a : b;
const later = (a: string, b: string) => a > b ? a : b;

/** The day an instant belongs to under one set of settings, by the zone's wall clock. */
export function dayIn(instant: number, settings: DaySettings): string {
  const { day, hour } = wallClock(instant, settings.timeZone);
  return hour < settings.startHour ? addDays(day, -1) : day;
}

/** Before the account has any day settings: this device's zone, resetting at midnight. */
export const defaultSettings = (): DayData => ({ effectiveDay: FIRST_DAY, timeZone: deviceTimeZone(), startHour: 0 });

/** The live day-settings versions among synced records, oldest first. */
export function dayVersions(records: ReadonlyMap<string, SyncRecord>): DayData[] {
  const versions: DayData[] = [];
  for (const record of records.values()) {
    if (record.entity === 'day' && !record.deleted && record.data) versions.push(record.data as DayData);
  }
  return versions.sort((a, b) => a.effectiveDay.localeCompare(b.effectiveDay));
}

/**
 * The account day an instant belongs to. A version takes over only once its own settings have
 * reached its effective day; until then the previous version runs, held back to the day before.
 * So a change from midnight to 4 AM makes one 28-hour day, and nothing is split or counted twice.
 */
export function dayAt(versions: readonly DayData[], instant: number = Date.now()): string {
  if (!versions.length) return dayIn(instant, defaultSettings());
  let cap: string | null = null;
  for (let i = versions.length - 1; i >= 0; i--) {
    const version = versions[i];
    const day = dayIn(instant, version);
    if (day >= version.effectiveDay || i === 0) return cap ? earlier(day, cap) : day;
    cap = addDays(version.effectiveDay, -1);
  }
  throw new Error('unreachable');
}

/** The settings in effect on a day: the latest version effective on or before it. */
export function settingsOn(versions: readonly DayData[], day: string): DayData {
  let best = versions[0];
  for (const version of versions) if (version.effectiveDay <= day) best = version;
  return best ?? defaultSettings();
}

/** The first day new settings can govern without splitting today: the one after the next reset (D34). */
export function nextEffectiveDay(versions: readonly DayData[], next: DaySettings, instant: number = Date.now()): string {
  return addDays(later(dayAt(versions, instant), dayIn(instant, next)), 1);
}

const record = (data: DayData): SyncRecord => ({ entity: 'day', id: data.effectiveDay, editedAt: 0, deleted: false, data });

/** The account's first day settings, covering every earlier day. */
export const firstDaySettings = (settings: DaySettings): SyncRecord[] => [record({ effectiveDay: FIRST_DAY, ...settings })];

/**
 * A change to the time zone or day-start hour, effective from the next reset (D34). Versions
 * already queued for later days are rewritten too, so the latest choice is the one that sticks.
 */
export function changeDaySettings(versions: readonly DayData[], next: DaySettings, instant: number = Date.now()): SyncRecord[] {
  const effectiveDay = nextEffectiveDay(versions, next, instant);
  const settings = { timeZone: next.timeZone, startHour: next.startHour };
  return [
    record({ effectiveDay, ...settings }),
    ...versions.filter((v) => v.effectiveDay > effectiveDay).map((v) => record({ ...v, ...settings })),
  ];
}

/** "midnight", "4 AM", "noon", "11 PM" */
export function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** 0 (Sunday) to 6 (Saturday) for a YYYY-MM-DD day, independent of the device's time zone. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** A friendly heading for a day, such as "Monday, November 16". */
export function dayLabel(day: string, locale?: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

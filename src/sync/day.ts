// The one place that decides what "today" is.
// For now it is the device's local calendar date. Issue #5 replaces this with the account's
// time zone and day-start hour (D6, D30); callers only ever ask this module.
export function currentDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 0 (Sunday) to 6 (Saturday) for a YYYY-MM-DD day, independent of the device's time zone. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** A friendly heading for a day, such as "Monday, November 16". */
export function dayLabel(day: string, locale?: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

import { addDays, weekdayOf } from './day';
import type { ItemData, ScheduleData } from './types';

// Repeats and the missed setting for daily tasks (D51, D52). Both live in schedule versions, so a
// change takes effect from the day its version does and past days keep what applied then (D40).
// Pure, like daily.ts.

export type Missed = 'drop' | 'carry';

/** What a daily task does when missed, before any version says: v1's behavior for each kind (D52, D68). */
export const defaultMissed = (kind: ItemData['kind']): Missed => kind === 'habit' ? 'drop' : 'carry';

/** An item's versions, oldest first. */
export const sortedVersions = (versions: readonly ScheduleData[] | undefined) =>
  [...versions ?? []].sort((a, b) => a.effectiveDay < b.effectiveDay ? -1 : a.effectiveDay > b.effectiveDay ? 1 : 0);

/** The weekdays it repeats on in the version in effect on a day; empty when it doesn't repeat. */
export function weekdaysOn(sorted: readonly ScheduleData[], day: string): number[] {
  let weekdays: number[] = [];
  for (const version of sorted) { if (version.effectiveDay > day) break; weekdays = version.weekdays; }
  return weekdays;
}

/**
 * The missed setting in effect on a day. A version without one keeps the one before it, so a
 * version written by a client that predates the setting doesn't change it (D72).
 */
export function missedOn(kind: ItemData['kind'], sorted: readonly ScheduleData[], day: string): Missed {
  let missed = defaultMissed(kind);
  for (const version of sorted) { if (version.effectiveDay > day) break; if (version.missed) missed = version.missed; }
  return missed;
}

/** Whether a daily task has a fresh occurrence on a day from its repeat (not its one-off first day). */
export function repeatsOn(data: ItemData, sorted: readonly ScheduleData[], day: string): boolean {
  const first = data.kind === 'habit' ? data.createdDay : data.originalDay;
  if (!first || day < first) return false;
  // A one-off's own day is its first occurrence; its repeats start after it (D51).
  if (data.kind === 'today' && day === first) return false;
  return weekdaysOn(sorted, day).includes(weekdayOf(day));
}

/**
 * The first day after `from` whose missed setting is drop, which ends a carry that began then; null
 * while it keeps carrying. "Switching to drop ends the carry at the next reset."
 */
export function carryEnds(kind: ItemData['kind'], sorted: readonly ScheduleData[], from: string): string | null {
  const next = addDays(from, 1);
  if (missedOn(kind, sorted, next) === 'drop') return next;
  for (const version of sorted) {
    if (version.effectiveDay > next && missedOn(kind, sorted, version.effectiveDay) === 'drop') return version.effectiveDay;
  }
  return null;
}

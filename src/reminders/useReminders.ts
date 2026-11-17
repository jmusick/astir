import { useEffect, useRef } from 'react';
import { dayVersions } from '../sync/day';
import type { SyncEngine } from '../sync/engine';
import { catchUpFrom, dismissed, remindersDue } from '../sync/reminders';
import type { DueReminder } from '../sync/reminders';
import { createNotifier, lastReminderCheck, nativeReminders, saveReminderCheck } from '../platform/notifier';
import { notificationsSupported } from './permission';

// Reminders, with one set of rules (D42) and two ways to deliver them (src/platform/notifier.ts).
// In a browser tab (D16) every tick looks back to the previous one, never further than GRACE_MS,
// so a reminder that passed while no tab was open (or the computer slept) isn't shown later; hidden
// tabs' timers are throttled to about once a minute, which the grace covers. The Windows app runs
// from the tray and remembers its last check, so on the next launch or wake it shows a reminder it
// missed once, as long as it's still the same day (D36).
const TICK_MS = 15_000;
const GRACE_MS = 2 * 60_000;
const PULL_WAIT_MS = 3_000;

const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function useReminders(engine: SyncEngine | null, accountId: string, onOpen: (reminder: DueReminder) => void) {
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; });

  useEffect(() => {
    if (!engine || (!nativeReminders() && !notificationsSupported())) return;
    const notifier = createNotifier();
    const versions = () => dayVersions(engine.getSnapshot().records);
    let last = notifier.native ? catchUpFrom(versions(), lastReminderCheck(accountId), Date.now()) : Date.now();
    let checking = false;
    let stopped = false;
    const due = (from: number, to: number) => remindersDue(engine.getSnapshot().records, versions(), from, to);

    function show(reminder: DueReminder, now: number) {
      let settled = false;
      // Clicking or closing it dismisses it everywhere; a cleanup on sign-out doesn't.
      const dismiss = () => {
        if (settled || stopped) return;
        settled = true;
        void engine!.change(dismissed(reminder)).catch(() => undefined);
      };
      const late = now - reminder.at > GRACE_MS;
      void notifier.show(`astir:${reminder.id}:${reminder.reminder}`, reminder.item.data!.title,
        `${late ? 'Missed reminder' : 'Reminder'} · ${timeLabel(reminder.at)}`,
        { onOpen: () => { openRef.current(reminder); dismiss(); }, onDismiss: dismiss });
    }

    async function check() {
      if (checking || stopped) return;
      checking = true;
      try {
        const now = Date.now();
        // Native: everything since the last check, back to the start of today at most.
        const from = notifier.native ? catchUpFrom(versions(), last, now) : Math.max(last, now - GRACE_MS);
        last = now;
        if (notifier.native) saveReminderCheck(accountId, now);
        if (!notifier.ready() || !due(from, now).length) return;
        // A quick pull first, so a reminder another device just dismissed is skipped here (D42).
        await Promise.race([engine!.sync().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, PULL_WAIT_MS))]);
        if (stopped) return;
        for (const reminder of due(from, now)) show(reminder, now);
      } finally { checking = false; }
    }

    const timer = setInterval(() => void check(), TICK_MS);
    const visible = () => void check();
    document.addEventListener('visibilitychange', visible);
    // The app catches up straight away; the first sync may bring dismissals, which check() waits for.
    if (notifier.native) void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      notifier.stop();
    };
  }, [engine, accountId]);
}

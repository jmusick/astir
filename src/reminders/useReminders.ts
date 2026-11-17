import { useEffect, useRef } from 'react';
import { dayVersions } from '../sync/day';
import type { SyncEngine } from '../sync/engine';
import { dismissed, remindersDue } from '../sync/reminders';
import type { DueReminder } from '../sync/reminders';
import { notificationsSupported } from './permission';

// Web reminders (D16): shown only while an Astir tab is open, with no Web Push. Every tick looks
// back to the previous one, never further than GRACE_MS, so a reminder that passed while no tab was
// open (or the computer slept) isn't shown later. Hidden tabs' timers are throttled to about once a
// minute, which the grace covers.
const TICK_MS = 15_000;
const GRACE_MS = 2 * 60_000;
const PULL_WAIT_MS = 3_000;

const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function useReminders(engine: SyncEngine | null, onOpen: (reminder: DueReminder) => void) {
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; });

  useEffect(() => {
    if (!engine || !notificationsSupported()) return;
    let last = Date.now();
    let checking = false;
    let stopped = false;
    const shown = new Set<Notification>();
    const due = (from: number, to: number) => {
      const records = engine.getSnapshot().records;
      return remindersDue(records, dayVersions(records), from, to);
    };

    function show(reminder: DueReminder) {
      let settled = false;
      // Clicking or closing it dismisses it everywhere; a cleanup close on sign-out doesn't.
      const dismiss = () => {
        if (settled || stopped) return;
        settled = true;
        void engine!.change(dismissed(reminder)).catch(() => undefined);
      };
      let notification: Notification;
      try {
        // The tag makes several open tabs show one notification for the same reminder.
        notification = new Notification(reminder.item.data!.title, {
          body: `Reminder · ${timeLabel(reminder.at)}`, tag: `astir:${reminder.id}:${reminder.reminder}`,
          // Stays until the user clicks or closes it, so a close is always theirs, never a timeout.
          requireInteraction: true,
        });
      } catch { return; } // Some mobile browsers allow notifications only from a service worker.
      shown.add(notification);
      notification.onclick = () => {
        window.focus();
        openRef.current(reminder);
        dismiss();
        notification.close();
      };
      notification.onclose = () => { shown.delete(notification); dismiss(); };
    }

    async function check() {
      if (checking || stopped) return;
      checking = true;
      try {
        const now = Date.now();
        const from = Math.max(last, now - GRACE_MS);
        last = now;
        if (Notification.permission !== 'granted' || !due(from, now).length) return;
        // A quick pull first, so a reminder another device just dismissed is skipped here (D42).
        await Promise.race([engine!.sync().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, PULL_WAIT_MS))]);
        if (stopped) return;
        for (const reminder of due(from, now)) show(reminder);
      } finally { checking = false; }
    }

    const timer = setInterval(() => void check(), TICK_MS);
    const visible = () => void check();
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      for (const notification of shown) notification.close();
    };
  }, [engine]);
}

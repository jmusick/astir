import { isApp } from './platform';

// How a due reminder reaches the user. The browser (and, for now, apps other than Windows) uses the
// Notification API while the page is open; the Windows app shows a native toast through its shell,
// which keeps working from the tray (D16, D36). Either way the caller learns whether the user
// clicked it (open the item) or closed it (dismiss it everywhere, D42).

export interface ReminderHandlers { onOpen: () => void; onDismiss: () => void }
export interface ShownReminder { close(): void }
export interface Notifier {
  /** Native notifications need no browser permission and run from the tray. */
  native: boolean;
  /** Whether a reminder can be shown right now (the browser's permission, for the web). */
  ready(): boolean;
  show(tag: string, title: string, body: string, handlers: ReminderHandlers): Promise<ShownReminder | null>;
  stop(): void;
}

export const nativeReminders = () => isApp && typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

function webNotifier(): Notifier {
  const shown = new Set<Notification>();
  return {
    native: false,
    ready: () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
    async show(tag, title, body, { onOpen, onDismiss }) {
      let notification: Notification;
      try {
        // The tag makes several open tabs show one notification for the same reminder. It stays until
        // the user clicks or closes it, so a close is always theirs, never a timeout.
        notification = new Notification(title, { body, tag, requireInteraction: true });
      } catch { return null; } // Some mobile browsers allow notifications only from a service worker.
      shown.add(notification);
      notification.onclick = () => { window.focus(); onOpen(); notification.close(); };
      notification.onclose = () => { shown.delete(notification); onDismiss(); };
      return { close: () => notification.close() };
    },
    stop() { for (const notification of shown) notification.close(); },
  };
}

function windowsNotifier(): Notifier {
  const handlers = new Map<string, ReminderHandlers>();
  const stops: Promise<() => void>[] = [];
  const listen = (event: string, pick: (h: ReminderHandlers) => () => void) => {
    stops.push(import('@tauri-apps/api/event').then(({ listen: on }) => on<string>(event, ({ payload }) => {
      const handler = handlers.get(payload);
      if (!handler) return;
      handlers.delete(payload);
      pick(handler)();
    })));
  };
  listen('astir://reminder-activated', (h) => h.onOpen);
  listen('astir://reminder-dismissed', (h) => h.onDismiss);
  return {
    native: true,
    ready: () => true,
    async show(tag, title, body, reminderHandlers) {
      const { invoke } = await import('@tauri-apps/api/core');
      handlers.set(tag, reminderHandlers);
      try { await invoke('show_reminder', { tag, title, body }); } catch { handlers.delete(tag); return null; }
      // A toast can't be taken back from here; signing out just stops listening for it.
      return { close: () => { handlers.delete(tag); } };
    },
    stop() {
      handlers.clear();
      for (const stop of stops) void stop.then((fn) => fn()).catch(() => undefined);
    },
  };
}

export const createNotifier = (): Notifier => nativeReminders() ? windowsNotifier() : webNotifier();

/** When a native app last checked for reminders, per account, so a restart can catch up (D36). */
const checkedKey = (accountId: string) => `astir-reminders-checked:${accountId}`;
export function lastReminderCheck(accountId: string): number | null {
  try { const value = Number(localStorage.getItem(checkedKey(accountId))); return value > 0 ? value : null; } catch { return null; }
}
export function saveReminderCheck(accountId: string, at: number) {
  try { localStorage.setItem(checkedKey(accountId), String(at)); } catch { /* Storage blocked: no catch-up next time. */ }
}

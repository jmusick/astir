import { useSyncExternalStore } from 'react';

// The browser's notification permission, shared by every component that shows it. It's asked for
// only when the user wants reminders (D42): from the "Turn on notifications" prompt or while setting
// a reminder, never on page load.

export type Permission = NotificationPermission | 'unsupported';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
const read = (): Permission => notificationsSupported() ? Notification.permission : 'unsupported';

let current: Permission = read();
const listeners = new Set<() => void>();
function refresh() {
  const next = read();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

// Site settings can change the permission while the page is open; most browsers report it.
if (notificationsSupported()) {
  void navigator.permissions?.query({ name: 'notifications' }).then((status) => { status.onchange = refresh; }).catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener('visibilitychange', refresh);
  refresh();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.removeEventListener('visibilitychange', refresh);
  };
}

export const useNotificationPermission = () => useSyncExternalStore(subscribe, () => current, () => 'unsupported' as Permission);

/** Asks once. A browser may ignore it outside a click; the prompt on Today is the reliable path. */
export async function requestNotifications(): Promise<void> {
  if (read() !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* Older Safari takes a callback; the prompt button still works. */ }
  refresh();
}

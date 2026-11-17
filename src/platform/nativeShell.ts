import { isApp } from './platform';

// The native shell's features as the shared UI sees them: the taskbar or dock badge, tray events,
// start-at-login, and staying awake in the tray. Every function is a no-op in the browser.

const isWindows = () => typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

/** The text a badge shows for a count: nothing at zero, and "9+" past nine so it stays legible. */
export const badgeText = (count: number) => count <= 0 ? '' : count > 9 ? '9+' : String(Math.floor(count));

/** A small red disc with the count, as PNG bytes, for Windows' taskbar overlay icon. */
async function overlayPng(text: string): Promise<Uint8Array> {
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#c43737';
  context.beginPath(); context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#ffffff';
  context.font = `700 ${text.length > 1 ? 16 : 21}px "Segoe UI", system-ui, sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text, size / 2, size / 2 + 1);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Today's remaining count on the app's taskbar icon (Windows) or dock badge (Mac), cleared at zero. */
export async function setBadge(count: number) {
  if (!isApp) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const text = badgeText(count);
  // Windows has no numeric badge API, only an overlay icon, so draw one.
  if (isWindows()) await getCurrentWindow().setOverlayIcon(text ? await overlayPng(text) : undefined);
  else await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
}

export type ShellEvent = 'quick-add' | 'sync-now';
/** Listen for a tray menu action. Returns a function that stops listening. */
export async function onShellEvent(name: ShellEvent, handler: () => void): Promise<() => void> {
  if (!isApp) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen(`astir://${name}`, handler);
}

/**
 * Keep the hidden window running in the tray. WebView2 throttles and may freeze a hidden page
 * after a few minutes, and Tauri can't turn that off on Windows; a held Web Lock keeps the page
 * from being frozen, so sync, reminders and the rollover carry on (D35).
 */
export function stayAwakeInTray() {
  if (!isApp || !('locks' in navigator)) return;
  void navigator.locks.request('astir-stay-awake', () => new Promise<void>(() => undefined)).catch(() => undefined);
}

export async function startsAtLogin(): Promise<boolean> {
  if (!isApp) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}
export async function setStartsAtLogin(on: boolean) {
  if (!isApp) return;
  const { disable, enable } = await import('@tauri-apps/plugin-autostart');
  await (on ? enable() : disable());
}

const OFFERED = 'astir-autostart-offered';
/** "Start with Windows" is offered once, on first run (D35). */
export function autostartOffered(): boolean {
  try { return localStorage.getItem(OFFERED) === '1'; } catch { return true; }
}
export function markAutostartOffered() {
  try { localStorage.setItem(OFFERED, '1'); } catch { /* Storage blocked: it may ask again. */ }
}

/** "Windows", "Mac" or "Linux", for "Start with …". */
export function systemName(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /Windows/.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/.test(userAgent) ? 'your Mac' : 'your computer';
}

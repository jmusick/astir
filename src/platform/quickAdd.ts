import { isApp } from './platform';

// Quick add from anywhere (D35): a system-wide shortcut opens a small box window that adds a task
// to today. The main window registers the shortcut and saves the task, so the account's engine
// and SQLite file stay in one webview; the box only sends the title over.

export const QUICK_ADD_WINDOW = 'quick-add';
export const SUBMIT_EVENT = 'astir://quick-add-submit';
export const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+Space';
const KEY = 'astir-quick-add-shortcut';

/** The shortcut chosen on this device (shortcuts are per computer, not per account). */
export function chosenShortcut(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_SHORTCUT; } catch { return DEFAULT_SHORTCUT; }
}
function saveShortcut(shortcut: string) {
  try { localStorage.setItem(KEY, shortcut); } catch { /* Storage blocked: the default returns next start. */ }
}

/** "Ctrl+Alt+Space" for people; the plugin's accelerators say CommandOrControl. */
export function shortcutLabel(shortcut: string, mac = typeof navigator !== 'undefined' && /Mac OS X|Macintosh/.test(navigator.userAgent)): string {
  return shortcut.split('+').map((part) => part === 'CommandOrControl' ? (mac ? 'Cmd' : 'Ctrl')
    : part === 'Super' ? (mac ? 'Cmd' : 'Win') : part === 'Alt' && mac ? 'Option' : part).join('+');
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
/**
 * The accelerator for a key press in the "choose a shortcut" field, or null while only modifiers
 * are held or the combination is too easy to hit by accident (it needs Ctrl, Alt or Win).
 */
export function shortcutFromKey(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const { code } = event;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return null;
  return [event.ctrlKey && 'CommandOrControl', event.metaKey && 'Super', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

// What Settings shows: the shortcut in use and, if registering it failed, why.
type Status = { shortcut: string; taken: boolean };
let status: Status = { shortcut: DEFAULT_SHORTCUT, taken: false };
const listeners = new Set<() => void>();
export const quickAddStatus = () => status;
export function onQuickAddStatus(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function setStatus(next: Status) { status = next; for (const listener of listeners) listener(); }

let registered: string | null = null;
let onPress: (() => void) | null = null;

/** Register a shortcut in place of the current one. False (and the old one kept) if another app has it. */
async function register(shortcut: string): Promise<boolean> {
  const plugin = await import('@tauri-apps/plugin-global-shortcut');
  const previous = registered;
  if (previous) await plugin.unregister(previous).catch(() => undefined);
  try {
    await plugin.register(shortcut, (event) => { if (event.state === 'Pressed') onPress?.(); });
    registered = shortcut;
    return true;
  } catch {
    // Taken by another app (or invalid). Put the previous one back.
    if (previous) await plugin.register(previous, (event) => { if (event.state === 'Pressed') onPress?.(); }).then(() => { registered = previous; }, () => { registered = null; });
    else registered = null;
    return false;
  }
}

/** Start listening for this device's shortcut. Returns a function that stops. App only. */
export async function startQuickAdd(press: () => void): Promise<() => void> {
  if (!isApp) return () => undefined;
  onPress = press;
  const shortcut = chosenShortcut();
  const ok = await register(shortcut);
  setStatus({ shortcut, taken: !ok });
  return () => {
    onPress = null;
    const current = registered;
    registered = null;
    if (current) void import('@tauri-apps/plugin-global-shortcut').then((plugin) => plugin.unregister(current)).catch(() => undefined);
  };
}

/** Switch to a new shortcut from Settings. Keeps the old one if the new one is taken. */
export async function changeShortcut(shortcut: string): Promise<boolean> {
  if (!isApp) return false;
  const ok = await register(shortcut);
  if (ok) { saveShortcut(shortcut); setStatus({ shortcut, taken: false }); }
  return ok;
}

/** Show the quick-add box over whatever app is in front. */
export async function showQuickAddBox() {
  if (!isApp) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const box = await WebviewWindow.getByLabel(QUICK_ADD_WINDOW);
  if (!box) return;
  await box.center().catch(() => undefined);
  await box.show();
  await box.setFocus();
}

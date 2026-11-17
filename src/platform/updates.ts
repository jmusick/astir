import { isApp } from './platform';

// Silent updates (D38). The app checks GitHub Releases at launch and every few hours and downloads
// a new version in the background. It installs (the per-user installer runs quietly, no admin
// prompt) and restarts on its own when nobody is looking: right after launch, or once the window
// has sat closed in the tray for a while. "Restart to update" lets anyone do it sooner. Every edit
// is already saved locally, so a restart loses nothing. If anything fails, the running version
// carries on and the next check tries again.

export const CHECK_EVERY_MS = 4 * 60 * 60_000;
export const IDLE_IN_TRAY_MS = 10 * 60_000;
export const LAUNCH_WINDOW_MS = 2 * 60_000;

export type UpdatePhase = 'none' | 'ready' | 'installing';
type Ready = { version: string; install: () => Promise<void> };

/** Whether a downloaded update should install now, without asking. */
export function shouldInstall(now: number, launchedAt: number, hiddenSince: number | null): boolean {
  return now - launchedAt <= LAUNCH_WINDOW_MS || (hiddenSince !== null && now - hiddenSince >= IDLE_IN_TRAY_MS);
}

let phase: UpdatePhase = 'none';
let ready: Ready | null = null;
let busy = false;
const listeners = new Set<() => void>();
const set = (next: UpdatePhase) => { phase = next; for (const listener of listeners) listener(); };
export const updatePhase = () => phase;
export const readyVersion = () => ready?.version ?? null;
export function onUpdatePhase(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Install the downloaded update and restart into it. */
export async function installUpdate() {
  if (!ready || phase === 'installing') return;
  set('installing');
  try {
    await ready.install();
    // Windows hands over to the installer and exits during install(); elsewhere, restart here.
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    // Keep running this version; the next check downloads it again.
    ready = null;
    set('none');
  }
}

async function checkAndDownload() {
  if (busy || ready) return;
  busy = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;
    await update.download();
    ready = { version: update.version, install: () => update.install() };
    set('ready');
  } catch { /* Offline, GitHub unreachable or a bad download: try again at the next check. */ }
  finally { busy = false; }
}

/** Start checking for updates. Returns a function that stops. App only; call once. */
export function startUpdates(now: () => number = Date.now): () => void {
  if (!isApp || import.meta.env.DEV) return () => undefined;
  const launchedAt = now();
  let hiddenSince: number | null = document.visibilityState === 'hidden' ? launchedAt : null;
  const consider = () => { if (phase === 'ready' && shouldInstall(now(), launchedAt, hiddenSince)) void installUpdate(); };
  const visibility = () => { hiddenSince = document.visibilityState === 'hidden' ? (hiddenSince ?? now()) : null; consider(); };
  const run = () => void checkAndDownload().then(consider);
  run();
  const checks = setInterval(run, CHECK_EVERY_MS);
  const idle = setInterval(consider, 60_000);
  document.addEventListener('visibilitychange', visibility);
  return () => { clearInterval(checks); clearInterval(idle); document.removeEventListener('visibilitychange', visibility); };
}

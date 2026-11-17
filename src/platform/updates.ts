import { isApp } from './platform';
import type { Update } from '@tauri-apps/plugin-updater';

// Silent updates (D38). The app checks GitHub Releases at launch and every few hours and downloads
// a new version in the background. It installs (the per-user installer runs quietly, no admin
// prompt) and restarts on its own when nobody is looking: right after launch, or once the window
// has sat closed in the tray for a while. "Restart to update" lets anyone do it sooner. Every edit
// is already saved locally, so a restart loses nothing. If anything fails, the running version
// carries on and the next check tries again.

export const CHECK_EVERY_MS = 4 * 60 * 60_000;
export const IDLE_IN_TRAY_MS = 10 * 60_000;
export const LAUNCH_WINDOW_MS = 2 * 60_000;

export type UpdatePhase = 'none' | 'checking' | 'downloading' | 'current' | 'ready' | 'installing' | 'error';

/** Whether a downloaded update should install now, without asking. */
export function shouldInstall(now: number, launchedAt: number, hiddenSince: number | null): boolean {
  return now - launchedAt <= LAUNCH_WINDOW_MS || (hiddenSince !== null && now - hiddenSince >= IDLE_IN_TRAY_MS);
}

let phase: UpdatePhase = 'none';
let ready: Update | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (next: UpdatePhase) => { phase = next; for (const listener of listeners) listener(); };
export const updatePhase = () => phase;
export const readyVersion = () => ready?.version ?? null;
export function onUpdatePhase(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Install the downloaded update and restart into it. */
export async function installUpdate() {
  if (!ready || phase === 'installing') return;
  const update = ready;
  set('installing');
  try {
    await update.install();
    // Windows hands over to the installer and exits during install(); elsewhere, restart here.
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    // Keep running this version; the next check downloads it again.
    ready = null;
    await update.close().catch(() => undefined);
    set('error');
  }
}

function checkAndDownload(): Promise<void> {
  // A manual request joins an automatic check already in flight, including its download.
  if (checking) return checking;
  if (ready || phase === 'installing') return Promise.resolve();
  set('checking');
  checking = (async () => {
    let update: Update | null = null;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      update = await check({ timeout: 30_000 });
      if (!update) { set('current'); return; }
      set('downloading');
      await update.download();
      ready = update;
      set('ready');
    } catch {
      await update?.close().catch(() => undefined);
      set('error');
    }
  })().finally(() => { checking = null; });
  return checking;
}

/** Check, download and install now at the user's request, even while the window is open. */
export async function checkForUpdates() {
  if (!isApp || import.meta.env.DEV || phase === 'installing') return;
  await checkAndDownload();
  if (ready) await installUpdate();
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

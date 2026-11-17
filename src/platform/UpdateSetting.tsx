import { useSyncExternalStore } from 'react';
import { isApp } from './platform';
import { checkForUpdates, onUpdatePhase, updatePhase } from './updates';

/** A manual check uses the same signed, quiet updater as the background checks. */
export default function UpdateSetting() {
  const phase = useSyncExternalStore(onUpdatePhase, updatePhase);
  if (!isApp) return null;
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const message = import.meta.env.DEV ? 'Updates are available in installed builds.'
    : phase === 'checking' ? 'Checking for updates…'
    : phase === 'downloading' ? 'Downloading an update…'
    : phase === 'installing' ? 'Updating Astir. It will restart automatically…'
    : phase === 'current' ? 'Astir is up to date.'
    : phase === 'error' ? 'Could not update Astir. Check your connection and try again.'
    : phase === 'ready' ? 'An update is downloaded and ready to install.' : '';

  return <section className="settings-section" aria-labelledby="updates-heading">
    <h2 id="updates-heading">App updates</h2>
    <p>Check for a new version and install it automatically. Astir restarts to finish the update; your tasks are saved.</p>
    <p><button type="button" className="quiet" disabled={busy || import.meta.env.DEV}
      aria-describedby="updates-message" onClick={() => void checkForUpdates()}>
      {phase === 'checking' ? 'Checking…' : phase === 'downloading' ? 'Downloading…'
        : phase === 'installing' ? 'Updating…' : 'Check for updates'}
    </button></p>
    <p id="updates-message" className={phase === 'error' ? 'form-error' : 'hint'} role="status">{message}</p>
  </section>;
}

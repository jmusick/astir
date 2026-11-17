import { useEffect, useSyncExternalStore } from 'react';
import { isApp } from './platform';
import { installUpdate, onUpdatePhase, readyVersion, startUpdates, updatePhase } from './updates';

/** Keeps the app up to date, and offers "Restart to update" once a new version is downloaded (D38). */
export default function UpdateBanner() {
  const phase = useSyncExternalStore(onUpdatePhase, updatePhase);
  useEffect(() => startUpdates(), []);
  if (!isApp || phase === 'none') return null;
  return <div className="update-banner" role="status">
    {phase === 'installing' ? <span>Updating Astir…</span> : <>
      <span>Astir {readyVersion()} is ready. It installs by itself while Astir is in the tray.</span>
      <button type="button" className="quiet" onClick={() => void installUpdate()}>Restart to update</button>
    </>}
  </div>;
}

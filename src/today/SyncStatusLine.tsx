import type { SyncStatus } from '../sync/engine';

// A quiet line, never an error wall: offline work is normal (spec, "The server or D1 is down").
export default function SyncStatusLine({ status, localOnly, onRetry }: { status: SyncStatus; localOnly: boolean; onRetry: () => void }) {
  if (status.state === 'rejected' || status.state === 'signed-out') {
    return <footer className="sync problem" role="alert">
      <p>{status.message}</p>
      {status.state === 'rejected'
        ? <p>Your changes are saved on this device. Adjust them, or <button type="button" className="link" onClick={onRetry}>try again</button>.</p>
        : <p><a href="/">Sign in again</a> to sync.</p>}
    </footer>;
  }
  const unsynced = status.pending > 0;
  const text = status.state === 'syncing' ? 'Syncing…'
    : status.state === 'offline' ? 'Saved on this device · not synced yet'
      : unsynced ? 'Saved on this device' : 'All changes synced';
  return <footer className="sync" role="status">
    <span className={`dot ${status.state === 'offline' ? 'off' : unsynced ? 'wait' : 'ok'}`} aria-hidden="true" />
    <span>{text}</span>
    {status.state === 'offline' && <button type="button" className="link" onClick={onRetry}>Retry now</button>}
    {status.message && <span className="sync-warning">{status.message}</span>}
    {localOnly && <span className="sync-warning">This browser can’t keep data offline, so keep the tab open until it syncs.</span>}
  </footer>;
}

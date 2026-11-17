import type { SyncStatus } from '../sync/engine';

// A quiet line, never an error wall: offline work is normal (spec, "The server or D1 is down").
interface Props { status: SyncStatus; localOnly: boolean; onRetry: () => void; onExport: () => void }
export default function SyncStatusLine({ status, localOnly, onRetry, onExport }: Props) {
  if (status.state === 'rejected' || status.state === 'signed-out') {
    return <footer className="sync problem" role="alert">
      <p>{status.message}</p>
      {status.state === 'rejected'
        ? <p>Your changes are saved on this device. Adjust them, or <button type="button" className="link" onClick={onRetry}>try again</button>.</p>
        // A revoked or expired sign-in keeps local data until the next sign-in, with a copy on offer first.
        : <p><a href="/">Sign in again</a> to sync, or <button type="button" className="link" onClick={onExport}>download a copy</button> of what’s on this device.</p>}
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

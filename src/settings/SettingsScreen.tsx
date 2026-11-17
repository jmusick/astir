import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authApi } from '../authApi';
import type { Account, Device } from '../authApi';
import { addDays, changeDaySettings, dayLabel, hourLabel, settingsOn } from '../sync/day';
import type { SyncEngine } from '../sync/engine';
import type { DayData, SyncRecord } from '../sync/types';
import DaySettingsForm from './DaySettingsForm';
import { exportNow, lastActive } from './accountData';
import { openInBrowser } from '../platform/appSignIn';
import { isApp, webUrl } from '../platform/platform';
import { StartAtLoginSetting } from '../platform/StartAtLogin';
import QuickAddSetting from '../platform/QuickAddSetting';
import AppearanceSetting from './AppearanceSetting';

const CONFIRM_WORD = 'DELETE';

interface Props {
  account: Account;
  engine: SyncEngine;
  versions: readonly DayData[];
  /** The account's current day. */
  day: string;
  save: (records: SyncRecord[]) => void;
  signOut: () => void;
  signingOut: boolean;
  /** The account is gone from the server; the caller clears this device. */
  onDeleted: () => Promise<void>;
}

function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    authApi('devices').then((data) => { if (live) setDevices(data.devices ?? []); })
      .catch((err: unknown) => { if (live) setError(err instanceof Error && (err as { status?: number }).status ? err.message : 'Connect to the internet to see your devices.'); });
    return () => { live = false; };
  }, [attempt]);
  const load = () => { setError(''); setAttempt((n) => n + 1); };

  async function revoke(device: Device) {
    if (!window.confirm(`Sign out ${device.name}? Anything it hasn’t synced yet stays on it until someone signs in there again.`)) return;
    setBusy(device.id); setError('');
    try {
      await authApi('devices/revoke', { id: device.id });
      setDevices((list) => list?.filter((d) => d.id !== device.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out that device.');
    } finally { setBusy(''); }
  }

  return <section className="settings-section" aria-labelledby="devices-heading">
    <h2 id="devices-heading">Signed-in devices</h2>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="link" onClick={load}>Try again</button></p>}
    {!devices && !error && <p role="status">Loading devices…</p>}
    {devices && <ul className="devices">
      {devices.map((device) => <li key={device.id}>
        <div>
          <span><strong>{device.name}</strong>{device.current && <span className="this-device"> · {isApp ? 'This app' : 'This browser'}</span>}</span>
          <span className="hint">{device.current ? 'Active now' : lastActive(device.lastActiveAt)} · signed in {dayLabel(new Date(device.createdAt).toISOString().slice(0, 10))}</span>
        </div>
        {!device.current && <button type="button" className="quiet" disabled={busy === device.id} onClick={() => void revoke(device)}>
          {busy === device.id ? 'Signing out…' : 'Sign out'}<span className="visually-hidden"> {device.name}</span>
        </button>}
      </li>)}
    </ul>}
  </section>;
}

function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== CONFIRM_WORD) { setError(`Type ${CONFIRM_WORD} to confirm.`); return; }
    setDeleting(true); setError('');
    try {
      await authApi('delete-account', { password, confirmation });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account. Please try again.');
      setDeleting(false);
      return;
    }
    await onDeleted();
  }

  return <section className="settings-section danger-zone" aria-labelledby="delete-heading">
    <h2 id="delete-heading">Delete your account</h2>
    <p>This deletes your account and everything in it right away: every list, task, habit and day of history. It can’t be undone. Download a copy first if you want one.</p>
    <form className="settings-form" onSubmit={submit}>
      <label>Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label>Type {CONFIRM_WORD} to confirm
        <input value={confirmation} autoComplete="off" spellCheck={false} onChange={(e) => setConfirmation(e.target.value)} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="danger" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete my account'}</button>
    </form>
  </section>;
}

export default function SettingsScreen({ account, engine, versions, day, save, signOut, signingOut, onDeleted }: Props) {
  const upcoming = settingsOn(versions, addDays(day, 1));
  const current = settingsOn(versions, day);
  const pending = upcoming.timeZone !== current.timeZone || upcoming.startHour !== current.startHour;
  const [exporting, setExporting] = useState(false);

  return <section className="settings-screen" aria-labelledby="settings-heading">
    <h1 id="settings-heading">Settings</h1>
    <p className="intro">Signed in as {account.email}</p>

    <AppearanceSetting />

    <section className="settings-section" aria-labelledby="day-heading">
      <h2 id="day-heading">When your day resets</h2>
      <p>Your day follows {current.timeZone.replaceAll('_', ' ')} time and resets at {hourLabel(current.startHour)}.
        {pending && <> From your next reset it follows {upcoming.timeZone.replaceAll('_', ' ')} and resets at {hourLabel(upcoming.startHour)}.</>}</p>
      <DaySettingsForm key={`${upcoming.timeZone} ${upcoming.startHour}`} settings={upcoming}
        onSave={(next) => save(changeDaySettings(versions, next))} />
    </section>

    <QuickAddSetting />

    <StartAtLoginSetting />

    <Devices />

    <section className="settings-section" aria-labelledby="data-heading">
      <h2 id="data-heading">Your data</h2>
      <p>Download every list, item, checkmark and day of history as a JSON file.</p>
      <p><button type="button" className="quiet" disabled={exporting}
        onClick={() => { setExporting(true); void exportNow(engine, account.email).finally(() => setExporting(false)); }}>
        {exporting ? 'Preparing…' : 'Download your data'}</button></p>
    </section>

    <section className="settings-section" aria-labelledby="signout-heading">
      <h2 id="signout-heading">Sign out</h2>
      <p>Signing out syncs first, then removes this account’s data from this {isApp ? 'computer' : 'browser'}.</p>
      <p><button type="button" className="quiet" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></p>
    </section>

    {isApp
      // The app has no password form of its own (D28), so deletion happens on the web.
      ? <section className="settings-section danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete your account</h2>
        <p>Deleting your account removes everything in it right away. You can do it from Settings on the web; this app then clears its copy.</p>
        <p><button type="button" className="quiet" onClick={() => void openInBrowser(webUrl('/#/settings')).catch(() => undefined)}>Open Settings on the web</button></p>
      </section>
      : <DeleteAccount onDeleted={onDeleted} />}
  </section>;
}

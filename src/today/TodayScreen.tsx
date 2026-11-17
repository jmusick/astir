import { useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../authApi';
import type { Account } from '../authApi';
import { forgetAccount } from '../rememberedAccount';
import { newHabit, newTodayTask, progressLabel, removed, renamed, setCompleted, todayView } from '../sync/daily';
import { addDays, changeDaySettings, dayAt, dayLabel, dayVersions, deviceTimeZone, firstDaySettings, hourLabel, settingsOn } from '../sync/day';
import type { DayData, SyncRecord } from '../sync/types';
import { AddHabitForm, AddTaskForm } from './AddForms';
import DaySettingsForm from './DaySettingsForm';
import ItemRow from './ItemRow';
import ProgressRing from './ProgressRing';
import SyncStatusLine from './SyncStatusLine';
import { useSyncEngine } from './useSyncEngine';

const SIGN_OUT_SYNC_MS = 8_000;
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); })])
    .finally(() => clearTimeout(timer));
}

const SKEW_WARN_MS = 5 * 60_000;
const NO_VERSIONS: DayData[] = [];

/** The account's day, rolling over without a reload as the reset passes or the tab comes back. */
function useToday(versions: readonly DayData[]) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return useMemo(() => dayAt(versions, now), [versions, now]);
}

export default function TodayScreen({ account, onSignedOut }: { account: Account; onSignedOut: () => void }) {
  const { engine, snapshot, localOnly } = useSyncEngine(account.id);
  const versions = useMemo(() => snapshot ? dayVersions(snapshot.records) : NO_VERSIONS, [snapshot]);
  const day = useToday(versions);
  const view = useMemo(() => snapshot ? todayView(snapshot.records, day, (editedAt) => dayAt(versions, editedAt)) : null, [snapshot, day, versions]);
  // The next reset is governed by the version in effect tomorrow, which includes a pending change.
  const upcoming = settingsOn(versions, addDays(day, 1));
  const device = deviceTimeZone();
  const [keepZone, setKeepZone] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  // Never awaited by the UI: the snapshot is already updated when change() returns.
  const save = (records: SyncRecord[]) => { void engine?.change(records).catch(() => undefined); };

  // A new account gets this device's zone and a midnight reset, once the server has none (D6).
  const seeded = useRef(false);
  const synced = snapshot?.status.state === 'synced';
  useEffect(() => {
    if (!synced || versions.length || seeded.current) return;
    seeded.current = true;
    void engine?.change(firstDaySettings({ timeZone: deviceTimeZone(), startHour: 0 })).catch(() => undefined);
  }, [engine, synced, versions.length]);
  const skew = snapshot?.clockSkewMs ?? 0;

  async function signOut() {
    if (!engine) return;
    setSigningOut(true); setError('');
    try {
      // D45: sync first, warn about anything that couldn't sync, then wipe this account's local data.
      const unsynced = await withTimeout(engine.flush(), SIGN_OUT_SYNC_MS, () => engine.getSnapshot().status.pending);
      if (unsynced && !window.confirm(`${unsynced === 1 ? '1 change hasn’t' : `${unsynced} changes haven’t`} synced yet. Signing out removes ${unsynced === 1 ? 'it' : 'them'} from this device. Sign out anyway?`)) return;
      await authApi('logout', {});
      forgetAccount();
      // The delete stays queued in IndexedDB even if another tab holds the database open a moment.
      await withTimeout(engine.destroy().catch(() => undefined), 5_000, () => undefined);
      onSignedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out. Please try again.');
    } finally { setSigningOut(false); }
  }

  return <main className="today">
    <header className="topbar">
      <a className="brand" href="/">Astir<span className="brand-dot" aria-hidden="true">●</span></a>
      <div className="account-menu">
        <span className="who">{account.email}</span>
        <button type="button" className="quiet" onClick={signOut} disabled={!engine || signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!view || !engine ? <p role="status" className="intro">Opening your day…</p> : <>
      <section className="hero" aria-labelledby="today-heading">
        <ProgressRing percent={view.percent} />
        <div>
          <p className="date">{dayLabel(day)}</p>
          <h1 id="today-heading">Today</h1>
          <p className="tally">{view.total ? progressLabel(view) : 'Nothing planned yet'}<span className="resets"> · resets at {hourLabel(upcoming.startHour)}</span></p>
          {view.total > 0 && view.done === view.total && <p className="cheer">Everything’s done. Enjoy the rest of your day.</p>}
        </div>
      </section>
      {versions.length > 0 && upcoming.timeZone !== device && !keepZone && <div className="notice zone" role="status">
        <p>This device is on {device.replaceAll('_', ' ')} time, but your day follows {upcoming.timeZone.replaceAll('_', ' ')}.</p>
        <p>
          <button type="button" className="quiet" onClick={() => save(changeDaySettings(versions, { timeZone: device, startHour: upcoming.startHour }))}>Use {device.replaceAll('_', ' ')} from the next reset</button>
          {' '}<button type="button" className="link" onClick={() => setKeepZone(true)}>Keep {upcoming.timeZone.replaceAll('_', ' ')}</button>
        </p>
      </div>}
      {Math.abs(skew) > SKEW_WARN_MS && <p className="notice error" role="alert">
        This device’s clock is about {Math.round(Math.abs(skew) / 60_000)} minutes {skew > 0 ? 'behind' : 'ahead of'} Astir’s. Your day may reset at the wrong time until the clock is corrected.
      </p>}
      {view.isNew && <section className="welcome" aria-label="Get started">
        <h2>Start your first day</h2>
        <p>Add a habit you want to keep, like a walk or ten minutes of reading, and one thing you’ll finish today. Check them off and watch the ring fill.</p>
      </section>}
      <div className="panels">
        <section className="panel habits" aria-labelledby="habits-heading">
          <h2 id="habits-heading">Habits</h2>
          {view.habits.length > 0 ? <ul>
            {view.habits.map(({ item, done }) => <ItemRow key={item.id} item={item} done={done} kind="habit"
              onToggle={(checked) => save(setCompleted(item, day, checked))}
              onRename={(title) => save(renamed(item, title))}
              onDelete={() => save(removed(item))} />)}
          </ul> : <p className="empty">{view.isNew ? 'Habits repeat every day or on the days you choose.' : 'No habits scheduled today.'}</p>}
          <AddHabitForm key={day} day={day} first={view.isNew} onAdd={(title, weekdays) => save(newHabit(crypto.randomUUID(), title, weekdays, day, Date.now()))} />
        </section>
        <section className="panel tasks" aria-labelledby="tasks-heading">
          <h2 id="tasks-heading">Today only</h2>
          {view.tasks.length > 0 ? <ul>
            {view.tasks.map(({ item, done, dayCount }) => <ItemRow key={item.id} item={item} done={done} kind="task" dayCount={dayCount}
              onToggle={(checked) => save(setCompleted(item, day, checked))}
              onRename={(title) => save(renamed(item, title))}
              onDelete={() => save(removed(item))} />)}
          </ul> : <p className="empty">{view.isNew ? 'One-off tasks for today live here.' : 'Nothing else planned for today.'}</p>}
          <AddTaskForm first={view.isNew} onAdd={(title) => save(newTodayTask(crypto.randomUUID(), title, day, Date.now()))} />
        </section>
      </div>
      <DaySettingsForm key={`${upcoming.timeZone} ${upcoming.startHour}`} settings={upcoming}
        onSave={(next) => save(changeDaySettings(versions, next))} />
      <SyncStatusLine status={snapshot!.status} localOnly={localOnly} onRetry={() => void engine.sync()} />
    </>}
  </main>;
}

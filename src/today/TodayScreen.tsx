import { useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../authApi';
import type { Account } from '../authApi';
import { forgetAccount } from '../rememberedAccount';
import { checkedOff, newHabit, newTodayTask, removed, renamed, reorderedToday, repeatLabel, setCompleted, todayBottom, todayView } from '../sync/daily';
import { dueLabel, listSummaries, newList } from '../sync/lists';
import { addDays, changeDaySettings, dayAt, dayLabel, dayVersions, deviceTimeZone, firstDaySettings, hourLabel, settingsOn } from '../sync/day';
import type { DayData, ItemData, SyncRecord } from '../sync/types';
import ListScreen from '../lists/ListScreen';
import ListsNav from '../lists/ListsNav';
import HistoryScreen from '../history/HistoryScreen';
import { listHref, settingsHref, todayHref, useRoute } from '../route';
import SettingsScreen from '../settings/SettingsScreen';
import { StartAtLoginOffer } from '../platform/StartAtLogin';
import { useNativeShell } from '../platform/useNativeShell';
import { exportNow } from '../settings/accountData';
import { FocusItem } from '../reminders/focusItem';
import type { FocusRequest } from '../reminders/focusItem';
import { requestNotifications, useNotificationPermission } from '../reminders/permission';
import { useReminders } from '../reminders/useReminders';
import { AddTodayForm } from './AddForms';
import ItemDetails from './ItemDetails';
import { ItemMeta } from './ItemMeta';
import ItemRow from './ItemRow';
import ProgressRing from './ProgressRing';
import SyncStatusLine from './SyncStatusLine';
import { useSyncEngine } from './useSyncEngine';
import Brand from '../ui/Brand';
import Icon from '../ui/Icon';
import Sortable from '../ui/Sortable';

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

export default function TodayScreen({ account, onSignedOut }: { account: Account; onSignedOut: (notice?: string) => void }) {
  const { engine, snapshot, localOnly } = useSyncEngine(account.id);
  const versions = useMemo(() => snapshot ? dayVersions(snapshot.records) : NO_VERSIONS, [snapshot]);
  const day = useToday(versions);
  const view = useMemo(() => snapshot ? todayView(snapshot.records, day, (editedAt) => dayAt(versions, editedAt)) : null, [snapshot, day, versions]);
  // The next reset is governed by the version in effect tomorrow, which includes a pending change.
  const upcoming = settingsOn(versions, addDays(day, 1));
  // Reminder times are read in the zone governing today (D30, D42).
  const zone = settingsOn(versions, day).timeZone;
  const route = useRoute();
  const lists = useMemo(() => snapshot ? listSummaries(snapshot.records) : [], [snapshot]);
  const device = deviceTimeZone();
  const [keepZone, setKeepZone] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  // Clicking a reminder opens its item: on Today for habits and today-only tasks, in its list otherwise.
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  useReminders(engine, account.id, ({ item }) => {
    window.location.hash = item.data!.kind === 'task' ? listHref(item.data!.listId!) : todayHref;
    setFocus({ itemId: item.id, nonce: Date.now() });
  });
  // Cleared once the item has opened, so it doesn't open again on a later visit to its screen.
  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => setFocus(null), 1_000);
    return () => clearTimeout(timer);
  }, [focus]);
  useNativeShell(engine, view ? view.total - view.done : null, day);
  const permission = useNotificationPermission();
  const [skipPrompt, setSkipPrompt] = useState(false);
  const hasReminders = useMemo(() => {
    if (!snapshot) return false;
    for (const r of snapshot.records.values()) if (r.entity === 'item' && !r.deleted && (r.data as ItemData | null)?.reminder) return true;
    return false;
  }, [snapshot]);

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
  // A list linked by address may not be here until the first sync; offline, what's local is all there is.
  // clockSkewMs is set by the first pull; a failed sync won't bring more soon.
  const state = snapshot?.status.state;
  const everSynced = snapshot?.clockSkewMs != null || state === 'offline' || state === 'rejected' || state === 'signed-out';

  /** Forget this account on this device and wipe its local data (D29, D45). */
  async function clearDevice(notice: string) {
    forgetAccount();
    // The delete stays queued in IndexedDB even if another tab holds the database open a moment.
    if (engine) await withTimeout(engine.destroy().catch(() => undefined), 5_000, () => undefined);
    onSignedOut(notice);
  }

  // Deleted from another device: nothing here can sync again, so say why and clear it (D29).
  const deletedElsewhere = state === 'account-deleted';
  const clearing = useRef(false);
  useEffect(() => {
    if (!deletedElsewhere || clearing.current) return;
    clearing.current = true;
    void clearDevice('This account was deleted, so Astir removed its data from this device.');
  });

  async function signOut() {
    if (!engine) return;
    setSigningOut(true); setError('');
    try {
      // D45: sync first, warn about anything that couldn't sync, then wipe this account's local data.
      const unsynced = await withTimeout(engine.flush(), SIGN_OUT_SYNC_MS, () => engine.getSnapshot().status.pending);
      if (unsynced && !window.confirm(`${unsynced === 1 ? '1 change hasn’t' : `${unsynced} changes haven’t`} synced yet. Signing out removes ${unsynced === 1 ? 'it' : 'them'} from this device. Sign out anyway?`)) return;
      await authApi('logout', {});
      await clearDevice('You’re signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out. Please try again.');
    } finally { setSigningOut(false); }
  }

  return <main className="today">
    <a className="skip-link" href="#workspace-content" onClick={(event) => { event.preventDefault(); document.getElementById('workspace-content')?.focus(); }}>Skip to content</a>
    <header className="topbar">
      <Brand href={todayHref} />
      {view && engine && <ListsNav route={route} lists={lists} todayLeft={view.total - view.done}
        onCreate={(title) => { const id = crypto.randomUUID(); save(newList(id, title, Date.now())); window.location.hash = listHref(id); }} />}
      <div className="account-menu">
        <span className="who">{account.email}</span>
        <a className="settings-link" href={settingsHref} {...(route.screen === 'settings' ? { 'aria-current': 'page' as const } : {})}>Settings</a>
        <button type="button" className="quiet" onClick={signOut} disabled={!engine || signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!view || !engine ? <p role="status" className="intro">Opening your day…</p> : <FocusItem value={focus}>
      <StartAtLoginOffer />
      {hasReminders && permission === 'default' && !skipPrompt && <div className="notice reminders" role="status">
        <p>Turn on notifications so your reminders pop up while Astir is open in a tab.</p>
        <p>
          <button type="button" className="quiet" onClick={() => void requestNotifications()}>Turn on notifications</button>
          {' '}<button type="button" className="link" onClick={() => setSkipPrompt(true)}>Not now</button>
        </p>
      </div>}
      <div id="workspace-content" tabIndex={-1}>{route.screen === 'list'
        ? <ListScreen key={route.listId} listId={route.listId} records={snapshot!.records} day={day} timeZone={zone} save={save} synced={everSynced} />
        : route.screen === 'settings'
        ? <SettingsScreen account={account} engine={engine} versions={versions} day={day} save={save}
            signOut={() => void signOut()} signingOut={signingOut}
            onDeleted={() => clearDevice('Your account and everything in it were deleted.')} />
        : route.screen === 'history'
        ? <HistoryScreen records={snapshot!.records} today={day} versions={versions} requested={route.day} />
        : <>
          <section className="hero" aria-labelledby="today-heading">
            <div className="day-title">
              <p className="date">{dayLabel(day)}</p>
              <h1 id="today-heading">Today</h1>
              <button type="button" className="hero-add" onClick={() => document.getElementById('today-task-title')?.focus()}><Icon name="plus" />Add task</button>
            </div>
            <div className="daily-progress">
              <ProgressRing percent={view.percent} done={view.done} total={view.total} />
              <div className="progress-copy">
              <h2>{view.total ? `${view.total - view.done} to go` : 'A fresh day'}</h2>
              <p className="tally">{view.total ? `${view.done} done today` : 'Nothing planned yet'}</p>
              <p className="resets">Resets at {hourLabel(upcoming.startHour)}</p>
              {view.total > 0 && view.done === view.total && <p className="cheer">Everything’s done. Enjoy the rest of your day.</p>}
              </div>
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
            <p>Add what you want to get done today: one-off tasks, and the ones that repeat, like a walk or ten minutes of reading. Drag them into the order you’ll do them, then check them off and watch the ring fill.</p>
          </section>}
          <section className="panel day-list" aria-labelledby="day-list-heading">
            <h2 id="day-list-heading" className="sr-only">Today’s list</h2>
            {view.entries.length > 0
              ? <Sortable className="today-list" items={view.entries} keyOf={(entry) => entry.item.id} labelOf={(entry) => entry.item.data!.title}
                  onMove={(from, to) => save(reorderedToday(view.entries, from, to))}
                  render={(entry, handle) => <ItemRow key={entry.item.id} item={entry.item} done={entry.done} handle={handle}
                    kind={entry.source === 'habit' ? 'habit' : 'task'} dayCount={entry.dayCount} carriedFrom={entry.carry}
                    meta={<ItemMeta subtasks={entry.subtasks} repeats={entry.repeats && repeatLabel(entry.repeats)} from={entry.listTitle}
                      due={entry.source === 'list' ? { label: dueLabel(entry.item.data!.dueDay!, day), late: (entry.overdue ?? 0) > 0 && !entry.done } : undefined} />}
                    details={() => <ItemDetails item={entry.item} subtasks={entry.subtasks} day={day} timeZone={zone} save={save} records={snapshot!.records} />}
                    onToggle={(checked) => save(entry.source === 'list' ? setCompleted(entry.item, day, checked) : checkedOff(entry, checked))}
                    onRename={(title) => save(renamed(entry.item, title))}
                    onDelete={() => save(removed(entry.item, snapshot!.records))} />} />
              : <p className="empty">{view.isNew ? 'Add a task below. It can be just for today, or repeat every day or on the days you choose.' : 'Nothing planned for today.'}</p>}
            <AddTodayForm key={day} day={day} first={view.isNew} onAdd={(title, weekdays, missed) => {
              const id = crypto.randomUUID();
              const place = todayBottom(snapshot!.records, Date.now());
              save(weekdays ? newHabit(id, title, weekdays, day, place, missed) : newTodayTask(id, title, day, place, missed));
            }} />
          </section>
        </>}</div>
      <SyncStatusLine status={snapshot!.status} localOnly={localOnly} onRetry={() => void engine.sync()}
        onExport={() => void exportNow(engine, account.email)} />
    </FocusItem>}
  </main>;
}

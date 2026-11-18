import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { checkedOff, cleanNotes, cleanTitle, describeDays, edited, EVERY_DAY, NOTES_MAX, removed, renamed, repeatChanged, repositioned, TITLE_MAX, upcomingRepeat } from '../sync/daily';
import type { Missed, RepeatSetting } from '../sync/daily';
import { livePool, PER_DAY_MAX } from '../sync/buckets';
import { PoolEditor } from './Buckets';
import { weekdayOf } from '../sync/day';
import { MissedFields, RepeatFields } from './AddForms';
import type { Repeat } from './AddForms';
import { wallTime, zonedInstant } from '../sync/day';
import { newSubtask } from '../sync/lists';
import { requestNotifications, useNotificationPermission } from '../reminders/permission';
import { nativeReminders } from '../platform/notifier';
import type { Entry } from '../sync/records';
import type { ItemData, SyncRecord } from '../sync/types';
import ItemRow from './ItemRow';
import Sortable from '../ui/Sortable';

interface Props {
  item: SyncRecord<ItemData>;
  /** Live subtasks of a top-level task, with their checks for the occurrence shown (D26, D55). */
  subtasks?: Entry[];
  /** The occurrence a daily task's checklist is checked for; null or absent for itemId:task checks. */
  subtaskDay?: string | null;
  day: string;
  /** The account's time zone: a list task's reminder is a date and time there (D30, D42). */
  timeZone: string;
  save: (records: SyncRecord[]) => void;
  /** All records, for a daily task's repeat and missed setting; Today passes them. */
  records?: ReadonlyMap<string, SyncRecord>;
  /** On a bucket pick row: the picked item's name and notes (D58). */
  pickNotes?: { name: string; notes: string };
}

/** The fields D26 gives each kind: notes and a reminder for all, a due date and subtasks for some. */
export default function ItemDetails({ item, subtasks, subtaskDay = null, day, timeZone, save, records, pickNotes }: Props) {
  const data = item.data!;
  const id = useId();
  const listTask = data.kind === 'task';
  const daily = !!records && (data.kind === 'habit' || data.kind === 'today') && !data.parentId;
  const upcoming = daily ? upcomingRepeat(records!, item, day) : null;
  const pool = daily ? livePool(records!, item.id) : null;
  const permission = useNotificationPermission();
  const [notes, setNotes] = useState(data.notes ?? '');
  const [notesError, setNotesError] = useState('');
  // Notes synced from another device replace the draft, unless the user is typing in it.
  const notesField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (document.activeElement !== notesField.current) setNotes(data.notes ?? '');
  }, [data.notes]);

  function saveNotes() {
    const result = cleanNotes(notes);
    if ('error' in result) { setNotesError(result.error); return; }
    setNotesError('');
    if (result.notes !== (data.notes ?? '')) save(edited(item, { notes: result.notes }));
  }

  // A list task's reminder is a UTC instant shown in the account's zone; the others are HH:mm.
  const reminderValue = !data.reminder ? '' : listTask
    ? (({ day: d, time }) => `${d}T${time}`)(wallTime(Date.parse(data.reminder), timeZone))
    : data.reminder;
  function saveReminder(value: string) {
    if (!value) { if (data.reminder) save(edited(item, { reminder: null })); return; }
    const reminder = listTask
      ? new Date(zonedInstant(value.slice(0, 10), value.slice(11, 16), timeZone)).toISOString()
      : value.slice(0, 5);
    if (reminder === data.reminder) return;
    save(edited(item, { reminder }));
    // Setting a reminder is when notifications start to matter (D42), never on page load.
    void requestNotifications();
  }

  return <div className="detail-fields">
    <label className="field">
      <span>Notes</span>
      <textarea ref={notesField} value={notes} maxLength={NOTES_MAX} rows={Math.min(8, Math.max(2, notes.split('\n').length))}
        placeholder="Anything worth remembering" onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
    </label>
    {notesError && <p className="form-error" role="alert">{notesError}</p>}
    <div className="field-row">
      {listTask && <label className="field">
        <span>Due</span>
        {/* Saved on blur: a date input fires change for each part typed, such as each digit of the year. */}
        <input type="date" key={data.dueDay ?? ''} defaultValue={data.dueDay ?? ''} min="0001-01-01" max="9999-12-31"
          onBlur={(e) => {
            if (e.target.validity.badInput) return;
            const dueDay = e.target.value || null;
            if (dueDay !== (data.dueDay ?? null)) save(edited(item, { dueDay }));
          }} />
      </label>}
      <label className="field">
        <span>Reminder{listTask ? '' : data.kind === 'habit' || upcoming?.weekdays.length ? ' each day' : ' today'}</span>
        <input type={listTask ? 'datetime-local' : 'time'} key={reminderValue} defaultValue={reminderValue}
          onBlur={(e) => { if (!e.target.validity.badInput) saveReminder(e.target.value); }} />
      </label>
    </div>
    {listTask && <p className="hint">Times are in {timeZone.replaceAll('_', ' ')}.</p>}
    {data.reminder && <p className="hint">{permission === 'granted' ? (nativeReminders() ? 'Reminders pop up while Astir is running, even from the tray.' : 'Reminders pop up while Astir is open in a tab.')
      : permission === 'denied' ? 'Notifications are blocked for Astir in this browser, so reminders can’t pop up. Allow them in the site settings.'
      : permission === 'unsupported' ? 'This browser can’t show notifications, so reminders can’t pop up here.'
      : 'Turn on notifications to have reminders pop up while Astir is open in a tab.'}</p>}
    {pickNotes?.notes && <p className="pick-notes"><strong>{pickNotes.name}:</strong> {pickNotes.notes}</p>}
    {upcoming && <RepeatSettings key={JSON.stringify(upcoming)} item={item} upcoming={upcoming} day={day} save={save} />}
    {pool && (upcoming!.perDay > 0 || pool.length > 0) && <PoolEditor item={item} pool={pool} day={day} save={save} />}
    {subtasks && <div className="subtasks" aria-labelledby={`${id}-subtasks`}>
      <h3 id={`${id}-subtasks`}>Subtasks</h3>
      {subtasks.length > 0 && <Sortable items={subtasks} keyOf={(sub) => sub.item.id} labelOf={(sub) => sub.item.data!.title}
        onMove={(from, to) => save(repositioned(subtasks, from, to))}
        render={(sub, handle) => <ItemRow key={sub.item.id} item={sub.item} done={sub.done} kind="subtask" handle={handle}
          onToggle={(checked) => save(checkedOff({ item: sub.item, completionDay: subtaskDay }, checked))}
          onRename={(title) => save(renamed(sub.item, title))}
          onDelete={() => save(removed(sub.item))} />} />}
      <AddSubtaskForm parentTitle={data.title} onAdd={(title) => save(newSubtask(crypto.randomUUID(), item, title, Date.now()))} />
    </div>}
  </div>;
}

function AddSubtaskForm({ parentTitle, onAdd }: { parentTitle: string; onAdd: (title: string) => void }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    setError('');
    onAdd(result.title);
    setTitle('');
  }
  return <form className="add" onSubmit={submit} aria-label={`Add a subtask to “${parentTitle}”`}>
    <label htmlFor={id}>New subtask</label>
    <div className="add-row small">
      <input id={id} placeholder="Add a step" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

/**
 * A daily task's repeat and missed setting (D51, D52). Edits wait for Save, then apply from the next
 * reset; today's list stays as it is. Keyed by the saved setting, so a synced change resets the draft.
 */
function RepeatSettings({ item, upcoming, day, save }: { item: SyncRecord<ItemData>; upcoming: RepeatSetting; day: string; save: (records: SyncRecord[]) => void }) {
  const id = useId();
  const initial: Repeat = !upcoming.weekdays.length ? 'once' : upcoming.weekdays.length === 7 ? 'every-day' : 'chosen';
  const [repeat, setRepeat] = useState<Repeat>(initial);
  const [chosen, setChosen] = useState<number[]>(upcoming.weekdays.length ? upcoming.weekdays : [weekdayOf(day)]);
  const [missed, setMissed] = useState<Missed>(upcoming.missed);
  const [bucket, setBucket] = useState(upcoming.perDay > 0);
  const [perDay, setPerDay] = useState(Math.max(1, upcoming.perDay));
  const [error, setError] = useState('');
  const weekdays = repeat === 'once' ? [] : repeat === 'every-day' ? EVERY_DAY : [...chosen].sort((a, b) => a - b);
  const wantPerDay = bucket && weekdays.length ? perDay : 0;
  const changed = weekdays.join() !== upcoming.weekdays.join() || missed !== upcoming.missed || wantPerDay !== upcoming.perDay;
  const fromToday = item.data!.kind === 'habit' && item.data!.createdDay === day && weekdays.length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (repeat === 'chosen' && !chosen.length) { setError('Choose at least one day.'); return; }
    setError('');
    save(repeatChanged(item, day, weekdays, missed, wantPerDay));
  }
  return <form className="repeat-settings" onSubmit={submit} aria-labelledby={`${id}-repeat`}>
    <h3 id={`${id}-repeat`}>Repeats</h3>
    <RepeatFields name={`${id}-repeat-choice`} repeat={repeat} chosen={chosen} onRepeat={setRepeat} onChosen={setChosen} onceDisabled={bucket} />
    <MissedFields name={`${id}-missed`} missed={missed} onMissed={setMissed} />
    {/* Buckets are for repeating tasks only (D63). */}
    {repeat !== 'once' && <div className="bucket-settings">
      <label className="checkbox"><input type="checkbox" checked={bucket} onChange={(e) => setBucket(e.target.checked)} /> Cycle through a bucket of items</label>
      {bucket && <label className="choice">How many a day
        <input type="number" min={1} max={PER_DAY_MAX} value={perDay} className="per-day"
          onChange={(e) => setPerDay(Math.max(1, Math.min(PER_DAY_MAX, Math.round(Number(e.target.value) || 1))))} /></label>}
      {bucket && <p className="hint">Each day picks the items that have gone longest without being done. Remove the bucket to make it a one-off.</p>}
    </div>}
    <p className="hint">{upcoming.weekdays.length ? `Repeats ${upcoming.weekdays.length === 7 ? 'every day' : `on ${describeDays(upcoming.weekdays)}`}` : 'Doesn’t repeat'}
      {upcoming.missed === 'drop' ? ', and drops off when missed.' : ', and rolls over when missed.'}
      {upcoming.perDay > 0 && ` It picks ${upcoming.perDay} from its bucket a day.`}{fromToday ? ' It’s new today, so changes start now.' : ' Changes start at your next reset.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {changed && <p><button type="submit" className="quiet">{fromToday ? 'Save' : 'Save from the next reset'}</button></p>}
  </form>;
}

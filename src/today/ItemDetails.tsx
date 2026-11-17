import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { cleanNotes, cleanTitle, edited, NOTES_MAX, removed, renamed, setCompleted, TITLE_MAX } from '../sync/daily';
import { wallTime, zonedInstant } from '../sync/day';
import { newSubtask } from '../sync/lists';
import type { Entry } from '../sync/records';
import type { ItemData, SyncRecord } from '../sync/types';
import ItemRow from './ItemRow';

interface Props {
  item: SyncRecord<ItemData>;
  /** Live subtasks; only top-level today-only and list tasks have them (D26). */
  subtasks?: Entry[];
  day: string;
  /** The account's time zone: a list task's reminder is a date and time there (D30, D42). */
  timeZone: string;
  save: (records: SyncRecord[]) => void;
}

/** The fields D26 gives each kind: notes and a reminder for all, a due date and subtasks for some. */
export default function ItemDetails({ item, subtasks, day, timeZone, save }: Props) {
  const data = item.data!;
  const id = useId();
  const listTask = data.kind === 'task';
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
    if (reminder !== data.reminder) save(edited(item, { reminder }));
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
        <span>Reminder{listTask ? '' : data.kind === 'habit' ? ' each day' : ' today'}</span>
        <input type={listTask ? 'datetime-local' : 'time'} key={reminderValue} defaultValue={reminderValue}
          onBlur={(e) => { if (!e.target.validity.badInput) saveReminder(e.target.value); }} />
      </label>
    </div>
    {listTask && <p className="hint">Times are in {timeZone.replaceAll('_', ' ')}.</p>}
    {subtasks && <div className="subtasks" aria-labelledby={`${id}-subtasks`}>
      <h3 id={`${id}-subtasks`}>Subtasks</h3>
      {subtasks.length > 0 && <ul>
        {subtasks.map((sub) => <ItemRow key={sub.item.id} item={sub.item} done={sub.done} kind="subtask"
          onToggle={(checked) => save(setCompleted(sub.item, day, checked))}
          onRename={(title) => save(renamed(sub.item, title))}
          onDelete={() => save(removed(sub.item))} />)}
      </ul>}
      <AddSubtaskForm parentTitle={data.title} onAdd={(title) => save(newSubtask(crypto.randomUUID(), item, title, Date.now()))} />
    </div>}
  </div>;
}

function AddSubtaskForm({ parentTitle, onAdd }: { parentTitle: string; onAdd: (title: string) => void }) {
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
    <div className="add-row small">
      <input aria-label="New subtask" placeholder="Add a step" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

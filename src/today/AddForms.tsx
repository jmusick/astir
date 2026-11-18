import { useState } from 'react';
import type { FormEvent } from 'react';
import { cleanTitle, defaultMissed, describeDays, EVERY_DAY, TITLE_MAX, WEEK } from '../sync/daily';
import type { Missed } from '../sync/daily';
import { weekdayOf } from '../sync/day';

const SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Repeat = 'once' | 'every-day' | 'chosen';

/** Once, every day or chosen weekdays (D51), shared by the add box and a task's details. */
export function RepeatFields({ name, repeat, chosen, onRepeat, onChosen, onceDisabled = false }: {
  name: string; repeat: Repeat; chosen: number[]; onRepeat: (repeat: Repeat) => void; onChosen: (days: number[]) => void;
  /** A task with a bucket can't be made one-off until the bucket is removed (D63). */
  onceDisabled?: boolean;
}) {
  const toggle = (d: number) => onChosen(chosen.includes(d) ? chosen.filter((x) => x !== d) : [...chosen, d]);
  return <fieldset className="repeat">
    <legend className="sr-only">Repeats</legend>
    <label className="choice"><input type="radio" name={name} checked={repeat === 'once'} disabled={onceDisabled} onChange={() => onRepeat('once')} /> Once</label>
    <label className="choice"><input type="radio" name={name} checked={repeat === 'every-day'} onChange={() => onRepeat('every-day')} /> Every day</label>
    <label className="choice"><input type="radio" name={name} checked={repeat === 'chosen'} onChange={() => onRepeat('chosen')} /> Chosen days</label>
    {repeat === 'chosen' && <div className="weekdays" role="group" aria-label="Days of the week">
      {WEEK.map((d) => <label key={d} className="weekday" title={LONG[d]}>
        <input type="checkbox" checked={chosen.includes(d)} onChange={() => toggle(d)} aria-label={LONG[d]} />
        <span aria-hidden="true">{SHORT[d]}</span>
      </label>)}
    </div>}
  </fieldset>;
}

/** Drop or roll over when missed (D52). */
export function MissedFields({ name, missed, onMissed }: { name: string; missed: Missed; onMissed: (missed: Missed) => void }) {
  return <fieldset className="repeat missed">
    <legend>If it’s missed</legend>
    <label className="choice"><input type="radio" name={name} checked={missed === 'drop'} onChange={() => onMissed('drop')} /> Drop it</label>
    <label className="choice"><input type="radio" name={name} checked={missed === 'carry'} onChange={() => onMissed('carry')} /> Roll it over</label>
  </fieldset>;
}

/**
 * The one add box under Today's list (D47). A task is once, every day or chosen days; it lands at
 * the bottom (D50). `weekdays` is null for a one-off task.
 */
export function AddTodayForm({ day, first, onAdd }: { day: string; first: boolean; onAdd: (title: string, weekdays: number[] | null, missed: Missed) => void }) {
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('once');
  // Null follows the repeat's default until the owner picks one.
  const [missedChoice, setMissed] = useState<Missed | null>(null);
  // Repeating tasks default to drop and one-off tasks to roll over (D52).
  const missed = missedChoice ?? defaultMissed(repeat === 'once' ? 'today' : 'habit');
  const [chosen, setChosen] = useState<number[]>(() => [weekdayOf(day)]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(''); setError('');
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    const weekdays = repeat === 'once' ? null : repeat === 'every-day' ? EVERY_DAY : chosen;
    if (weekdays && !weekdays.length) { setError('Choose at least one day.'); return; }
    onAdd(result.title, weekdays, missed);
    setTitle('');
    if (weekdays && !weekdays.includes(weekdayOf(day))) setMessage(`Added. It isn’t scheduled today, so you’ll see it on ${describeDays(weekdays)}.`);
  }

  return <form className="add" onSubmit={submit} aria-label="Add a task for today">
    <label htmlFor="today-task-title">New task</label>
    <div className="add-row">
      <input id="today-task-title" placeholder={first ? 'Your first task, like “Read 10 pages”' : 'Add a task'} value={title} maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    <RepeatFields name="add-repeat" repeat={repeat} chosen={chosen} onRepeat={setRepeat} onChosen={setChosen} />
    <MissedFields name="add-missed" missed={missed} onMissed={setMissed} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-note" role="status">{message}</p>}
  </form>;
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import { cleanTitle, describeDays, EVERY_DAY, TITLE_MAX, WEEK } from '../sync/daily';
import { weekdayOf } from '../sync/day';

const SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Repeat = 'once' | 'every-day' | 'chosen';

/**
 * The one add box under Today's list (D47). A task is once, every day or chosen days; it lands at
 * the bottom (D50). `weekdays` is null for a one-off task.
 */
export function AddTodayForm({ day, first, onAdd }: { day: string; first: boolean; onAdd: (title: string, weekdays: number[] | null) => void }) {
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('once');
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
    onAdd(result.title, weekdays);
    setTitle('');
    if (weekdays && !weekdays.includes(weekdayOf(day))) setMessage(`Added. It isn’t scheduled today, so you’ll see it on ${describeDays(weekdays)}.`);
  }
  const toggle = (d: number) => setChosen((days) => days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);

  return <form className="add" onSubmit={submit} aria-label="Add a task for today">
    <label htmlFor="today-task-title">New task</label>
    <div className="add-row">
      <input id="today-task-title" placeholder={first ? 'Your first task, like “Read 10 pages”' : 'Add a task'} value={title} maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    <fieldset className="repeat">
      <legend className="sr-only">Repeats</legend>
      <label className="choice"><input type="radio" name="repeat" checked={repeat === 'once'} onChange={() => setRepeat('once')} /> Once</label>
      <label className="choice"><input type="radio" name="repeat" checked={repeat === 'every-day'} onChange={() => setRepeat('every-day')} /> Every day</label>
      <label className="choice"><input type="radio" name="repeat" checked={repeat === 'chosen'} onChange={() => setRepeat('chosen')} /> Chosen days</label>
      {repeat === 'chosen' && <div className="weekdays" role="group" aria-label="Days of the week">
        {WEEK.map((d) => <label key={d} className="weekday" title={LONG[d]}>
          <input type="checkbox" checked={chosen.includes(d)} onChange={() => toggle(d)} aria-label={LONG[d]} />
          <span aria-hidden="true">{SHORT[d]}</span>
        </label>)}
      </div>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-note" role="status">{message}</p>}
  </form>;
}

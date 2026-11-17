import { useState } from 'react';
import type { FormEvent } from 'react';
import { cleanTitle, describeDays, EVERY_DAY, TITLE_MAX, WEEK } from '../sync/daily';
import { weekdayOf } from '../sync/day';

const SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function AddHabitForm({ day, first, onAdd }: { day: string; first: boolean; onAdd: (title: string, weekdays: number[]) => void }) {
  const [title, setTitle] = useState('');
  const [everyDay, setEveryDay] = useState(true);
  const [chosen, setChosen] = useState<number[]>(() => [weekdayOf(day)]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(''); setError('');
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    const weekdays = everyDay ? EVERY_DAY : chosen;
    if (!weekdays.length) { setError('Choose at least one day.'); return; }
    onAdd(result.title, weekdays);
    setTitle('');
    if (!weekdays.includes(weekdayOf(day))) setMessage(`Added. It isn’t scheduled today, so you’ll see it on ${describeDays(weekdays)}.`);
  }
  const toggle = (d: number) => setChosen((days) => days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);

  return <form className="add" onSubmit={submit} aria-label="Add a habit">
    <div className="add-row">
      <input aria-label="New habit" placeholder={first ? 'Your first habit, like “Read 10 pages”' : 'Add a habit'} value={title} maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    <fieldset className="repeat">
      <legend className="sr-only">Repeats</legend>
      <label className="choice"><input type="radio" name="repeat" checked={everyDay} onChange={() => setEveryDay(true)} /> Every day</label>
      <label className="choice"><input type="radio" name="repeat" checked={!everyDay} onChange={() => setEveryDay(false)} /> Chosen days</label>
      {!everyDay && <div className="weekdays" role="group" aria-label="Days of the week">
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

export function AddTaskForm({ first, onAdd }: { first: boolean; onAdd: (title: string) => void }) {
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
  return <form className="add" onSubmit={submit} aria-label="Add a task for today">
    <div className="add-row">
      <input aria-label="New task for today" placeholder={first ? 'One thing to finish today' : 'Add a task for today'} value={title} maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

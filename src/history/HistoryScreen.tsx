import { useMemo } from 'react';
import { addDays, dayAt, dayLabel } from '../sync/day';
import { historyDay, historyLabel, historyRange, isCalendarDay } from '../sync/history';
import type { DayData, SyncRecord } from '../sync/types';
import { historyHref, todayHref } from '../route';

interface Props {
  records: ReadonlyMap<string, SyncRecord>;
  /** The account's current day; History shows the days before it. */
  today: string;
  versions: readonly DayData[];
  /** The day in the address, if any. Out-of-range days are pulled into range. */
  requested: string | null;
}

const clamp = (day: string, first: string, last: string) => day < first ? first : day > last ? last : day;

/** Look back at any past day: habits done out of scheduled, and the tasks finished (D7). Read-only. */
export default function HistoryScreen({ records, today, versions, requested }: Props) {
  const dayOf = useMemo(() => (editedAt: number) => dayAt(versions, editedAt), [versions]);
  const range = useMemo(() => historyRange(records, today, dayOf), [records, today, dayOf]);
  const day = range ? clamp(requested && isCalendarDay(requested) ? requested : range.last, range.first, range.last) : null;
  const view = useMemo(() => day ? historyDay(records, day, dayOf) : null, [records, day, dayOf]);

  if (!range || !day || !view) {
    return <section className="history-screen" aria-labelledby="history-heading">
      <h1 id="history-heading">History</h1>
      <p className="intro">Nothing to look back on yet. Each day you use Astir shows up here once it’s over. <a href={todayHref}>Back to Today</a></p>
    </section>;
  }

  const go = (next: string) => { window.location.hash = historyHref(next); };
  return <section className="history-screen" aria-labelledby="history-heading">
    <div className="history-head">
      <div>
        <p className="date">History</p>
        <h1 id="history-heading">{dayLabel(day)}{day.slice(0, 4) !== today.slice(0, 4) && <span className="year">, {day.slice(0, 4)}</span>}</h1>
        <p className="tally">{historyLabel(view)}</p>
      </div>
      <div className="day-picker">
        <button type="button" className="quiet" aria-label="Previous day" disabled={day <= range.first} onClick={() => go(addDays(day, -1))}>‹</button>
        <input type="date" aria-label="Pick a day" value={day} min={range.first} max={range.last}
          onChange={(e) => { if (isCalendarDay(e.target.value)) go(clamp(e.target.value, range.first, range.last)); }} />
        <button type="button" className="quiet" aria-label="Next day" disabled={day >= range.last} onClick={() => go(addDays(day, 1))}>›</button>
      </div>
    </div>
    <div className="panels">
      <section className="panel habits" aria-labelledby="history-habits-heading">
        <h2 id="history-habits-heading">Habits</h2>
        {view.habits.length > 0 ? <ul>
          {view.habits.map(({ item, done }) => <li key={item.id} className={`item habit past${done ? ' done' : ''}`}>
            <div className="item-main">
              <span className="mark" aria-hidden="true" />
              <span className="title">{item.data!.title}</span>
              <span className="sr-only">{done ? ', done' : ', not done'}</span>
              {item.deleted && <span className="meta"><span className="chip">Removed</span></span>}
            </div>
          </li>)}
        </ul> : <p className="empty">No habits were scheduled this day.</p>}
      </section>
      <section className="panel tasks" aria-labelledby="history-tasks-heading">
        <h2 id="history-tasks-heading">Tasks done</h2>
        {view.tasks.length > 0 ? <ul>
          {view.tasks.map(({ item, listTitle }) => <li key={item.id} className="item task past done">
            <div className="item-main">
              <span className="mark" aria-hidden="true" />
              <span className="title">{item.data!.title}</span>
              {listTitle && <span className="meta"><span className="chip">{listTitle}</span></span>}
            </div>
          </li>)}
        </ul> : <p className="empty">No tasks were checked off this day.</p>}
      </section>
    </div>
  </section>;
}

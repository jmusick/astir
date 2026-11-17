import { useState } from 'react';
import type { FormEvent } from 'react';
import { cleanTitle, TITLE_MAX } from '../sync/daily';
import type { ListSummary } from '../sync/lists';
import { historyHref, listHref, todayHref } from '../route';
import type { Route } from '../route';

interface Props {
  route: Route;
  lists: ListSummary[];
  /** Items left in Today, for its count. */
  todayLeft: number;
  onCreate: (title: string) => void;
}

/** Today, History and every named list, each list with how much is left (D7, D8). */
export default function ListsNav({ route, lists, todayLeft, onCreate }: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    setError(''); setTitle(''); setAdding(false);
    onCreate(result.title);
  }

  const current = (here: boolean) => here ? { 'aria-current': 'page' as const } : {};
  return <nav className="views" aria-label="Today, History and your lists">
    <ul>
      <li><a href={todayHref} {...current(route.screen === 'today')}>Today{todayLeft > 0 && <span className="count" aria-label={`, ${todayLeft} left`}>{todayLeft}</span>}</a></li>
      <li><a href={historyHref()} {...current(route.screen === 'history')}>History</a></li>
      {lists.map(({ list, open }) => <li key={list.id}>
        <a href={listHref(list.id)} {...current(route.screen === 'list' && route.listId === list.id)}>
          {list.data!.title}{open > 0 && <span className="count" aria-label={`, ${open} open`}>{open}</span>}
        </a>
      </li>)}
      <li>{adding
        ? <form className="new-list" onSubmit={submit} aria-label="New list">
            <input aria-label="List name" placeholder="Work, Groceries…" value={title} maxLength={TITLE_MAX} autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setTitle(''); setError(''); } }} />
            <button type="submit">Add</button>
          </form>
        : <button type="button" className="quiet" onClick={() => setAdding(true)}>+ New list</button>}</li>
    </ul>
    {error && <p className="form-error" role="alert">{error}</p>}
  </nav>;
}

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { cleanTitle, removed, renamed, setCompleted, TITLE_MAX } from '../sync/daily';
import { dueLabel, listView, newListTask, removedList, renamedList, tasksInList } from '../sync/lists';
import type { TaskEntry } from '../sync/lists';
import type { SyncRecord } from '../sync/types';
import { todayHref } from '../route';
import ItemDetails from '../today/ItemDetails';
import ItemRow from '../today/ItemRow';
import { ItemMeta } from '../today/ItemMeta';

interface Props {
  listId: string;
  records: ReadonlyMap<string, SyncRecord>;
  day: string;
  timeZone: string;
  save: (records: SyncRecord[]) => void;
  /** False until the first full sync, when a list missing locally may still be on its way. */
  synced: boolean;
}

/** One named list. It never resets: tasks stay until they're checked off or deleted (D8). */
export default function ListScreen({ listId, records, day, timeZone, save, synced }: Props) {
  const view = useMemo(() => listView(records, listId), [records, listId]);
  const taskCount = useMemo(() => tasksInList(records, listId).filter((item) => !item.data!.parentId).length, [records, listId]);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5_000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (!view && !synced) return <p role="status" className="intro list-screen">Opening your list…</p>;
  if (!view) {
    return <section className="list-screen" aria-labelledby="list-heading">
      <h1 id="list-heading">This list is gone</h1>
      <p className="intro">It was deleted, maybe on another device. <a href={todayHref}>Back to Today</a></p>
    </section>;
  }
  const { list, open, done } = view;
  const title = list.data!.title;

  const row = ({ item, done: checked, subtasks }: TaskEntry) => <ItemRow key={item.id} item={item} done={checked} kind="task"
    meta={<ItemMeta subtasks={subtasks} due={item.data!.dueDay ? { label: dueLabel(item.data!.dueDay, day), late: !checked && item.data!.dueDay < day } : undefined} />}
    details={() => <ItemDetails item={item} subtasks={subtasks} day={day} timeZone={timeZone} save={save} />}
    onToggle={(value) => save(setCompleted(item, day, value))}
    onRename={(name) => save(renamed(item, name))}
    onDelete={() => save(removed(item, records))} />;

  return <section className="list-screen" aria-labelledby="list-heading">
    <header className="list-head">
      {renaming
        ? <RenameListForm title={title} onDone={(name) => { setRenaming(false); if (name && name !== title) save(renamedList(list, name)); }} />
        : <h1 id="list-heading">{title}</h1>}
      <p className="tally">{open.length ? `${open.length} open` : done.length ? 'All done' : 'Empty'}{done.length > 0 && <span className="resets"> · {done.length} done</span>}</p>
      {!renaming && <div className="list-actions">
        <button type="button" className="quiet" onClick={() => { setRenaming(true); setConfirming(false); }}>Rename</button>
        {confirming
          ? <button type="button" className="quiet danger" autoFocus onClick={() => { save(removedList(records, list)); window.location.hash = todayHref; }}>
              {taskCount ? `Delete ${title} and its ${taskCount === 1 ? 'task' : `${taskCount} tasks`}?` : `Delete ${title}?`}
            </button>
          : <button type="button" className="quiet" onClick={() => setConfirming(true)}>Delete list</button>}
      </div>}
    </header>
    <div className="panel list">
      {open.length > 0 && <ul>{open.map(row)}</ul>}
      {!open.length && !done.length && <div className="empty-list">
        <p><strong>A fresh list.</strong> Add anything you want to keep track of. It stays here, day after day, until you check it off.</p>
        <p>Give a task a due date and it shows up in Today when it’s due.</p>
      </div>}
      {!open.length && done.length > 0 && <p className="empty">Everything here is done.</p>}
      <AddListTaskForm key={listId} listTitle={title} first={!open.length && !done.length}
        onAdd={(name, dueDay) => save(newListTask(crypto.randomUUID(), listId, name, Date.now(), dueDay))} />
      {done.length > 0 && <details className="done-tasks">
        <summary>Done ({done.length})</summary>
        <ul>{done.map(row)}</ul>
      </details>}
    </div>
  </section>;
}

function RenameListForm({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cleanTitle(draft);
    if ('error' in result) { setError(result.error); return; }
    onDone(result.title);
  }
  return <form className="rename-list" onSubmit={submit} aria-label="Rename list">
    <div className="add-row">
      <input id="list-heading" aria-label="List name" value={draft} maxLength={TITLE_MAX} autoFocus onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onDone(null); }} />
      <button type="submit">Save</button>
      <button type="button" className="quiet" onClick={() => onDone(null)}>Cancel</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function AddListTaskForm({ listTitle, first, onAdd }: { listTitle: string; first: boolean; onAdd: (title: string, dueDay: string | null) => void }) {
  const [title, setTitle] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    setError('');
    onAdd(result.title, dueDay || null);
    setTitle(''); setDueDay('');
  }
  return <form className="add" onSubmit={submit} aria-label={`Add a task to ${listTitle}`}>
    <div className="add-row">
      <input aria-label={`New task in ${listTitle}`} placeholder={first ? 'Your first task here' : `Add to ${listTitle}`} value={title} maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
    </div>
    <label className="choice due-choice">Due <input type="date" value={dueDay} min="0001-01-01" max="9999-12-31" onChange={(e) => setDueDay(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { carriedLabel, cleanTitle, TITLE_MAX } from '../sync/daily';
import type { ItemData, SyncRecord } from '../sync/types';

interface Props {
  item: SyncRecord<ItemData>;
  done: boolean;
  kind: 'habit' | 'task' | 'subtask';
  onToggle: (checked: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** A today-only task's day count; 2 or more shows the carried tag (D22). */
  dayCount?: number;
  /** Small tags after the title, such as a due date or subtask progress. */
  meta?: ReactNode;
  /** Notes, dates and subtasks, shown below the row when opened. */
  details?: () => ReactNode;
}

export default function ItemRow({ item, done, kind, onToggle, onRename, onDelete, dayCount = 1, meta, details }: Props) {
  const title = item.data!.title;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Enter or Escape ends editing before the input's blur fires; the blur must not save again.
  const open = useRef(false);

  // A delete needs a second click within a few seconds: no dialog, and no loss from a stray click.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);

  function finish(save: boolean) {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    if (!save) return;
    const result = cleanTitle(draft);
    if ('title' in result && result.title !== title) onRename(result.title);
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  }

  return <li className={`item ${kind}${done ? ' done' : ''}`}>
    <div className="item-main">
      <input type="checkbox" className="check" id={`${id}-check`} checked={done} onChange={(e) => onToggle(e.target.checked)} />
      {editing
        ? <input className="rename" aria-label={`Rename “${title}”`} value={draft} maxLength={TITLE_MAX} autoFocus
            onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} onBlur={() => finish(true)} />
        : <label className="title" htmlFor={`${id}-check`}>{title}</label>}
      {!editing && dayCount > 1 && <span className="carried" title={`Carried over from ${item.data!.originalDay}`}>{carriedLabel(dayCount)}</span>}
      {!editing && meta}
      {!editing && <div className="actions">
        {details && <button type="button" className="icon" aria-expanded={expanded} aria-controls={`${id}-details`}
          aria-label={`Details for “${title}”`} title="Notes, dates and subtasks" onClick={() => setExpanded((x) => !x)}>{expanded ? '▴' : '▾'}</button>}
        <button type="button" className="icon" aria-label={`Rename “${title}”`} title="Rename"
          onClick={() => { setDraft(title); open.current = true; setEditing(true); setConfirming(false); }}>✎</button>
        {confirming
          ? <button type="button" className="icon danger" autoFocus onClick={() => { setConfirming(false); onDelete(); }}>
              {kind === 'habit' ? 'Remove? History stays' : 'Delete?'}
            </button>
          : <button type="button" className="icon" aria-label={`Delete “${title}”`} title="Delete" onClick={() => setConfirming(true)}>×</button>}
      </div>}
    </div>
    {details && expanded && <div className="details" id={`${id}-details`}>{details()}</div>}
  </li>;
}

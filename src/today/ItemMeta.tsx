import type { Entry } from '../sync/records';

/** Small tags after a task's title: its due date, where it lives, and subtask progress. */
export function ItemMeta({ subtasks, due, from }: { subtasks?: Entry[]; due?: { label: string; late: boolean }; from?: string }) {
  const finished = subtasks?.filter((sub) => sub.done).length ?? 0;
  if (!due && !from && !subtasks?.length) return null;
  return <span className="meta">
    {from && <span className="chip">{from}</span>}
    {due && <span className={due.late ? 'chip late' : 'chip'}>{due.label}</span>}
    {!!subtasks?.length && <span className="chip" aria-label={`${finished} of ${subtasks.length} subtasks done`}>{finished}/{subtasks.length}</span>}
  </span>;
}

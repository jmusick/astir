import type { Entry } from '../sync/records';
import Icon from '../ui/Icon';

interface Props {
  subtasks?: Entry[];
  due?: { label: string; late: boolean };
  from?: string;
  /** How a repeating task repeats, such as "Every day" (D47's repeat marker). */
  repeats?: string;
}

/** Small tags after a task's title: whether it repeats, its due date, where it lives, and subtask progress. */
export function ItemMeta({ subtasks, due, from, repeats }: Props) {
  const finished = subtasks?.filter((sub) => sub.done).length ?? 0;
  if (!due && !from && !repeats && !subtasks?.length) return null;
  return <span className="meta">
    {repeats && <span className="chip repeats" title={`Repeats: ${repeats}`}><Icon name="repeat" /><span className="sr-only">Repeats {repeats}</span></span>}
    {from && <span className="chip">{from}</span>}
    {due && <span className={due.late ? 'chip late' : 'chip'}>{due.label}</span>}
    {!!subtasks?.length && <span className="chip" aria-label={`${finished} of ${subtasks.length} subtasks done`}>{finished}/{subtasks.length}</span>}
  </span>;
}

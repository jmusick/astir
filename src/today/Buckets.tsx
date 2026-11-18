import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { extraPick, newPoolItem, pickSkipped, POOL_MAX, poolEdited, poolRemoved } from '../sync/buckets';
import { cleanTitle, NOTES_MAX, TITLE_MAX } from '../sync/daily';
import type { TodayEntry } from '../sync/daily';
import type { ItemData, PoolData, SyncRecord } from '../sync/types';

type Save = (records: SyncRecord[]) => void;

/**
 * Saves picks once they're decided (D61), after the first sync so this device decides from the
 * same history as the others. Writing them makes them no longer fresh, so this settles at once.
 */
export function RecordPicks({ picks, ready, save }: { picks: SyncRecord[]; ready: boolean; save: Save }) {
  const key = picks.map((pick) => pick.id).join();
  useEffect(() => {
    if (ready && picks.length) save(picks);
    // Keyed by the picks' IDs: a re-render with the same fresh picks mustn't save them twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  return null;
}

/** A pick row's Skip, Do another on the last one once all are done (D57), and the empty-pool note (D62). */
export function BucketActions({ entry, day, save }: { entry: TodayEntry; day: string; save: Save }) {
  if (entry.bucketEmpty) return <span className="meta"><span className="chip">Its bucket has nothing active</span></span>;
  if (!entry.pick) return null;
  const { record, extra } = entry.pick;
  const another = entry.another;
  return <span className="meta bucket-actions">
    {extra && <span className="chip">Extra</span>}
    {!record.data!.done && !extra && <button type="button" className="link" onClick={() => save(pickSkipped(record))}
      aria-label={`Skip ${entry.pick.name} today`}>Skip</button>}
    {another && <button type="button" className="link" onClick={() => save(extraPick(entry.item.id, day, another, (entry.sub ?? 0) + 1))}
      aria-label={`Do another: ${another.data!.name}`}>Do another</button>}
  </span>;
}

/** A bucket task's pool (D58): add items, give them notes, pause or delete them. Changes apply at once. */
export function PoolEditor({ item, pool, day, save }: { item: SyncRecord<ItemData>; pool: SyncRecord<PoolData>[]; day: string; save: Save }) {
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cleanTitle(name);
    if ('error' in result) { setError(result.error); return; }
    if (pool.length >= POOL_MAX) { setError(`A bucket holds up to ${POOL_MAX} items.`); return; }
    setError('');
    save(newPoolItem(crypto.randomUUID(), item.id, result.title, Date.now(), day));
    setName('');
  }
  return <div className="pool" aria-labelledby={`${id}-pool`}>
    <h3 id={`${id}-pool`}>Bucket</h3>
    {pool.length > 0 ? <ul>
      {pool.map((entry) => <PoolRow key={entry.id} pool={entry} save={save} />)}
    </ul> : <p className="hint">Add the items it cycles through, like the accounts you post for.</p>}
    <form className="add" onSubmit={add} aria-label={`Add to ${item.data!.title}’s bucket`}>
      <label htmlFor={`${id}-name`}>New bucket item</label>
      <div className="add-row small">
        <input id={`${id}-name`} placeholder="Add an item" value={name} maxLength={TITLE_MAX} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Add</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="hint">New items join the rotation tomorrow.</p>
    </form>
  </div>;
}

function PoolRow({ pool, save }: { pool: SyncRecord<PoolData>; save: Save }) {
  const id = useId();
  const data = pool.data!;
  const [notes, setNotes] = useState(data.notes ?? '');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);
  return <li className={`pool-item${data.paused ? ' paused' : ''}`}>
    <div className="pool-head">
      <span className="title">{data.name}{data.paused && <span className="chip"> Paused</span>}</span>
      <label className="choice"><input type="checkbox" checked={!!data.paused} onChange={(e) => save(poolEdited(pool, { paused: e.target.checked }))} /> Pause</label>
      {confirming
        ? <button type="button" className="quiet danger" autoFocus onClick={() => save(poolRemoved(pool))}>Delete? History stays</button>
        : <button type="button" className="quiet" onClick={() => setConfirming(true)} aria-label={`Delete ${data.name}`}>Delete</button>}
    </div>
    <label className="field" htmlFor={`${id}-notes`}><span className="sr-only">Notes for {data.name}</span></label>
    <textarea id={`${id}-notes`} rows={1} value={notes} maxLength={NOTES_MAX} placeholder={`Notes for ${data.name}`}
      onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes.trim() !== (data.notes ?? '')) save(poolEdited(pool, { notes })); }} />
  </li>;
}

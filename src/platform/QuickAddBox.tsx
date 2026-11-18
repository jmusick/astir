import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cleanTitle, TITLE_MAX } from '../sync/daily';
import { SUBMIT_EVENT } from './quickAdd';

/**
 * The quick-add window's whole UI: one field. Enter sends the title to the main window, which adds
 * it as a one-off task at the bottom of Today (D50); Escape, or clicking elsewhere, closes it without adding (D35).
 */
export default function QuickAddBox() {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function hide() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  }

  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      // Fresh each time it opens; gone as soon as the user clicks away.
      if (focused) { setTitle(''); setError(''); input.current?.focus(); } else void hide();
    })).then((unlisten) => { if (live) stop = unlisten; else unlisten(); });
    return () => { live = false; stop?.(); };
  }, []);

  async function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); await hide(); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!title.trim()) return; // An empty title isn't added.
    const result = cleanTitle(title);
    if ('error' in result) { setError(result.error); return; }
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('main', SUBMIT_EVENT, { title: result.title });
    setTitle('');
    await hide();
  }

  return <main className="quick-add">
    <label className="visually-hidden" htmlFor="quick-add-title">Add a task for today</label>
    <input id="quick-add-title" ref={input} autoFocus value={title} maxLength={TITLE_MAX} placeholder="Add to today…"
      onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => void onKeyDown(e)} />
    {error ? <p className="form-error" role="alert">{error}</p> : <p className="hint">Enter adds it to Today · Esc closes</p>}
  </main>;
}

import { useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import { changeShortcut, onQuickAddStatus, quickAddStatus, shortcutFromKey, shortcutLabel } from './quickAdd';
import { isApp } from './platform';

/** Settings: the quick-add shortcut, and a field to choose another by pressing it. App only. */
export default function QuickAddSetting() {
  const status = useSyncExternalStore(onQuickAddStatus, quickAddStatus);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState('');
  if (!isApp) return null;

  async function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    if (event.key === 'Escape') { setRecording(false); setMessage(''); return; }
    const next = shortcutFromKey(event.nativeEvent);
    if (!next) { setMessage('Hold Ctrl, Alt or Win together with a letter, number or key such as Space.'); return; }
    setRecording(false);
    setMessage((await changeShortcut(next))
      ? `Quick add now opens with ${shortcutLabel(next)}.`
      : `Another app is already using ${shortcutLabel(next)}. Choose a different shortcut.`);
  }

  return <section className="settings-section" aria-labelledby="quick-add-heading">
    <h2 id="quick-add-heading">Quick add</h2>
    <p>Press <kbd>{shortcutLabel(status.shortcut)}</kbd> in any app to add a task to today.</p>
    {status.taken && <p className="form-error" role="alert">Another app is already using {shortcutLabel(status.shortcut)}, so it doesn’t open quick add. Choose a different shortcut.</p>}
    <p>
      <button type="button" className="quiet" onClick={() => { setRecording(true); setMessage(''); }} onKeyDown={(e) => void onKeyDown(e)}
        onBlur={() => setRecording(false)} aria-describedby="quick-add-message">
        {recording ? 'Press the new shortcut…' : 'Change shortcut'}
      </button>
    </p>
    <p id="quick-add-message" className="hint" role="status">{recording ? 'Press the keys together, or Esc to cancel.' : message}</p>
  </section>;
}

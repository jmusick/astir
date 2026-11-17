import { useEffect, useState } from 'react';
import { autostartOffered, markAutostartOffered, setStartsAtLogin, startsAtLogin, systemName } from './nativeShell';
import { isApp } from './platform';

/** Offered once on first run; off unless the user says yes (D35). App only. */
export function StartAtLoginOffer() {
  const [show, setShow] = useState(() => isApp && !autostartOffered());
  if (!show) return null;
  const answer = (on: boolean) => {
    markAutostartOffered(); setShow(false);
    if (on) void setStartsAtLogin(true).catch(() => undefined);
  };
  return <div className="notice reminders" role="status">
    <p>Start Astir when you sign in to {systemName()}? It opens quietly in the tray, so your day is ready and reminders can reach you.</p>
    <p>
      <button type="button" className="quiet" onClick={() => answer(true)}>Start with {systemName()}</button>
      {' '}<button type="button" className="link" onClick={() => answer(false)}>No thanks</button>
    </p>
  </div>;
}

/** The Settings switch for starting at login. App only. */
export function StartAtLoginSetting() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    startsAtLogin().then((value) => { if (live) setOn(value); }).catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  if (!isApp) return null;
  async function change(next: boolean) {
    setError(''); markAutostartOffered();
    try { await setStartsAtLogin(next); setOn(next); } catch { setError('Astir couldn’t change that setting. Try again.'); }
  }
  return <section className="settings-section" aria-labelledby="startup-heading">
    <h2 id="startup-heading">Start with {systemName()}</h2>
    <label className="checkbox">
      <input type="checkbox" checked={on ?? false} disabled={on === null} onChange={(e) => void change(e.target.checked)} />
      Open Astir in the tray when you sign in to {systemName()}
    </label>
    <p className="hint">Closing the window keeps Astir in the tray, syncing and reminding. Quit from the tray icon’s menu.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

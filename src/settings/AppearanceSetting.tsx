import { useState, useSyncExternalStore } from 'react';
import { currentTheme, selectTheme, subscribeTheme, themes } from '../appearance/theme';

export default function AppearanceSetting() {
  const selected = useSyncExternalStore(subscribeTheme, currentTheme);
  const [message, setMessage] = useState('');
  const choose = (theme: typeof themes[number]) => {
    const saved = selectTheme(theme.id);
    setMessage(saved ? `${theme.name} theme selected.` : `${theme.name} applied. This device blocked saving your choice; allow local storage to keep it after restarting.`);
  };

  return <section className="settings-section appearance" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">Appearance</h2>
    <p>Choose a color theme. Your choice stays on this device and works offline.</p>
    <fieldset className="theme-picker">
      <legend className="sr-only">Color theme</legend>
      {themes.map(theme => <label className="theme-option" key={theme.id} data-palette={theme.id}>
        <input type="radio" name="color-theme" value={theme.id} checked={selected === theme.id}
          onChange={() => choose(theme)}
          onClick={() => { if (selected === theme.id) choose(theme); }} />
        <span className="theme-sample" aria-hidden="true"><span /><span /><span /></span>
        <span className="theme-name">{theme.name}<span className="theme-mode">{theme.mode}</span></span>
        <span className="theme-description">{theme.description}</span>
      </label>)}
    </fieldset>
    <p className="form-note" role="status">{message}</p>
  </section>;
}

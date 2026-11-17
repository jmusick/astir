import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { deviceTimeZone, hourLabel } from '../sync/day';
import type { DaySettings } from '../sync/day';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
function timeZones(current: string): string[] {
  let zones: string[] = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older engines: offer the two we know */ }
  return [...new Set([current, deviceTimeZone(), ...zones])].sort();
}

// A minimal way to set the day boundary until Settings (#10) owns it. Changes start at the next reset (D34).
export default function DaySettingsForm({ settings, onSave }: { settings: DaySettings; onSave: (next: DaySettings) => void }) {
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [startHour, setStartHour] = useState(settings.startHour);
  const zones = useMemo(() => timeZones(settings.timeZone), [settings.timeZone]);
  const changed = timeZone !== settings.timeZone || startHour !== settings.startHour;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (changed) onSave({ timeZone, startHour });
  }

  return <details className="day-settings">
    <summary>Change when your day resets</summary>
    <form onSubmit={submit}>
      <label>Day starts at
        <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
          {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
        </select>
      </label>
      <label>Time zone
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select>
      </label>
      <p className="hint">Changes start at your next reset, so today stays as it is.</p>
      <button type="submit" disabled={!changed}>Save</button>
    </form>
  </details>;
}

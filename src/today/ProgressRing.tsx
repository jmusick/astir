const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ProgressRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return <div className="ring" role="img" aria-label={`${clamped}% of today done`}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle className="ring-track" cx="60" cy="60" r={RADIUS} />
      <circle className="ring-fill" cx="60" cy="60" r={RADIUS}
        strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)} />
    </svg>
    <span className="ring-label" aria-hidden="true">{clamped}%</span>
  </div>;
}

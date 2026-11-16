import { useEffect, useState } from 'react';

type Health = { status: string; database: string };

// Placeholder shell until the real UI lands. It shows whether the API and D1 answer, which is
// what the first deploy needs to prove.
export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: Health) => setHealth(body))
      .catch(() => setFailed(true));
  }, []);

  let status = 'Checking the server…';
  if (failed) status = 'The server isn’t answering.';
  else if (health) status = `Server ${health.status}, database ${health.database}.`;

  return (
    <main>
      <h1>Astir</h1>
      <p>A daily to-do list that resets every day. Coming soon.</p>
      <p className="status" role="status">
        {status}
      </p>
    </main>
  );
}

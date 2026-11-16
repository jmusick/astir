import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }
let scriptReady: Promise<TurnstileApi> | undefined;
function loadScript() {
  scriptReady ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Verification did not load.'));
    script.onerror = () => { script.remove(); scriptReady = undefined; reject(new Error('Verification did not load. Check your connection and reload.')); };
    document.head.append(script);
  });
  return scriptReady;
}

export default function Turnstile({ action, onToken }: { action: 'login' | 'register'; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  useEffect(() => {
    if (!sitekey) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    loadScript().then((api) => {
      if (cancelled || !container.current) return;
      const id = api.render(container.current, {
        sitekey, action, size: 'flexible',
        callback: (token: string) => { setError(''); onToken(token); },
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); setError('Verification failed. Check your connection and try again.'); },
      });
      remove = () => api.remove(id);
    }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; remove?.(); };
  }, [sitekey, action, onToken]);
  return <div className="challenge"><div ref={container} />
    {!sitekey && <p role="alert">Sign-in verification is not configured yet.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

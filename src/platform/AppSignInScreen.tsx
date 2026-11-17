import { useEffect, useRef, useState } from 'react';
import type { Account } from '../authApi';
import { finishAppSignIn, listenForHandoff, openInBrowser, startAppSignIn } from './appSignIn';
import { webUrl } from './platform';

/** The app's only sign-in: in the browser, so Turnstile and password managers work (D28). */
export default function AppSignInScreen({ notice = '', onSignedIn }: { notice?: string; onSignedIn: (account: Account) => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const signedIn = useRef(onSignedIn);
  useEffect(() => { signedIn.current = onSignedIn; });

  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void listenForHandoff((link) => {
      finishAppSignIn(link).then((account) => { if (account && live) signedIn.current(account); })
        .catch((err: unknown) => { if (live) { setWaiting(false); setError(err instanceof Error ? err.message : 'Astir couldn’t finish signing in. Try again.'); } });
    }).then((unlisten) => { if (live) stop = unlisten; else unlisten(); }).catch(() => undefined);
    return () => { live = false; stop?.(); };
  }, []);

  async function start() {
    setError('');
    try {
      await startAppSignIn(openInBrowser);
      setWaiting(true);
    } catch { setError('Astir couldn’t open your browser. Try again.'); }
  }

  return <main className="auth">
    <span className="brand">Astir<span className="brand-dot" aria-hidden="true">●</span></span>
    <p className="intro">A fresh start for your day.</p>
    <section className="account" aria-labelledby="account-heading">
      <h1 id="account-heading">Sign in</h1>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {waiting
        ? <p role="status">Finish signing in in your browser. Astir will pick it up from there.</p>
        : <p>Astir opens your browser so you can sign in or create an account there, then brings you back here.</p>}
      <button type="button" onClick={() => void start()}>{waiting ? 'Open the browser again' : 'Sign in with your browser'}</button>
      <nav aria-label="Account help">
        <button type="button" className="link" onClick={() => void openInBrowser(webUrl('/signup')).catch(() => undefined)}>Create an account</button>
      </nav>
    </section>
  </main>;
}

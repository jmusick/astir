import { useState } from 'react';
import { authApi } from './authApi';
import type { Account } from './authApi';
import Brand from './ui/Brand';

// /connect-app on the web: hands a sign-in to the Astir app that opened this page (D28). The app
// sent a PKCE challenge; the code made here only works with the verifier that app kept.

const params = new URLSearchParams(window.location.search);
export const isConnectPage = window.location.pathname === '/connect-app';
const challenge = params.get('challenge') ?? '';
const name = (params.get('name') ?? '').slice(0, 60) || 'the Astir app';
const valid = /^[A-Za-z0-9_-]{43}$/.test(challenge);

export default function ConnectAppScreen({ account }: { account: Account }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask');
  const [error, setError] = useState('');

  async function connect() {
    setState('busy'); setError('');
    try {
      const { code } = await authApi('app-handoff', { challenge, name }) as { code?: string };
      if (!code) throw new Error('Astir couldn’t start that sign-in. Try again from the app.');
      // Hand the one-time code to the waiting app. Nothing else can use it.
      window.location.href = `astir://auth?code=${code}`;
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Astir couldn’t start that sign-in. Try again from the app.');
      setState('ask');
    }
  }

  return <main className="auth">
    <Brand href="/" />
    <section className="account" aria-labelledby="connect-heading">
      <h1 id="connect-heading">Sign in to {name}</h1>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!valid ? <p role="alert">This sign-in link is incomplete. Go back to the Astir app and choose “Sign in with your browser” again.</p>
        : state === 'done' ? <p role="status">Switch back to {name}; it’s signed in as {account.email}. You can close this tab. If your browser asked to open Astir and you said no, <button type="button" className="link" onClick={() => void connect()}>try again</button>.</p>
          : <>
            <p>{name} will be signed in as <strong>{account.email}</strong> and sync your lists. Continue only if you just chose “Sign in with your browser” in the app.</p>
            <button type="button" onClick={() => void connect()} disabled={state === 'busy'}>{state === 'busy' ? 'Please wait…' : `Continue to ${name}`}</button>
          </>}
      <nav aria-label="Other choices"><a href="/">Not now, go to Astir</a></nav>
    </section>
  </main>;
}

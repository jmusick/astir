import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authApi } from './authApi';
import { newPasswordError, PASSWORD_HINT } from './passwordPolicy';
import Turnstile from './Turnstile';

// Remove email credentials from the address before a vendor script loads. Keep them in memory.
// Explicit confirmation avoids StrictMode or mail scanners consuming a single-use link.
const initialPath = window.location.pathname;
const linkToken = new URLSearchParams(window.location.search).get('token') || '';
if (linkToken && ['/verify-email', '/reset-password'].includes(initialPath)) window.history.replaceState(null, '', initialPath);
type Mode = 'login' | 'register' | 'forgot-password' | 'resend-verification' | 'verify-email' | 'reset-password';
const titles: Record<Mode, string> = {
  login: 'Sign in', register: 'Create your account', 'forgot-password': 'Reset your password',
  'resend-verification': 'Resend verification email', 'verify-email': 'Verify your email', 'reset-password': 'Choose a new password',
};
const mode: Mode = initialPath === '/signup' ? 'register'
  : ['forgot-password', 'resend-verification', 'verify-email', 'reset-password'].includes(initialPath.slice(1))
    ? initialPath.slice(1) as Mode : 'login';

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [turnstileToken, setToken] = useState('');
  const [challengeKey, setChallengeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const isLink = mode === 'verify-email' || mode === 'reset-password';
  const newPassword = mode === 'register' || mode === 'reset-password';
  const hasPassword = newPassword || mode === 'login';
  const challenge = mode === 'login' || mode === 'register';

  useEffect(() => {
    const controller = new AbortController();
    authApi('me', undefined, controller.signal).then((data) => setUser(data.user || null))
      .catch(() => { /* Anonymous and offline visitors can still reach the forms. */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setMessage('');
    if (newPassword) {
      const problem = newPasswordError(password);
      if (problem) { setError(problem); return; }
      if (password !== confirm) { setError('The passwords do not match.'); return; }
    }
    setBusy(true);
    try {
      const result = await authApi(mode, { email, password, token: linkToken, turnstileToken });
      setPassword(''); setConfirm('');
      if (mode === 'login' && result.user) window.location.assign('/');
      else {
        setMessage(result.message || 'Done.');
        if (isLink) setFinished(true);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reach Astir. Please try again.'); }
    finally {
      setBusy(false);
      if (challenge) { setToken(''); setChallengeKey((key) => key + 1); }
    }
  }
  async function logout() {
    setBusy(true); setError('');
    try {
      await authApi('logout', {});
      setUser(null); setPassword(''); setMessage('You’re signed out.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main>
    <a className="brand" href="/">Astir<span className="brand-dot" aria-hidden="true">●</span></a>
    <p className="intro">A fresh start for your day.</p>
    {loading ? <p role="status">Opening Astir…</p> : <section className="account" aria-labelledby="account-heading">
      <h1 id="account-heading">{user && !isLink ? 'You’re signed in' : titles[mode]}</h1>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {user && !isLink ? <>
        <p>{user.email}</p>
        <p>Your account is ready. The daily list is coming next.</p>
        <button disabled={busy} onClick={logout}>{busy ? 'Signing out…' : 'Sign out'}</button>
      </> : <>
        {isLink && !linkToken && <p role="alert">This link is missing its token. Request a new link below. If you refreshed this page, reopen the link from your email.</p>}
        {!finished && <form onSubmit={submit}>
          {!isLink && <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
          {hasPassword && <label>{newPassword ? 'New password' : 'Password'}
            <input name="password" type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={newPassword ? 'password-hint' : undefined} />
          </label>}
          {newPassword && <><p className="hint" id="password-hint">{PASSWORD_HINT}</p>
            <label>Confirm password<input name="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label></>}
          {mode === 'verify-email' && <p>Confirm your email address, then sign in with your password.</p>}
          {challenge && <Turnstile key={challengeKey} action={mode === 'register' ? 'register' : 'login'} onToken={setToken} />}
          <button type="submit" disabled={busy || (challenge && !turnstileToken) || (isLink && !linkToken)}>
            {busy ? 'Please wait…' : titles[mode]}
          </button>
        </form>}
        <nav aria-label="Account help">
          {mode !== 'login' && <a href="/">Sign in</a>}
          {mode !== 'register' && <a href="/signup">Create an account</a>}
          <a href="/forgot-password">Forgot password?</a>
          <a href="/resend-verification">Resend verification email</a>
        </nav>
      </>}
    </section>}
  </main>;
}

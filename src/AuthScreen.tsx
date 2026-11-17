import { useState } from 'react';
import type { FormEvent } from 'react';
import { authApi } from './authApi';
import { isLinkMode as isLink, linkToken, mode, titles } from './authMode';
import { newPasswordError, PASSWORD_HINT } from './passwordPolicy';
import Turnstile from './Turnstile';

export default function AuthScreen({ notice = '' }: { notice?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [turnstileToken, setToken] = useState('');
  const [challengeKey, setChallengeKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(notice);
  const [finished, setFinished] = useState(false);
  const newPassword = mode === 'register' || mode === 'reset-password';
  const hasPassword = newPassword || mode === 'login';
  const challenge = mode === 'login' || mode === 'register';

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
      // Signing in to connect the app comes back to that page (D28).
      if (mode === 'login' && result.user) window.location.assign(window.location.pathname === '/connect-app' ? window.location.pathname + window.location.search : '/');
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

  return <main className="auth">
    <a className="brand" href="/">Astir<span className="brand-dot" aria-hidden="true">●</span></a>
    <p className="intro">A fresh start for your day.</p>
    <section className="account" aria-labelledby="account-heading">
      <h1 id="account-heading">{titles[mode]}</h1>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
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
    </section>
  </main>;
}

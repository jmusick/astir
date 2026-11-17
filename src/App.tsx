import { useEffect, useState } from 'react';
import { authApi, AuthApiError } from './authApi';
import { databaseName } from './sync/indexedDbStore';
import type { Account } from './authApi';
import { forgetAccount, rememberAccount, rememberedAccount } from './rememberedAccount';
import { isLinkMode } from './authMode';
import AuthScreen from './AuthScreen';
import TodayScreen from './today/TodayScreen';

const ME_TIMEOUT_MS = 8_000;

export default function App() {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    // A stalled connection never fails on its own, so give up and open the local data instead.
    authApi('me', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(ME_TIMEOUT_MS)])).then((data) => {
      if (data.user) rememberAccount(data.user); else forgetAccount();
      setUser(data.user || null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      // A rejected session (401) shows the forms; that account's local data waits for its next sign-in.
      // Offline or a server outage: open the last account's local data instead (local-first).
      if (error instanceof AuthApiError && error.reason === 'account-deleted') {
        // Deleted on another device while this one was away: clear its copy and say why (D29).
        const gone = rememberedAccount();
        forgetAccount();
        if (gone) { try { indexedDB.deleteDatabase(databaseName(gone.id)); } catch { /* No IndexedDB. */ } }
        setNotice('This account was deleted, so Astir removed its data from this device.');
      } else if ((error as { status?: number }).status === 401) forgetAccount();
      else setUser(rememberedAccount());
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) {
    return <main className="auth">
      <a className="brand" href="/">Astir<span className="brand-dot" aria-hidden="true">●</span></a>
      <p role="status" className="intro">Opening Astir…</p>
    </main>;
  }
  // Each account gets its own engine and local database (D45); the key keeps them apart.
  if (user && !isLinkMode) {
    return <TodayScreen key={user.id} account={user} onSignedOut={(message = 'You’re signed out.') => { history.replaceState(null, '', '/'); setUser(null); setNotice(message); }} />;
  }
  return <AuthScreen notice={notice} />;
}

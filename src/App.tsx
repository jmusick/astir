import { useEffect, useState } from 'react';
import { authApi, AuthApiError } from './authApi';
import type { Account } from './authApi';
import { deviceToken, forgetAccount, rememberAccount, rememberedAccount } from './rememberedAccount';
import { isLinkMode } from './authMode';
import AuthScreen from './AuthScreen';
import ConnectAppScreen, { isConnectPage } from './ConnectAppScreen';
import AppSignInScreen from './platform/AppSignInScreen';
import { wipeLocalData } from './platform/localStore';
import { isApp } from './platform/platform';
import TodayScreen from './today/TodayScreen';
import Brand from './ui/Brand';

const ME_TIMEOUT_MS = 8_000;

export default function App() {
  const [user, setUser] = useState<Account | null>(null);
  // An app with no device token has no one to ask the server about.
  const [loading, setLoading] = useState(() => !isApp || deviceToken() !== null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    // A stalled connection never fails on its own, so give up and open the local data instead.
    authApi('me', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(ME_TIMEOUT_MS)])).then((data) => {
      if (data.user) rememberAccount(data.user); else forgetAccount();
      setUser(data.user || null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      // A rejected session (401) shows sign-in; that account's local data waits for its next sign-in.
      // Offline or a server outage: open the last account's local data instead (local-first).
      if (error instanceof AuthApiError && error.reason === 'account-deleted') {
        // Deleted on another device while this one was away: clear its copy and say why (D29).
        const gone = rememberedAccount();
        forgetAccount();
        if (gone) void wipeLocalData(gone.id);
        setNotice('This account was deleted, so Astir removed its data from this device.');
      } else if ((error as { status?: number }).status === 401) {
        forgetAccount();
        if (isApp) setNotice('You were signed out. Sign in again to sync; your changes on this device are kept until you do.');
      } else setUser(rememberedAccount());
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Only on start: a later sign-in sets the user directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <main className="auth">
      <Brand />
      <p role="status" className="intro">Opening Astir…</p>
    </main>;
  }
  if (!isApp && isConnectPage) {
    return user ? <ConnectAppScreen account={user} /> : <AuthScreen notice="Sign in to connect the Astir app to your account." />;
  }
  // Each account gets its own engine and local database (D45); the key keeps them apart.
  if (user && !isLinkMode) {
    return <TodayScreen key={user.id} account={user} onSignedOut={(message = 'You’re signed out.') => { history.replaceState(null, '', '/'); setUser(null); setNotice(message); }} />;
  }
  if (isApp) return <AppSignInScreen notice={notice} onSignedIn={(account) => { setNotice(''); setUser(account); }} />;
  return <AuthScreen notice={notice} />;
}

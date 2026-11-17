import type { Account } from './authApi';

// The signed-in account, kept so Today can open from local data when the network is down.
// Cleared on sign-out and whenever the server says no one is signed in (D45).
const KEY = 'astir-account';
// The app's device token (D28). The webview's storage is this Windows user's alone; the browser
// never has one (its session is an HttpOnly cookie).
const TOKEN = 'astir-device-token';

export function deviceToken(): string | null {
  try { return localStorage.getItem(TOKEN); } catch { return null; }
}
export function setDeviceToken(token: string) {
  try { localStorage.setItem(TOKEN, token); } catch { /* Storage blocked. */ }
}

export function rememberAccount(account: Account) {
  try { localStorage.setItem(KEY, JSON.stringify({ id: account.id, email: account.email })); } catch { /* Storage blocked. */ }
}

/** Forget who is signed in on this device, and the app's device token with it. Local data stays. */
export function forgetAccount() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(TOKEN); } catch { /* Storage blocked. */ }
}

export function rememberedAccount(): Account | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Account> | null;
    return typeof value?.id === 'string' && typeof value.email === 'string' ? { id: value.id, email: value.email } : null;
  } catch { return null; }
}

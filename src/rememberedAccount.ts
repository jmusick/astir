import type { Account } from './authApi';

// The signed-in account, kept so Today can open from local data when the network is down.
// Cleared on sign-out and whenever the server says no one is signed in (D45).
const KEY = 'astir-account';

export function rememberAccount(account: Account) {
  try { localStorage.setItem(KEY, JSON.stringify({ id: account.id, email: account.email })); } catch { /* Storage blocked. */ }
}

export function forgetAccount() {
  try { localStorage.removeItem(KEY); } catch { /* Storage blocked. */ }
}

export function rememberedAccount(): Account | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Account> | null;
    return typeof value?.id === 'string' && typeof value.email === 'string' ? { id: value.id, email: value.email } : null;
  } catch { return null; }
}

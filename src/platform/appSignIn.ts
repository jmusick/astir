import type { Account } from '../authApi';
import { authApi } from '../authApi';
import { rememberAccount, setDeviceToken } from '../rememberedAccount';
import { appName, webUrl } from './platform';

// "Sign in with your browser" (D28), with PKCE so only the app that started a sign-in can finish it.
// The app keeps a random verifier and opens /connect-app with its SHA-256 challenge. Once the user
// is signed in there, the page asks the server for a one-time code bound to that challenge and
// opens astir://auth?code=…; this app redeems it with the verifier for a device token. A stale
// link, a second click or another app never has the verifier, so it gets nothing.

const PENDING = 'astir-app-sign-in';
const PENDING_MS = 15 * 60_000;
export const HANDOFF_SCHEME = 'astir:';

const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const challengeFor = async (verifier: string) => base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));

type Pending = { verifier: string; expiresAt: number };
function pending(now = Date.now()): Pending | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null;
    return value && typeof value.verifier === 'string' && value.expiresAt > now ? value : null;
  } catch { return null; }
}

/** The address of the web page that hands this sign-in to the app. */
export async function connectUrl(verifier: string, name = appName()) {
  const params = new URLSearchParams({ challenge: await challengeFor(verifier), name });
  return webUrl(`/connect-app?${params}`);
}

/** Start a sign-in: remember a fresh verifier and open the web page in the default browser. */
export async function startAppSignIn(open: (url: string) => Promise<void>) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(PENDING, JSON.stringify({ verifier, expiresAt: Date.now() + PENDING_MS } satisfies Pending));
  await open(await connectUrl(verifier));
}

/** The one-time code in an astir://auth link, or null for anything else. */
export function handoffCode(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== HANDOFF_SCHEME) return null;
    // astir://auth?code=… parses with "auth" as the host; accept astir:auth too.
    if (url.hostname !== 'auth' && url.pathname.replace(/^\/+/, '') !== 'auth') return null;
    const code = url.searchParams.get('code');
    return code && /^[a-f0-9]{64}$/.test(code) ? code : null;
  } catch { return null; }
}

/**
 * Finish a sign-in from an astir:// link. Returns null, doing nothing, unless this app is waiting
 * for one; the verifier is used once either way.
 */
export async function finishAppSignIn(link: string): Promise<Account | null> {
  const code = handoffCode(link);
  const waiting = pending();
  if (!code || !waiting) return null;
  localStorage.removeItem(PENDING);
  const data = await authApi('app-token', { code, verifier: waiting.verifier }) as { token?: string; user?: Account };
  if (!data.token || !data.user) throw new Error('Astir couldn’t finish signing in. Try again.');
  setDeviceToken(data.token);
  rememberAccount(data.user);
  return data.user;
}

/** Deliver astir:// links: the one that launched the app, and any opened while it runs. */
export async function listenForHandoff(onLink: (link: string) => void): Promise<() => void> {
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const stop = await onOpenUrl((urls) => urls.forEach(onLink));
  (await getCurrent().catch(() => null))?.forEach(onLink);
  return stop;
}

export async function openInBrowser(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

// Which account form the address asks for. Email links carry a single-use token; remove it from the
// address before a vendor script loads, keeping it in memory. Explicit confirmation avoids
// StrictMode or mail scanners consuming a single-use link.
const initialPath = window.location.pathname;
export const linkToken = new URLSearchParams(window.location.search).get('token') || '';
if (linkToken && ['/verify-email', '/reset-password'].includes(initialPath)) window.history.replaceState(null, '', initialPath);

export type Mode = 'login' | 'register' | 'forgot-password' | 'resend-verification' | 'verify-email' | 'reset-password';
export const titles: Record<Mode, string> = {
  login: 'Sign in', register: 'Create your account', 'forgot-password': 'Reset your password',
  'resend-verification': 'Resend verification email', 'verify-email': 'Verify your email', 'reset-password': 'Choose a new password',
};
export const mode: Mode = initialPath === '/signup' ? 'register'
  : ['forgot-password', 'resend-verification', 'verify-email', 'reset-password'].includes(initialPath.slice(1))
    ? initialPath.slice(1) as Mode : 'login';
/** Email-link pages show their form even to a signed-in visitor. */
export const isLinkMode = mode === 'verify-email' || mode === 'reset-password';

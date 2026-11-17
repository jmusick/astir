// The thin platform layer (D12). Everything that differs between the browser and the native apps
// lives under src/platform and is chosen here at run time, so the UI and the sync engine stay one
// codebase. Nothing in here is Windows-specific; Mac and Linux get the same paths.

/** True inside the Tauri app. */
export const isApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const PRODUCTION_ORIGIN = 'https://astir.stonedragonmedia.com';

/**
 * Where the API and the web sign-in pages live. The web view is same-origin (''). A built app
 * talks to Astir's server; an app run with `tauri dev` loads the Vite dev server, which serves the
 * API too, so it stays same-origin there.
 */
export const serverOrigin = (): string => isApp && import.meta.env.PROD ? (import.meta.env.VITE_ASTIR_ORIGIN || PRODUCTION_ORIGIN) : '';

/** The web address for a path, for links the app opens in the browser. */
export const webUrl = (path: string) => `${serverOrigin() || window.location.origin}${path}`;

/** The name a native app gives itself in the devices list (D44). */
export function appName(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const os = /Windows/.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : '';
  return os ? `Astir for ${os}` : 'Astir app';
}

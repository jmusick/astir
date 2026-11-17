/**
 * Install the service worker that keeps the app shell for offline starts (D33). Production builds
 * only: the dev server has no /sw.js, and a cached shell would hide hot reloads.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Without it, Astir still works online; IndexedDB keeps the data either way.
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

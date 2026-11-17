import { shellCache } from './shellCache';

// The web view's service worker (D33), built to /sw.js by the plugin in vite.config.ts. That plugin
// replaces the placeholder below with this build's files, so each deploy gets its own cache.

interface ExtendableEvent extends Event { waitUntil(work: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(response: Promise<Response>): void }
interface WorkerScope {
  location: Location;
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const build = JSON.parse('__ASTIR_SHELL_BUILD__') as { version: string; files: string[] };
const shell = shellCache({
  caches: scope.caches,
  fetch: (request) => scope.fetch(request),
  origin: scope.location.origin,
  files: build.files,
  version: build.version,
});

scope.addEventListener('install', (event) => {
  // A new build takes over at once. Open pages keep the files they already loaded.
  event.waitUntil(shell.install().then(() => scope.skipWaiting()));
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(shell.activate().then(() => scope.clients.claim()));
});

scope.addEventListener('fetch', (event) => {
  if (!shell.handles(event.request)) return;
  event.respondWith(shell.respond(event.request, {
    navigate: event.request.mode === 'navigate',
    waitUntil: (work) => event.waitUntil(work),
  }));
});

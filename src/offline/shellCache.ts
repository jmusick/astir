// The service worker's caching rules (D33), kept apart from the worker globals so they can be
// tested. The cache holds only the app shell, never account data: that lives in IndexedDB (D45),
// and /api is never intercepted.

export const SHELL_CACHE_PREFIX = 'astir-shell-';
/** The shell page. Every navigation gets it, since the app is a single page. */
export const SHELL_PAGE = '/';

export interface ShellCacheOptions {
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
  /** The service worker's origin, e.g. https://astir.stonedragonmedia.com. */
  origin: string;
  /** Built files to keep, as root-relative paths. The shell page is always included. */
  files: readonly string[];
  /** Changes with every build, so a new build gets a fresh cache. */
  version: string;
  /** How long a navigation waits for the network before using the cached shell. */
  navigationTimeoutMs?: number;
}

export interface RespondContext {
  navigate: boolean;
  /** Keeps the worker alive for work that finishes after the response, like a cache refresh. */
  waitUntil: (work: Promise<unknown>) => void;
}

export function shellCache(options: ShellCacheOptions) {
  const { caches, fetch, origin } = options;
  const cacheName = SHELL_CACHE_PREFIX + options.version;
  const timeoutMs = options.navigationTimeoutMs ?? 3_000;
  const shellUrl = new URL(SHELL_PAGE, origin).href;
  const urls = [...new Set([SHELL_PAGE, ...options.files])].map((file) => new URL(file, origin).href);

  let opened: Promise<Cache> | undefined;
  // One lookup for the worker's life; a failed open is retried next time.
  const open = () => opened ??= caches.open(cacheName).catch((error: unknown) => { opened = undefined; throw error; });
  const cachedShell = async () => (await open()).match(shellUrl);

  /** Fetch a page and keep it as the shell when it's a good one. */
  async function refreshShell(request: Request) {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('Content-Type') ?? '').includes('text/html')) {
      await (await open()).put(shellUrl, response.clone());
    }
    return response;
  }

  return {
    cacheName,

    /** Fetch every shell file fresh. If one fails, installing fails and the browser retries later. */
    async install() {
      const cache = await open();
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
    },

    /** Drop earlier builds' caches. Other caches on this origin aren't ours to touch. */
    async activate() {
      for (const key of await caches.keys()) {
        if (key.startsWith(SHELL_CACHE_PREFIX) && key !== cacheName) await caches.delete(key);
      }
    },

    /** Same-origin GETs outside /api. Everything else goes straight to the network. */
    handles(request: Request) {
      const url = new URL(request.url);
      return request.method === 'GET' && url.origin === origin && url.pathname !== '/api' && !url.pathname.startsWith('/api/');
    },

    async respond(request: Request, context: RespondContext): Promise<Response> {
      if (context.navigate) {
        // Network first, so a new deploy shows up at once. A slow or failed network, or a server
        // error, falls back to the cached shell; the app then opens from IndexedDB.
        const network = refreshShell(request);
        context.waitUntil(network.catch(() => undefined));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        const response = await Promise.race([network.catch(() => null), timedOut]).finally(() => clearTimeout(timer));
        if (response && response.status < 500) return response;
        const cached = await cachedShell();
        if (cached) return cached;
        return response ?? network;
      }
      const url = new URL(request.url);
      if (url.pathname === SHELL_PAGE) {
        // A script asking for the page itself wants the current build; the cache is only for offline.
        try { return await fetch(request); } catch (error) {
          const shellCopy = await cachedShell();
          if (shellCopy) return shellCopy;
          throw error;
        }
      }
      const cached = await (await open()).match(request);
      if (cached) return cached;
      const response = await fetch(request);
      // Built assets have hashed names, so a later request for the same name wants the same bytes.
      if (response.ok && url.pathname.startsWith('/assets/')) {
        const copy = response.clone();
        context.waitUntil(open().then((cache) => cache.put(request, copy)).catch(() => undefined));
      }
      return response;
    },
  };
}

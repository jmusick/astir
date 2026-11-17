import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHELL_CACHE_PREFIX, shellCache } from '../../src/offline/shellCache';

const ORIGIN = 'https://astir.test';
const at = (path: string) => `${ORIGIN}${path}`;
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

// Just enough of CacheStorage for the shell's rules: one Map of URL -> body per cache.
class FakeCache {
  entries = new Map<string, Response>();
  constructor(private readonly fetcher: (request: Request) => Promise<Response>) {}
  async match(request: RequestInfo) {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.get(url)?.clone();
  }
  async put(request: RequestInfo, response: Response) {
    this.entries.set(typeof request === 'string' ? request : request.url, response);
  }
  async addAll(requests: Request[]) {
    const responses = await Promise.all(requests.map((request) => this.fetcher(request)));
    if (responses.some((r) => !r.ok)) throw new TypeError('addAll failed');
    requests.forEach((request, i) => this.entries.set(request.url, responses[i]));
  }
}
class FakeCaches {
  stores = new Map<string, FakeCache>();
  constructor(private readonly fetcher: (request: Request) => Promise<Response>) {}
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.fetcher));
    return this.stores.get(name)!;
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name: string) { return this.stores.delete(name); }
}

function setup(serve: (request: Request) => Promise<Response>) {
  const requests: Request[] = [];
  const fetcher = vi.fn(async (request: Request) => { requests.push(request); return serve(request); });
  const caches = new FakeCaches(fetcher);
  const pending: Promise<unknown>[] = [];
  const shell = shellCache({
    caches: caches as unknown as CacheStorage, fetch: fetcher, origin: ORIGIN,
    files: ['/assets/index-abc.js', '/assets/index-abc.css'], version: 'v2', navigationTimeoutMs: 1_000,
  });
  const context = (navigate: boolean) => ({ navigate, waitUntil: (work: Promise<unknown>) => { pending.push(work); } });
  const settle = () => Promise.all(pending);
  const cache = () => caches.open(shell.cacheName);
  return { shell, caches, requests, context, settle, cache };
}
const ok = async (request: Request) => new URL(request.url).pathname === '/' ? html('shell') : new Response(`body of ${request.url}`);
const offline = async (): Promise<Response> => { throw new TypeError('Failed to fetch'); };

afterEach(() => { vi.useRealTimers(); });

describe('service worker shell cache', () => {
  it('fetches the shell page and every built file fresh on install', async () => {
    const { shell, requests, cache } = setup(ok);
    await shell.install();
    expect(requests.map((r) => [r.url, r.cache])).toEqual([
      [at('/'), 'reload'], [at('/assets/index-abc.js'), 'reload'], [at('/assets/index-abc.css'), 'reload'],
    ]);
    expect([...(await cache()).entries.keys()]).toHaveLength(3);
  });

  it('removes earlier builds’ caches on activate and leaves other caches alone', async () => {
    const { shell, caches } = setup(ok);
    await caches.open(`${SHELL_CACHE_PREFIX}v1`);
    await caches.open('someone-else');
    await shell.install();
    await shell.activate();
    expect(await caches.keys()).toEqual(['someone-else', `${SHELL_CACHE_PREFIX}v2`]);
  });

  it('only handles same-origin GETs outside the API', () => {
    const { shell } = setup(ok);
    expect(shell.handles(new Request(at('/')))).toBe(true);
    expect(shell.handles(new Request(at('/assets/index-abc.js')))).toBe(true);
    expect(shell.handles(new Request(at('/api')))).toBe(false);
    expect(shell.handles(new Request(at('/api/sync/pull?cursor=0')))).toBe(false);
    expect(shell.handles(new Request(at('/'), { method: 'POST' }))).toBe(false);
    expect(shell.handles(new Request('https://challenges.cloudflare.com/turnstile/v0/api.js'))).toBe(false);
  });

  it('serves navigations from the network while online and keeps the newest shell', async () => {
    let serve = ok; // Install caches 'shell'.
    const { shell, context, settle, cache } = setup((request) => serve(request));
    await shell.install();
    serve = async () => html('new shell');
    const response = await shell.respond(new Request(at('/?mode=verify')), context(true));
    expect(await response.text()).toBe('new shell');
    await settle();
    expect(await (await (await cache()).match(at('/')))!.text()).toBe('new shell');
  });

  it('fetches the page itself from the network for scripts, using the cache only offline', async () => {
    let serve = ok;
    const { shell, context } = setup((request) => serve(request));
    await shell.install();
    serve = async () => html('new shell');
    expect(await (await shell.respond(new Request(at('/')), context(false))).text()).toBe('new shell');
    serve = offline;
    expect(await (await shell.respond(new Request(at('/')), context(false))).text()).toBe('shell');
  });

  it('serves the cached shell for any page when the network is down', async () => {
    let serve = ok;
    const { shell, context } = setup((request) => serve(request));
    await shell.install();
    serve = offline;
    for (const path of ['/', '/?mode=reset']) {
      expect(await (await shell.respond(new Request(at(path)), context(true))).text()).toBe('shell');
    }
  });

  it('serves the cached shell when the server errors, but passes other answers through', async () => {
    let serve = ok;
    const { shell, context, cache } = setup((request) => serve(request));
    await shell.install();
    serve = async () => html('Bad gateway', 502);
    expect(await (await shell.respond(new Request(at('/')), context(true))).text()).toBe('shell');
    serve = async () => html('Not here', 404);
    expect((await shell.respond(new Request(at('/missing')), context(true))).status).toBe(404);
    expect(await (await (await cache()).match(at('/')))!.text()).toBe('shell'); // Error pages never replace it.
  });

  it('stops waiting on a slow network and refreshes the shell when it answers', async () => {
    vi.useFakeTimers();
    let serve = ok;
    const { shell, context, settle, cache } = setup((request) => serve(request));
    await shell.install();
    let answer: (response: Response) => void = () => undefined;
    serve = () => new Promise((resolve) => { answer = resolve; });
    const responding = shell.respond(new Request(at('/')), context(true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await (await responding).text()).toBe('shell');
    answer(html('newer shell'));
    await settle();
    expect(await (await (await cache()).match(at('/')))!.text()).toBe('newer shell');
  });

  it('fails a navigation with nothing cached and no network', async () => {
    const { shell, context } = setup(offline);
    await expect(shell.respond(new Request(at('/')), context(true))).rejects.toThrow('Failed to fetch');
  });

  it('serves built files from the cache first and keeps new hashed assets', async () => {
    let serve = ok;
    const { shell, context, settle, cache, requests } = setup((request) => serve(request));
    await shell.install();
    serve = offline;
    expect(await (await shell.respond(new Request(at('/assets/index-abc.js')), context(false))).text()).toContain('index-abc.js');
    serve = ok;
    const before = requests.length;
    await shell.respond(new Request(at('/assets/later-def.js')), context(false));
    await shell.respond(new Request(at('/favicon.ico')), context(false));
    await settle();
    expect(requests.length).toBe(before + 2);
    expect(await (await cache()).match(at('/assets/later-def.js'))).toBeDefined();
    expect(await (await cache()).match(at('/favicon.ico'))).toBeUndefined();
  });
});

// The Astir API. Static assets (the React shell) are served by Cloudflare before this runs, and
// wrangler.jsonc sends every /api/* request here. Routing is a single-file dispatcher, as in
// Tagstash: match the method and path, call a handler.
import { withApiHeaders } from './headers';
import { handleAuth } from './auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

type DatabaseStatus = 'ok' | 'not configured' | 'error';

// Reports whether D1 answers, without ever failing the health check itself.
const databaseStatus = async (db: D1Database | undefined): Promise<DatabaseStatus> => {
  if (!db) return 'not configured';
  try {
    await db.prepare('SELECT 1').first();
    return 'ok';
  } catch {
    return 'error';
  }
};

async function routeRequest(request: Request, env: Env, context?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  try {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      return json({ error: 'Route not found' }, 404);
    }

    // Checked before the D1 binding so it works as a liveness probe without a database.
    // HEAD too, for uptime monitors; the runtime drops the body.
    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/health') {
      return json({ status: 'ok', database: await databaseStatus(env.DB) });
    }

    if (!env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);

    if (pathname.startsWith('/api/auth/')) return handleAuth(request, env, context);

    return json({ error: 'Route not found' }, 404);
  } catch (error) {
    console.error('API handler error:', error);
    return json({ error: 'Something went wrong!' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env, context?: Pick<ExecutionContext, 'waitUntil'>) {
    return withApiHeaders(await routeRequest(request, env, context), request, env);
  },
} satisfies ExportedHandler<Env>;

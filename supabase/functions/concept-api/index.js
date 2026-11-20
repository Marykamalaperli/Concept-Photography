import postgres from 'npm:postgres@3.4.9';
import { createApi } from '../_shared/workspace-api.js';
import { numericTypes, postgresAdapter } from '../_shared/postgres-adapter.js';

const databaseUrl = Deno.env.get('SUPABASE_DB_URL');
const siteOrigin = Deno.env.get('CONCEPT_SITE_ORIGIN');
if (!databaseUrl || !siteOrigin || new URL(siteOrigin).origin !== siteOrigin) {
  throw new Error('Set SUPABASE_DB_URL and CONCEPT_SITE_ORIGIN before serving the workspace.');
}

const dbHost = new URL(databaseUrl).hostname;
const local = ['localhost', '127.0.0.1', '[::1]'].includes(dbHost);
const ca = Deno.env.get('CONCEPT_DB_CA');
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  types: numericTypes,
});

const api = createApi(postgresAdapter(sql), {
  bearer: true,
  setupToken: Deno.env.get('ADMIN_SETUP_TOKEN'),
  siteOrigin,
});

Deno.serve(async (request, info) => {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  const json = (status, payload) => Response.json(payload, { status, headers });
  if (origin && origin !== siteOrigin) return json(403, { error: 'Open the studio’s website to access the workspace.' });
  if (origin === siteOrigin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = url.pathname.replace(/^\/(?:functions\/v1\/)?concept-api(?=\/)/, '');
  if (!path.startsWith('/api/')) return json(404, { error: 'Route not found.' });

  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    socket: {
      remoteAddress: request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
        info.remoteAddr?.hostname || 'supabase-edge',
    },
    async *[Symbol.asyncIterator]() {
      if (request.body) yield* request.body;
    },
  };
  try {
    return json(200, await api(req, null, path));
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Concept API request failed.', error.name, error.code);
    return json(status, { error: status === 500 ? 'Something went wrong. Try again.' : error.message });
  }
});

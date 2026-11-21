import postgres from 'npm:postgres@3.4.9';
import webPush from 'npm:web-push@3.6.7';
import { createApi } from '../_shared/workspace-api.js';
import { createCalendar } from '../_shared/calendar.js';
import { createMobilePush } from '../_shared/mobile-push.js';
import { supabaseAdminAuth } from '../_shared/supabase-admin.js';
import { numericTypes, postgresAdapter } from '../_shared/postgres-adapter.js';

const databaseUrl = Deno.env.get('SUPABASE_DB_URL');
const siteOrigin = Deno.env.get('CONCEPT_SITE_ORIGIN');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
if (!databaseUrl || !supabaseUrl || !anonKey || !siteOrigin || new URL(siteOrigin).origin !== siteOrigin) {
  throw new Error('Supabase sign-in requires a project URL, anon key, database URL, and allowed site origin.');
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

const database = postgresAdapter(sql);
const mobilePush = createMobilePush(webPush, siteOrigin);
const adminAuth = supabaseAdminAuth({ url: supabaseUrl, apiKey: anonKey });
const calendar = createCalendar({
  projectUrl: Deno.env.get('CONCEPT_PROJECT_URL') || supabaseUrl,
  workspaceUrl: Deno.env.get('CONCEPT_WORKSPACE_URL') || siteOrigin,
  adminAuth,
});
const api = createApi(database, {
  calendar,
  mobilePush,
  bearer: true,
  adminAuth,
  siteOrigin,
});

Deno.serve(async (request, info) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/(?:functions\/v1\/)?concept-api(?=\/)/, '');
  const feed = path.match(/^\/calendar\/([a-f0-9]{64})\.ics$/);
  if (feed && ['GET', 'HEAD'].includes(request.method)) {
    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      const content = await calendar.read(database, feed[1], { track: request.method === 'GET' });
      return new Response(request.method === 'GET' ? content : null, { status: content === null ? 404 : 200, headers });
    } catch (error) {
      console.error('Calendar request failed.', error.name, error.code);
      return new Response(null, { status: 500, headers });
    }
  }
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
    if (request.method === 'POST' && path === '/api/internal/push-dispatch') {
      return json(200, await mobilePush.dispatch(database, request.headers.get('authorization')));
    }
    return json(200, await api(req, null, path));
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Concept API request failed.', error.name, error.code);
    return json(status, { error: status === 500 ? 'Something went wrong. Try again.' : error.message });
  }
});

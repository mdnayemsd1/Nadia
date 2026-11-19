// GET /api/config — public runtime config for the browser.
// Only the Supabase URL and the public anon/publishable key are returned (both are
// designed to be public; data access is protected by Row Level Security).
// Because it is read at request time, changing env vars never requires editing source code.

import { json } from '../_lib/http.js';
import { readConfig } from '../_lib/supabase.js';

export async function onRequestGet({ env }) {
  const cfg = readConfig(env);
  if (!cfg.url || !cfg.anon) return json({ ok: false, error: 'NOT_CONFIGURED' }, 503);
  return json({ ok: true, supabaseUrl: cfg.url, supabaseAnonKey: cfg.anon }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
}

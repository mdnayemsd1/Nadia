// Minimal Supabase REST client for server-side use (no dependencies).
// The service-role key lives ONLY in Cloudflare secrets and is never sent to the browser.

import { HttpError } from './http.js';

export function readConfig(env) {
  return {
    url: String(env.SUPABASE_URL || '').replace(/\/+$/, ''),
    anon: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '',
    service: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
    tgToken: env.TELEGRAM_BOT_TOKEN || '',
    tgChat: env.TELEGRAM_CHAT_ID || '',
  };
}

function authHeaders(key) {
  const h = { apikey: key };
  // Legacy JWT keys are also sent as Bearer; new-style sb_secret_/sb_publishable_ keys use apikey only.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function parse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return { message: text.slice(0, 200) };
  }
}

/** Call a Postgres function through PostgREST using the service role. */
export async function rpc(cfg, fn, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...authHeaders(cfg.service), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await parse(res);
  if (!res.ok) {
    const err = new Error(data?.message || `RPC ${fn} failed`);
    err.pg = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function selectRows(cfg, pathAndQuery) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    headers: { ...authHeaders(cfg.service), Accept: 'application/json' },
  });
  const data = await parse(res);
  if (!res.ok) throw new Error(data?.message || 'Supabase select failed');
  return data;
}

export async function patchRows(cfg, pathAndQuery, values) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: { ...authHeaders(cfg.service), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const data = await parse(res);
    throw new Error(data?.message || 'Supabase update failed');
  }
}

/** Verify a user's access token and confirm they are in admin_users. Returns { id, role }. */
export async function requireStaff(cfg, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED');

  const res = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anon, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(401, 'UNAUTHENTICATED');
  const user = await res.json();
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new HttpError(401, 'UNAUTHENTICATED');

  const rows = await selectRows(cfg, `admin_users?select=user_id,role&user_id=eq.${user.id}`);
  if (!rows?.length) throw new HttpError(403, 'FORBIDDEN');
  return { id: user.id, role: rows[0].role };
}

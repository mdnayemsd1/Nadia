// GET /api/health — post-deployment check. Reports ONLY whether each setting exists
// (true/false); it never returns any value.

import { json } from '../_lib/http.js';
import { readConfig } from '../_lib/supabase.js';

export async function onRequestGet({ env }) {
  const c = readConfig(env);
  const checks = {
    SUPABASE_URL: !!c.url,
    SUPABASE_ANON_KEY: !!c.anon,
    SUPABASE_SERVICE_ROLE_KEY: !!c.service,
    TELEGRAM_BOT_TOKEN: !!c.tgToken,
    TELEGRAM_CHAT_ID: !!c.tgChat,
  };
  return json({ ok: Object.values(checks).every(Boolean), checks });
}

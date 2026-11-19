// POST /api/retry-telegram — admin-only: re-send the Telegram notification for an order.
// Authorization: Bearer <Supabase user access token>; the user must exist in admin_users.

import { HttpError, json, errorResponse, assertSameOrigin, readJson } from '../_lib/http.js';
import { readConfig, requireStaff } from '../_lib/supabase.js';
import { notifyOrder } from '../_lib/telegram.js';

export async function onRequestPost({ request, env }) {
  try {
    const cfg = readConfig(env);
    if (!cfg.url || !cfg.service || !cfg.anon) throw new HttpError(503, 'SERVER_NOT_CONFIGURED');
    assertSameOrigin(request);
    await requireStaff(cfg, request);

    const body = await readJson(request, 2000);
    const id = String(body.order_id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(422, 'VALIDATION', { fields: { order_id: 'INVALID' } });
    }

    const result = await notifyOrder(cfg, id);
    return json({ ok: result.status === 'sent', telegram: result.status, error: result.error || null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
}

// Shared HTTP helpers for Cloudflare Pages Functions.

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ ok: false, error: err.code, ...err.extra }, err.status);
  }
  console.error('Unhandled error:', err && err.message ? err.message : err);
  return json({ ok: false, error: 'SERVER_ERROR' }, 500);
}

/** Reject cross-site browser requests (a basic CSRF / abuse guard). */
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  let ok = false;
  try {
    ok = new URL(origin).host === new URL(request.url).host;
  } catch (_) {
    ok = false;
  }
  if (!ok) throw new HttpError(403, 'FORBIDDEN_ORIGIN');
}

export async function readJson(request, maxChars = 20000) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE');
  const text = await request.text();
  if (text.length > maxChars) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not object');
    return data;
  } catch (_) {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  if (!ip) return null;
  return (await sha256Hex(`${ip}|${env.IP_HASH_SALT || 'nadia-gadget-house'}`)).slice(0, 32);
}

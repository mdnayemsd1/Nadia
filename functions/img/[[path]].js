// GET /img/<storage path> — same-origin image proxy in front of Supabase Storage.
// Cloudflare caches the response at the edge for a year (filenames are unique and immutable),
// so repeat visitors and nearby users never wait on Supabase for product images.

const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,200}$/;
const ALLOWED_EXT = /\.(webp|avif|jpe?g|png)$/i;

export async function onRequestGet({ request, env, params, waitUntil }) {
  const raw = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!SAFE_PATH.test(raw) || raw.includes('..') || !ALLOWED_EXT.test(raw)) {
    return new Response('Not found', { status: 404 });
  }
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return new Response('Not configured', { status: 503 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + '/img/' + raw, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(`${base}/storage/v1/object/public/product-images/${raw}`, {
    cf: { cacheEverything: true, cacheTtl: 31536000 },
  });
  if (!upstream.ok) return new Response('Not found', { status: upstream.status === 404 ? 404 : 502 });

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'image/webp');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  const response = new Response(upstream.body, { status: 200, headers });
  if (waitUntil) waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

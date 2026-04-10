/**
 * This file is intentionally left as a pass-through.
 * Radar data is served as a static file at /data/radar-latest.json
 * No Cloudflare Function needed.
 */
export async function onRequest() {
  return new Response(null, { status: 301, headers: { Location: "/data/radar-latest.json" } });
}

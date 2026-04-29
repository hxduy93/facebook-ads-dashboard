// GET /api/ga-overview?days=30
// Trả về aggregated GA data cho dashboard tab "Tổng quan GA".
// Cache KV 30 phút để tránh gọi GA Data API quá nhiều.

import { verifySession } from "../_middleware.js";
import { getGAOverview } from "../lib/googleAnalytics.js";

const SESSION_COOKIE = "doscom_session";
const CACHE_TTL = 1800; // 30 phút

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 90);
  const forceRefresh = url.searchParams.get("force_refresh") === "1";

  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);

  if (!env.GA_SERVICE_ACCOUNT_JSON || !env.GA_PROPERTY_ID) {
    return jsonResponse({ error: "GA credentials not configured", configured: false }, 503);
  }

  const cacheKey = `ga_overview:v1:${days}d`;

  // Try cache
  if (!forceRefresh && env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get(cacheKey, { type: "json" });
      if (cached) return jsonResponse({ ...cached, cached: true });
    } catch { /* ignore */ }
  }

  // Fetch fresh
  let data;
  try {
    data = await getGAOverview(env, days);
  } catch (e) {
    return jsonResponse({ error: String(e.message || e), configured: true }, 502);
  }

  const fetchedAt = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const payload = { ok: true, data, fetched_at: fetchedAt, cached: false };

  if (env.INVENTORY) {
    try {
      await env.INVENTORY.put(cacheKey, JSON.stringify({ ok: true, data, fetched_at: fetchedAt }), {
        expirationTtl: CACHE_TTL,
      });
    } catch { /* ignore */ }
  }

  return jsonResponse(payload);
}

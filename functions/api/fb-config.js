/**
 * Cloudflare Pages Function: GET/POST /api/fb-config
 * ----------------------------------------------------
 * Quản lý config tháng cho FB Ads agent:
 *   - close_rate_pct: tỉ lệ chốt FB lead → đơn thực (cập nhật hằng tháng)
 *   - vat_pct: % VAT
 *   - account_to_groups: mapping account FB → nhóm sản phẩm (để tính profit attribution)
 *
 * Storage:
 *   - GET đầu tiên: load từ /data/fb-config.json (default)
 *   - POST update: lưu vào KV `fb_config` (override default)
 *   - GET sau đó: ưu tiên KV, fallback default
 *
 * GET /api/fb-config
 *   → { close_rate_pct, vat_pct, account_to_groups, updated_at, updated_by, source: "kv"|"default" }
 *
 * POST /api/fb-config (body)
 *   { close_rate_pct, vat_pct, account_to_groups? }
 *   → { ok: true, saved_at, ... }
 *
 * Auth: cần session (cookie doscom_session).
 */

import { verifySession, hasTestBypass } from "../_middleware.js";

const SESSION_COOKIE = "doscom_session";
const KV_KEY = "fb_config";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function loadDefaultConfig(origin) {
  try {
    const r = await fetch(new URL("/data/fb-config.json", origin).toString());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Ưu tiên KV (config user đã edit). Fallback default file.
  if (env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get(KV_KEY, { type: "json" });
      if (cached) {
        return json({ ...cached, source: "kv" });
      }
    } catch { /* ignore */ }
  }

  const origin = new URL(request.url).origin;
  const def = await loadDefaultConfig(origin);
  if (!def) {
    return json({
      close_rate_pct: 65,
      vat_pct: 10,
      account_to_groups: {},
      source: "fallback",
      _note: "Default file load fail — return hard-coded fallback",
    });
  }
  return json({ ...def, source: "default" });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.INVENTORY) {
    return json({ error: "KV INVENTORY chưa cấu hình — không thể save config" }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Body không phải JSON hợp lệ" }, 400); }

  const closeRate = Number(body.close_rate_pct);
  const vat = Number(body.vat_pct);
  if (isNaN(closeRate) || closeRate < 0 || closeRate > 100) {
    return json({ error: "close_rate_pct phải là số 0-100" }, 400);
  }
  if (isNaN(vat) || vat < 0 || vat > 50) {
    return json({ error: "vat_pct phải là số 0-50" }, 400);
  }

  // Load existing config (để giữ account_to_groups nếu user không gửi)
  let existing = null;
  try {
    existing = await env.INVENTORY.get(KV_KEY, { type: "json" });
  } catch { /* ignore */ }
  if (!existing) {
    const origin = new URL(request.url).origin;
    existing = await loadDefaultConfig(origin) || {};
  }

  const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const newConfig = {
    close_rate_pct: closeRate,
    vat_pct: vat,
    fb_spend_to_revenue_target_pct: existing.fb_spend_to_revenue_target_pct || 40,
    account_to_groups: body.account_to_groups || existing.account_to_groups || {},
    updated_at: nowVN,
    updated_by: session?.email || "test_bypass",
  };

  try {
    // KV không có TTL — config persist mãi cho đến khi user update lần sau
    await env.INVENTORY.put(KV_KEY, JSON.stringify(newConfig));
  } catch (e) {
    return json({ error: `KV write fail: ${e.message}` }, 500);
  }

  return json({
    ok: true,
    saved_at: nowVN,
    config: newConfig,
  });
}

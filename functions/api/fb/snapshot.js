// GET /api/fb/snapshot?time=last_7d&group=ALL&account_id=&start=&end=
//
// Trả về tổng hợp data FB Ads cho UI render (không call AI):
// - Time range resolved (start/end + label)
// - Profit summary (revenue, orders, profit, margin) cho time range + group
// - Account list (6 FB ad accounts) với spend/leads của time range
// - Campaign list (nếu account_id provided)
// - Per-group breakdown
//
// Time presets: today | yesterday | this_week | last_week | this_month
//                last_month | last_7d | last_30d | last_90d | custom
// Custom yêu cầu start + end (YYYY-MM-DD).

import { verifySession, hasTestBypass } from "../../_middleware.js";
import {
  FB_ACTIVE_GROUPS,
  FB_GROUP_LABELS,
  resolveTimeRange,
  compactFbOrdersInRange,
  computeFbProfitInRange,
  compactFbAccounts,
  compactFbCampaigns,
} from "../../lib/fbAdsHelpers.js";

const SESSION_COOKIE = "doscom_session";

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

async function fetchJson(origin, path, cookieHeader) {
  try {
    const r = await fetch(new URL(path, origin).toString(), { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const timePreset = url.searchParams.get("time") || "last_30d";
  const customStart = url.searchParams.get("start");
  const customEnd = url.searchParams.get("end");
  const group = url.searchParams.get("group") || "ALL";
  const accountId = url.searchParams.get("account_id");

  const timeRange = resolveTimeRange(timePreset, customStart, customEnd);
  if (!timeRange) {
    return jsonResponse({ error: "Invalid time preset hoặc thiếu start/end khi custom" }, 400);
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = new URL(request.url).origin;

  // Parallel fetch
  const [revJson, costsJson, fbAdsJson] = await Promise.all([
    fetchJson(origin, "/data/product-revenue.json", cookieHeader),
    fetchJson(origin, "/data/product-costs.json", cookieHeader),
    fetchJson(origin, "/data/fb-ads-data.json", cookieHeader),
  ]);

  // Profit (Pancake-based, theo time range + group)
  const profit = revJson && costsJson
    ? computeFbProfitInRange(revJson, costsJson, group, timeRange)
    : { has_data: false, error: "Missing product-revenue or product-costs JSON" };

  // Orders breakdown
  const orders = revJson
    ? compactFbOrdersInRange(revJson, group, timeRange)
    : { has_data: false };

  // Account list
  const accounts = compactFbAccounts(fbAdsJson, timeRange);

  // Campaigns (nếu chọn account)
  let campaigns = null;
  if (accountId) {
    campaigns = compactFbCampaigns(fbAdsJson, accountId, timeRange);
  }

  return jsonResponse({
    ok: true,
    time_range: timeRange,
    group,
    group_label: FB_GROUP_LABELS[group] || "Tất cả",
    profit,
    orders,
    accounts,
    campaigns,
    presets_available: ["today","yesterday","this_week","last_week","this_month","last_month","last_7d","last_30d","last_90d","custom"],
    fb_active_groups: FB_ACTIVE_GROUPS,
    generated_at: new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
  });
}

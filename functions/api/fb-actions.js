/**
 * Cloudflare Pages Function: POST /api/fb-actions
 * --------------------------------------------------
 * Thực thi các hành động tối ưu campaign FB do AI suggest:
 *   - pause: pause campaign (set status = PAUSED)
 *   - update_budget: tăng/giảm daily_budget của adset (max +50% per click)
 *   - duplicate_adset: nhân adset (Meta /copies endpoint) — adset mới ở PAUSED
 *
 * SAFETY:
 *   - Cần authenticated session (cookie doscom_session)
 *   - Sanity check: budget mới ≤ 5M VND/ngày, ratio ≤ 1.5 (không tăng > 50%)
 *   - Confirm 2 bước phải diễn ra ở frontend trước khi gọi endpoint này
 *   - Mọi action đều log vào KV `fb_action_log` (giữ 100 entry gần nhất, TTL 60 ngày)
 *
 * Request body:
 *   {
 *     action: "pause" | "update_budget" | "duplicate_adset",
 *     campaign_id: "...",          // bắt buộc
 *     ai_verdict: "SCALE",         // optional, để log
 *     ai_reason: "...",            // optional, để log
 *     // For update_budget:
 *     new_budget_vnd: 600000       // bắt buộc cho update_budget
 *   }
 *
 * Response:
 *   - 200 { success: true, before, after, ... }
 *   - 400 { error, hint? }    — bad input / sanity reject
 *   - 401 { error }           — not authenticated
 *   - 502 { error }           — Meta API fail
 */

import { verifySession, hasTestBypass } from "../_middleware.js";

const FB_API_VERSION = "v20.0";
const GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;
const SESSION_COOKIE = "doscom_session";

// SAFETY LIMITS
const MAX_DAILY_BUDGET_VND = 5_000_000;   // không cho tăng vượt 5M VND/ngày
const MAX_BUDGET_INCREASE_RATIO = 1.5;    // không tăng > 50% so budget hiện tại

// AUDIT LOG
const ACTION_LOG_KEY = "fb_action_log";
const ACTION_LOG_MAX_ENTRIES = 100;
const ACTION_LOG_TTL_SECONDS = 60 * 86400;  // 60 ngày

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

async function fbGet(endpoint, params, token) {
  const qs = new URLSearchParams(params || {});
  qs.append("access_token", token);
  const r = await fetch(`${GRAPH}${endpoint}?${qs}`, {
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON ${r.status}` } }));
  if (!r.ok || data.error) throw new Error(data.error?.message || `HTTP ${r.status}`);
  return data;
}

async function fbPost(endpoint, body, token) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    params.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  params.append("access_token", token);
  const r = await fetch(`${GRAPH}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON ${r.status}` } }));
  if (!r.ok || data.error) {
    throw new Error(data.error?.error_user_msg || data.error?.message || `HTTP ${r.status}`);
  }
  return data;
}

async function logAction(env, entry) {
  if (!env.INVENTORY) return;
  try {
    const existing = (await env.INVENTORY.get(ACTION_LOG_KEY, { type: "json" })) || [];
    const updated = [entry, ...existing].slice(0, ACTION_LOG_MAX_ENTRIES);
    await env.INVENTORY.put(ACTION_LOG_KEY, JSON.stringify(updated), {
      expirationTtl: ACTION_LOG_TTL_SECONDS,
    });
  } catch (e) {
    console.log(`[ACTION LOG FAIL] ${e.message}`);
  }
}

// Lấy adset đầu tiên của campaign + budget hiện tại
async function fetchPrimaryAdset(token, campaignId) {
  const data = await fbGet(`/${campaignId}/adsets`, {
    fields: "id,name,daily_budget,lifetime_budget,status,effective_status",
    limit: 5,
  }, token);
  const list = data.data || [];
  if (list.length === 0) return null;
  // Ưu tiên adset đang ACTIVE, fallback adset đầu
  return list.find((a) => a.effective_status === "ACTIVE") || list[0];
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return json({ error: "Unauthorized — cần đăng nhập" }, 401);
  }
  const userEmail = session?.email || "test_bypass";

  const token = env.FB_ACCESS_TOKEN;
  if (!token) return json({ error: "FB_ACCESS_TOKEN chưa cấu hình trong Cloudflare env" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ" }, 400);
  }

  const { action, campaign_id, ai_verdict, ai_reason } = body;
  if (!action) return json({ error: "Thiếu field 'action'" }, 400);
  if (!campaign_id) return json({ error: "Thiếu field 'campaign_id'" }, 400);

  const nowIso = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

  try {
    // ═══════════════════════ ACTION: PAUSE ═══════════════════════
    if (action === "pause") {
      const before = await fbGet(`/${campaign_id}`, {
        fields: "name,status,effective_status,daily_budget",
      }, token);

      if (before.effective_status === "PAUSED") {
        return json({ error: "Campaign đã PAUSED rồi", current_status: before.effective_status }, 400);
      }

      await fbPost(`/${campaign_id}`, { status: "PAUSED" }, token);

      const after = await fbGet(`/${campaign_id}`, {
        fields: "name,status,effective_status",
      }, token);

      await logAction(env, {
        timestamp: nowIso,
        action: "pause",
        campaign_id,
        campaign_name: before.name,
        ai_verdict: ai_verdict || null,
        ai_reason: (ai_reason || "").slice(0, 200),
        user: userEmail,
        before: { status: before.status, effective_status: before.effective_status },
        after: { status: after.status, effective_status: after.effective_status },
      });

      return json({
        success: true,
        action: "pause",
        campaign_id,
        campaign_name: before.name,
        before: { effective_status: before.effective_status },
        after: { effective_status: after.effective_status },
        message: `Đã PAUSE campaign "${before.name}". Vào Ads Manager để reactivate khi cần.`,
      });
    }

    // ═══════════════════════ ACTION: UPDATE_BUDGET ═══════════════════════
    if (action === "update_budget") {
      const newBudget = Number(body.new_budget_vnd) || 0;
      if (newBudget <= 0) {
        return json({ error: "new_budget_vnd phải > 0" }, 400);
      }
      if (newBudget > MAX_DAILY_BUDGET_VND) {
        return json({
          error: `Budget mới ${newBudget.toLocaleString()}đ vượt ngưỡng an toàn ${MAX_DAILY_BUDGET_VND.toLocaleString()}đ.`,
          hint: "Vào Ads Manager để update tay nếu thực sự muốn budget cao hơn 5M/ngày.",
        }, 400);
      }

      const adset = await fetchPrimaryAdset(token, campaign_id);
      if (!adset) return json({ error: "Không tìm thấy adset của campaign này" }, 404);

      const currentBudget = Number(adset.daily_budget) || 0;
      if (currentBudget === 0) {
        return json({
          error: "Adset đang dùng lifetime_budget hoặc CBO (campaign-level budget) — không hỗ trợ update qua nút này.",
          hint: "Vào Ads Manager update tay.",
        }, 400);
      }

      const ratio = newBudget / currentBudget;
      if (ratio > MAX_BUDGET_INCREASE_RATIO) {
        const pct = ((ratio - 1) * 100).toFixed(0);
        return json({
          error: `Tăng budget +${pct}% vượt ngưỡng an toàn +50%.`,
          hint: `Đề xuất: tăng tối đa ${Math.round(currentBudget * MAX_BUDGET_INCREASE_RATIO).toLocaleString()}đ trong 1 lần. Lần sau tăng tiếp nếu CPA giữ.`,
          current_budget: currentBudget,
          requested_budget: newBudget,
          max_safe_budget: Math.round(currentBudget * MAX_BUDGET_INCREASE_RATIO),
        }, 400);
      }

      await fbPost(`/${adset.id}`, { daily_budget: String(newBudget) }, token);

      await logAction(env, {
        timestamp: nowIso,
        action: "update_budget",
        campaign_id,
        adset_id: adset.id,
        adset_name: adset.name,
        ai_verdict: ai_verdict || null,
        ai_reason: (ai_reason || "").slice(0, 200),
        user: userEmail,
        before: { daily_budget: currentBudget },
        after: { daily_budget: newBudget },
        delta_pct: Math.round((ratio - 1) * 1000) / 10,
      });

      return json({
        success: true,
        action: "update_budget",
        adset_id: adset.id,
        adset_name: adset.name,
        before: currentBudget,
        after: newBudget,
        delta_pct: Math.round((ratio - 1) * 1000) / 10,
        message: `Đã tăng daily budget từ ${currentBudget.toLocaleString()}đ → ${newBudget.toLocaleString()}đ (+${((ratio-1)*100).toFixed(1)}%).`,
      });
    }

    // ═══════════════════════ ACTION: DUPLICATE_ADSET ═══════════════════════
    if (action === "duplicate_adset") {
      const adset = await fetchPrimaryAdset(token, campaign_id);
      if (!adset) return json({ error: "Không tìm thấy adset để duplicate" }, 404);

      // Meta /copies endpoint — adset mới mặc định PAUSED để user kiểm tra trước
      const dup = await fbPost(`/${adset.id}/copies`, {
        deep_copy: true,
        rename_options: { rename_strategy: "DEEP_RENAME", rename_suffix: " - Copy " + new Date().toISOString().slice(5, 10) },
        status_option: "PAUSED",
      }, token);

      const newAdsetId = dup.copied_adset_id || dup.id;

      await logAction(env, {
        timestamp: nowIso,
        action: "duplicate_adset",
        campaign_id,
        original_adset_id: adset.id,
        new_adset_id: newAdsetId,
        ai_verdict: ai_verdict || null,
        ai_reason: (ai_reason || "").slice(0, 200),
        user: userEmail,
      });

      return json({
        success: true,
        action: "duplicate_adset",
        original_adset_id: adset.id,
        new_adset_id: newAdsetId,
        message: `Đã nhân adset "${adset.name}". Adset mới đang PAUSED, vào Ads Manager để: (1) đổi audience interest, (2) review creative, (3) Activate.`,
        next_step: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=&selected_adset_ids=${newAdsetId}`,
      });
    }

    return json({ error: `Unknown action: ${action}. Supported: pause, update_budget, duplicate_adset` }, 400);

  } catch (e) {
    const msg = String(e.message || e);
    console.log(`[FB-ACTION FAIL] ${action} campaign=${campaign_id}: ${msg}`);

    // Log fail vào audit log để track
    await logAction(env, {
      timestamp: nowIso,
      action,
      campaign_id,
      ai_verdict: ai_verdict || null,
      user: userEmail,
      success: false,
      error: msg.slice(0, 300),
    });

    return json({
      error: `Meta API fail: ${msg.slice(0, 300)}`,
      hint: msg.includes("permission") ? "Token thiếu quyền ads_management — generate lại token trên Meta Developer Console" : null,
    }, 502);
  }
}

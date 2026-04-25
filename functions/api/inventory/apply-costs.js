// API Apply Costs — gán giá nhập từ /data/excel-costs.json vào KV
// Endpoint: POST /api/inventory/apply-costs
// Body: { keep_user_edits?: bool (default true) }
//
// Logic:
// 1. Đọc /data/excel-costs.json (memory_cards + products)
// 2. Iterate tất cả SP trong KV INVENTORY
// 3. Match KV name với Excel "mã tên gọi" (longest match first → tránh DA8.1 ăn nhầm DA8.1 Pro)
// 4. Nếu KV name có "thẻ nhớ XXG" → cộng thêm giá thẻ nhớ tương ứng
// 5. Ghi gia_nhap_vnd, giữ giá user đã sửa thủ công

import { verifySession } from "../../_middleware.js";

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

function norm(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

// Tìm giá nhập cơ bản cho SP từ Excel
// kvName: tên SP trong KV (đã lowercase). codes: mảng [(code_norm, cost)] đã sort length DESC
function findBaseCost(kvName, codes) {
  const n = norm(kvName);
  for (const [code_norm, cost] of codes) {
    // Match nếu code xuất hiện như prefix hoặc với word boundary
    // Dùng regex: code phải kết thúc tại ranh giới từ
    if (n.startsWith(code_norm + " ") || n === code_norm || n.startsWith(code_norm + "(")) {
      return { match: code_norm, cost };
    }
    // Fallback: code xuất hiện trong tên với boundary
    const pattern = new RegExp("(?:^|\\s)" + code_norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\s|$|\\()");
    if (pattern.test(n)) {
      return { match: code_norm, cost };
    }
  }
  return null;
}

// Detect thẻ nhớ trong tên: "thẻ nhớ 64g", "thẻ nhớ 128gb", v.v.
function detectMemoryCard(kvName) {
  const m = kvName.match(/thẻ\s*nhớ\s*(\d+)\s*g/i);
  if (m) return m[1] + "g";
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method !== "POST") {
    return jsonResponse({ error: "Chỉ POST" }, 405);
  }

  if (!env.INVENTORY) {
    return jsonResponse({ error: "KV binding INVENTORY chưa cấu hình" }, 500);
  }

  // Auth check
  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Chưa đăng nhập dashboard" }, 401);
  const email = (session.email || "").toLowerCase();

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const writeKeepUserEdit = body.keep_user_edits !== false;  // default true

  // 1. Load excel-costs.json
  let costs;
  try {
    const cookieHeader = request.headers.get("Cookie") || "";
    const costsUrl = new URL("/data/excel-costs.json", url.origin).toString();
    const resp = await fetch(costsUrl, { headers: { Cookie: cookieHeader } });
    if (!resp.ok) {
      return jsonResponse({ error: `Không tải được excel-costs.json (HTTP ${resp.status})` }, 502);
    }
    costs = await resp.json();
  } catch (e) {
    return jsonResponse({ error: "Lỗi load excel-costs.json: " + e.message }, 500);
  }

  const memoryCards = costs.memory_cards || {};
  const products = costs.products || {};

  // 2. Build sorted code list (longest first → DA8.1 PRO matched trước DA8.1)
  const codeList = Object.entries(products)
    .map(([k, v]) => [k, Number(v.gia_nhap_vnd) || 0])
    .filter(([k, c]) => c > 0)
    .sort((a, b) => b[0].length - a[0].length);

  // 3. Iterate KV — parallel batched (Cloudflare Workers cho phép 50 concurrent subrequests)
  let updated = 0, kept_user = 0, no_match = 0, with_card = 0;
  const samples_updated = [];
  const samples_no_match = [];

  const list = await env.INVENTORY.list({ limit: 1000 });

  async function processOne(code) {
    let existing;
    try {
      existing = await env.INVENTORY.get(code, { type: "json" });
    } catch (e) { return; }
    if (!existing) return;

    if (writeKeepUserEdit && existing.updated_by &&
        !existing.updated_by.startsWith("import:") &&
        !existing.updated_by.startsWith("sync:") &&
        !existing.updated_by.startsWith("cost-import:")) {
      kept_user++;
      return;
    }

    const matched = findBaseCost(code, codeList);
    if (!matched) {
      no_match++;
      if (samples_no_match.length < 20) samples_no_match.push(code);
      return;
    }

    let finalCost = matched.cost;
    const cardKey = detectMemoryCard(code);
    if (cardKey && memoryCards[cardKey]) {
      finalCost += Number(memoryCards[cardKey]) || 0;
      with_card++;
    }

    if (existing.gia_nhap_vnd === finalCost) return;

    const newValue = {
      ...existing,
      gia_nhap_vnd: finalCost,
      updated_at: new Date().toISOString(),
      updated_by: "cost-import:excel by " + email,
    };
    try {
      await env.INVENTORY.put(code, JSON.stringify(newValue));
      updated++;
      if (samples_updated.length < 20) {
        samples_updated.push({ code, match: matched.match, cost: finalCost, card: cardKey });
      }
    } catch (e) { /* skip */ }
  }

  // Process in batches of 25 (Cloudflare safe limit, leaves room for read+write subrequests)
  const BATCH = 25;
  for (let i = 0; i < list.keys.length; i += BATCH) {
    const slice = list.keys.slice(i, i + BATCH);
    await Promise.all(slice.map(k => processOne(k.name)));
  }

  return jsonResponse({
    ok: true,
    total_kv_items: list.keys.length,
    excel_codes_loaded: codeList.length,
    memory_cards_loaded: Object.keys(memoryCards).length,
    updated,
    kept_user_edits: kept_user,
    with_memory_card: with_card,
    no_match,
    samples_updated,
    samples_no_match,
  });
}

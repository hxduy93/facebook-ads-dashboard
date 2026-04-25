// API Sync POS — proxy fetch POS Pancake → ghi vào Inventory KV
// Endpoint: POST /api/inventory/sync-pos
// Body: { access_token: "POS access token from localStorage" }
//
// Logic:
// 1. Server-side fetch tất cả products + variations từ POS Pancake API
// 2. Đọc product-costs.json (Misa) để enrich giá vốn (vì POS API không trả về cogs/purchasing_price)
// 3. Match by tên: nếu Misa có giá vốn cho mã đó → dùng, không có → để 0
// 4. Ghi tất cả vào KV (giữ updated_by của user đã sửa thủ công nếu có)

import { verifySession } from "../../_middleware.js";

const SESSION_COOKIE = "doscom_session";
const SHOP_ID = "1942196207";

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

function normalizeStatus(s) {
  if (!s) return "Đang kinh doanh";
  const n = String(s).toLowerCase();
  if (n.includes("ngừng") || n.includes("ngung")) return "Ngừng kinh doanh";
  if (n.includes("test")) return "Hàng test";
  return "Đang kinh doanh";
}

async function fetchAllProducts(token) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://pos.pancake.vn/api/v1/shops/${SHOP_ID}/products?access_token=${encodeURIComponent(token)}&page=${page}&page_size=100`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`POS API error page ${page}: HTTP ${resp.status}`);
    }
    const j = await resp.json();
    const data = j.data || [];
    if (!data.length) break;
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

async function loadMisaCosts(origin, cookieHeader) {
  try {
    const url = new URL("/data/product-costs.json", origin).toString();
    const resp = await fetch(url, { headers: { Cookie: cookieHeader || "" } });
    if (!resp.ok) return {};
    const j = await resp.json();
    return j.products || {};
  } catch (e) {
    return {};
  }
}

// Tìm giá vốn từ Misa cho 1 SKU name (lookup theo prefix mã)
function findMisaCost(name, misaProducts) {
  if (!name) return 0;
  const n = name.toLowerCase().trim();
  // Direct match
  if (misaProducts[n] && misaProducts[n].gia_nhap_vnd) return Number(misaProducts[n].gia_nhap_vnd) || 0;
  // Pattern match
  const patterns = [
    /\bda\s*8\.1\s*pro\b/, /\bda\s*8\.1\b/,
    /\bda\d+(?:\.\d+)?(?:\s*pro)?\b/,
    /\bdr\d+(?:\s*plus|\s*pro)?\b/,
    /\bdv\d+(?:\s*pro|\s*mini|\.\d+)?\b/,
    /\bdt\d+\b/,
    /\bdi\d+(?:\s*pro|\s*plus)?\b/,
    /\bd\d+(?:\.\d+)?(?:\s*pro)?\b/,
    /\bnoma\s*\d+/,
  ];
  for (const p of patterns) {
    const m = n.match(p);
    if (m) {
      const k = m[0].replace(/\s+/g, " ").trim();
      if (misaProducts[k] && misaProducts[k].gia_nhap_vnd) return Number(misaProducts[k].gia_nhap_vnd) || 0;
      const k2 = m[0].replace(/\s+/g, "");
      if (misaProducts[k2] && misaProducts[k2].gia_nhap_vnd) return Number(misaProducts[k2].gia_nhap_vnd) || 0;
    }
  }
  // Substring match
  let bestKey = null, bestLen = 0;
  for (const k in misaProducts) {
    if (k.length > 2 && n.includes(k) && misaProducts[k].gia_nhap_vnd) {
      if (k.length > bestLen) { bestKey = k; bestLen = k.length; }
    }
  }
  if (bestKey) return Number(misaProducts[bestKey].gia_nhap_vnd) || 0;
  return 0;
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
  if (!session) return jsonResponse({ error: "Chưa đăng nhập" }, 401);
  const email = (session.email || "").toLowerCase();

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Body phải là JSON" }, 400);
  }

  const accessToken = body.access_token || "";
  if (!accessToken) {
    return jsonResponse({
      error: "Thiếu access_token POS. Mở pos.pancake.vn → DevTools Console → gõ: JSON.parse(localStorage.user).accessToken → copy chuỗi đó dán vào đây.",
    }, 400);
  }

  try {
    // 1. Fetch all products from POS
    const products = await fetchAllProducts(accessToken);

    // 2. Load Misa cost for enrichment
    const misa = await loadMisaCosts(url.origin, request.headers.get("Cookie"));

    // 3. Build inventory items (1 row per variation)
    let added = 0, updated = 0, skipped = 0, kept_user_edit = 0;
    const errors = [];
    const writeKeepUserEdit = body.keep_user_edits !== false;  // default true

    for (const prod of products) {
      if (prod.removed) { skipped++; continue; }

      const variations = prod.variations || [];
      for (const v of variations) {
        if (v.is_removed) { skipped++; continue; }

        // Build name
        let name = prod.name || "";
        if (v.fields && v.fields.length) {
          const extras = v.fields.map(f => f.value || f.name).filter(Boolean).join(" / ");
          if (extras) name = name + " (" + extras + ")";
        }
        if (!name) { skipped++; continue; }

        const code = String(name).toLowerCase().trim();
        if (!code) { skipped++; continue; }

        const giaBan = Number(v.retail_price) || 0;
        const tonKho = Number(v.remain_quantity) || Number(v.total_quantity) || 0;
        const giaVonMisa = findMisaCost(code, misa);
        const trangThai = (prod.is_hide || v.is_hide) ? "Ngừng kinh doanh" : "Đang kinh doanh";

        // Check existing in KV
        const existing = await env.INVENTORY.get(code, { type: "json" });

        let finalCost = giaVonMisa;
        let finalPrice = giaBan;
        let finalTon = tonKho;
        let finalStatus = trangThai;
        let finalName = name;

        // Logic giữ user edit:
        // - Nếu user đã sửa (updated_by không phải "import:misa" hoặc "sync:pos") → giữ giá vốn user sửa
        if (writeKeepUserEdit && existing && existing.updated_by &&
            !existing.updated_by.startsWith("import:") &&
            !existing.updated_by.startsWith("sync:")) {
          // Giữ giá vốn user nhập (POS API không có cogs)
          if (existing.gia_nhap_vnd) finalCost = existing.gia_nhap_vnd;
          // Giữ giá bán user sửa nếu khác POS (user có quyền cao hơn)
          if (existing.gia_ban_vnd && existing.gia_ban_vnd !== giaBan) {
            finalPrice = existing.gia_ban_vnd;
          }
          kept_user_edit++;
        }

        const newValue = {
          ten_day_du: finalName,
          gia_nhap_vnd: finalCost,
          gia_ban_vnd: finalPrice,
          ton_kho: finalTon,
          trang_thai: finalStatus,
          updated_at: new Date().toISOString(),
          updated_by: existing && existing.updated_by &&
                       !existing.updated_by.startsWith("import:") &&
                       !existing.updated_by.startsWith("sync:")
                         ? existing.updated_by + " · sync:pos by " + email
                         : "sync:pos by " + email,
        };

        await env.INVENTORY.put(code, JSON.stringify(newValue));
        if (existing) updated++; else added++;
      }
    }

    return jsonResponse({
      ok: true,
      total_products_fetched: products.length,
      added,
      updated,
      skipped,
      kept_user_edits: kept_user_edit,
      misa_costs_loaded: Object.keys(misa).length,
    });

  } catch (e) {
    return jsonResponse({ error: "Lỗi sync: " + e.message }, 500);
  }
}

// API Sync POS — proxy fetch POS Pancake → ghi vào Inventory KV
// Endpoint: POST /api/inventory/sync-pos
// Body: { access_token: "POS access token from localStorage" }
//
// Logic:
// 1. Server-side fetch toàn bộ products + variations từ POS Pancake API
// 2. Lấy từ POS: tên SP, giá bán (retail_price), tồn kho (remain_quantity),
//    giá vốn (cogs / purchasing_price), trạng thái (is_hide)
// 3. KHÔNG dùng Misa. Nếu POS không có giá vốn → để 0, user tự nhập sau
// 4. Giữ giá vốn / giá bán user đã sửa thủ công (updated_by không phải sync:/import:)

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

// Fetch tất cả products: loop tới khi POS trả về < page_size hoặc trang rỗng
// QUAN TRỌNG: phải gửi User-Agent browser-like, nếu không POS sẽ trả 0 SP
//             (POS Pancake chặn bot User-Agent của Cloudflare Workers)
const POS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "vi,en;q=0.9",
  "Origin": "https://pos.pancake.vn",
  "Referer": "https://pos.pancake.vn/",
};

async function fetchAllProducts(token) {
  const all = [];
  const PAGE_SIZE = 100;
  let totalExpected = null;
  for (let page = 1; page <= 50; page++) {
    const url = `https://pos.pancake.vn/api/v1/shops/${SHOP_ID}/products?access_token=${encodeURIComponent(token)}&page=${page}&page_size=${PAGE_SIZE}`;
    const resp = await fetch(url, { headers: POS_HEADERS });
    if (!resp.ok) {
      let bodyText = "";
      try { bodyText = await resp.text(); } catch (e) {}
      throw new Error(`POS API HTTP ${resp.status} (page ${page}): ${bodyText.slice(0, 300)}`);
    }
    const j = await resp.json();
    const data = j.data || j.products || [];
    if (page === 1) totalExpected = j.total_entries || j.total || null;
    if (!data.length) {
      if (page === 1) {
        throw new Error(`POS trả về 0 SP ở page 1. success=${j.success}, error=${j.error || j.message || "(none)"}, raw=${JSON.stringify(j).slice(0, 300)}`);
      }
      break;
    }
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    if (totalExpected && all.length >= totalExpected) break;
  }
  return all;
}

// Tìm giá vốn từ chính variation của POS (POS có thể trả cogs hoặc purchasing_price)
function getPosCogs(v) {
  const candidates = [v.cogs, v.purchasing_price, v.purchase_price, v.import_price];
  for (const c of candidates) {
    const n = Number(c);
    if (n && n > 0) return n;
  }
  return 0;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Chỉ POST" }, 405);
  }

  if (!env.INVENTORY) {
    return jsonResponse({ error: "KV binding INVENTORY chưa cấu hình" }, 500);
  }

  // Auth check — yêu cầu đã login dashboard
  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Chưa đăng nhập dashboard" }, 401);
  const email = (session.email || "").toLowerCase();

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Body phải là JSON" }, 400);
  }

  const accessToken = (body.access_token || "").trim();
  if (!accessToken) {
    return jsonResponse({
      error:
        "Thiếu access_token POS. Cách lấy: mở https://pos.pancake.vn (đăng nhập) → F12 → Console → gõ: " +
        "JSON.parse(localStorage.user).accessToken — copy chuỗi token (không lấy dấu ngoặc kép) dán vào đây.",
    }, 400);
  }

  const writeKeepUserEdit = body.keep_user_edits !== false;  // default true

  let products;
  try {
    products = await fetchAllProducts(accessToken);
  } catch (e) {
    return jsonResponse({
      error: "Lỗi gọi POS API: " + e.message +
             "\n\nKiểm tra lại token (token POS hết hạn nhanh — lấy lại bằng F12 trên pos.pancake.vn).",
    }, 502);
  }

  if (!products.length) {
    return jsonResponse({
      error: "POS trả về 0 sản phẩm. Token có thể sai shop hoặc hết hạn. Vào pos.pancake.vn xem có thấy SP không trước.",
    }, 400);
  }

  let added = 0, updated = 0, skipped = 0, kept_user_edit = 0;
  const errors = [];

  for (const prod of products) {
    if (prod.removed) { skipped++; continue; }

    const variations = prod.variations || [];
    if (!variations.length) { skipped++; continue; }

    for (const v of variations) {
      if (v.is_removed) { skipped++; continue; }

      // Build tên đầy đủ: prod.name + variation fields nếu có (ví dụ "DT2 / Đỏ")
      let name = prod.name || "";
      if (v.fields && v.fields.length) {
        const extras = v.fields.map(f => f.value || f.name).filter(Boolean).join(" / ");
        if (extras) name = name + " (" + extras + ")";
      }
      if (!name) { skipped++; continue; }

      const code = String(name).toLowerCase().trim();
      if (!code) { skipped++; continue; }

      const giaBan = Number(v.retail_price) || 0;
      const giaVon = getPosCogs(v);
      // Tồn kho: ưu tiên remain_quantity, rồi đến total_quantity
      let tonKho = Number(v.remain_quantity);
      if (!Number.isFinite(tonKho)) tonKho = Number(v.total_quantity) || 0;
      const trangThai = (prod.is_hide || v.is_hide) ? "Ngừng kinh doanh" : "Đang kinh doanh";

      // Check existing in KV để giữ user edit
      let existing = null;
      try {
        existing = await env.INVENTORY.get(code, { type: "json" });
      } catch (e) {
        errors.push(`Read KV failed for ${code}: ${e.message}`);
      }

      let finalCost = giaVon;
      let finalPrice = giaBan;
      let finalTon = tonKho;
      let finalStatus = trangThai;
      let finalName = name;

      // Logic giữ user edit — nếu user đã sửa giá thủ công (không phải import:/sync:) → giữ giá đó
      const userEdited = writeKeepUserEdit && existing && existing.updated_by &&
                         !existing.updated_by.startsWith("import:") &&
                         !existing.updated_by.startsWith("sync:");
      if (userEdited) {
        if (existing.gia_nhap_vnd) finalCost = existing.gia_nhap_vnd;
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
        updated_by: userEdited
          ? existing.updated_by + " · sync:pos by " + email
          : "sync:pos by " + email,
      };

      try {
        await env.INVENTORY.put(code, JSON.stringify(newValue));
        if (existing) updated++; else added++;
      } catch (e) {
        errors.push(`Write KV failed for ${code}: ${e.message}`);
      }
    }
  }

  return jsonResponse({
    ok: true,
    total_products_fetched: products.length,
    added,
    updated,
    skipped,
    kept_user_edits: kept_user_edit,
    errors: errors.slice(0, 10),
    error_count: errors.length,
  });
}

// API Inventory — đọc/ghi danh sách SP từ Cloudflare KV
// Endpoints:
//   GET  /api/inventory          → trả danh sách tất cả SP (mọi user login đều xem được)
//   POST /api/inventory          → cập nhật giá/tồn (mọi user login đều sửa được — 2026-04-25)
//   POST /api/inventory/import   → import từ product-costs.json, chỉ thêm SP MỚI
//
// KV binding: env.INVENTORY (đã bind DOSCOM_INVENTORY)
// Auth: dùng verifySession từ ../_middleware.js (yêu cầu đã login)

import { verifySession } from "../_middleware.js";

// 2026-04-25: Bỏ giới hạn admin theo yêu cầu của Duy.
// Tất cả user đã login (qua Google OAuth + ALLOWED_EMAILS) đều có quyền sửa.
// Vẫn ghi updated_by = email user thực để truy vết lịch sử thay đổi.
const ADMIN_EMAIL = "all-logged-in-users";

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

async function getUserEmail(request, env) {
  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  return session ? (session.email || "").toLowerCase() : null;
}

function isAdmin(email) {
  // 2026-04-25: Mọi user đã login đều được sửa
  return !!email;
}

// Parse a "Đang kinh doanh" / "Ngừng kinh doanh" từ Misa data sang chuẩn
function normalizeStatus(s) {
  if (!s) return "Đang kinh doanh";
  const n = String(s).toLowerCase().trim();
  if (n.includes("ngừng") || n.includes("ngung") || n.includes("dừng") || n.includes("stop")) return "Ngừng kinh doanh";
  if (n.includes("test") || n.includes("thử")) return "Hàng test";
  return "Đang kinh doanh";
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (!env.INVENTORY) {
    return jsonResponse({ error: "KV binding INVENTORY chưa được cấu hình" }, 500);
  }

  // ── GET — list all items ──
  if (method === "GET") {
    try {
      const list = await env.INVENTORY.list({ limit: 1000 });
      const items = [];
      for (const k of list.keys) {
        try {
          const value = await env.INVENTORY.get(k.name, { type: "json" });
          if (value) items.push({ code: k.name, ...value });
        } catch (e) {
          // skip broken entries
        }
      }
      // Sort theo trạng thái (Đang KD trước) → gia_ban giảm
      items.sort((a, b) => {
        const aActive = (a.trang_thai || "").startsWith("Đang") ? 0 : 1;
        const bActive = (b.trang_thai || "").startsWith("Đang") ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (b.gia_ban_vnd || 0) - (a.gia_ban_vnd || 0);
      });
      return jsonResponse({
        count: items.length,
        items,
        admin_email: ADMIN_EMAIL,
        edit_open: true,  // 2026-04-25: mọi user login đều edit được
      });
    } catch (e) {
      return jsonResponse({ error: "Lỗi khi đọc KV: " + e.message }, 500);
    }
  }

  // ── POST — mọi user đã login đều được sửa (2026-04-25) ──
  if (method === "POST") {
    const email = await getUserEmail(request, env);
    if (!email) return jsonResponse({ error: "Chưa đăng nhập" }, 401);
    // Tất cả user đã đăng nhập qua whitelist ALLOWED_EMAILS đều có quyền sửa

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: "Body phải là JSON hợp lệ" }, 400);
    }

    // POST /api/inventory/import — import từ product-costs.json
    if (url.pathname.endsWith("/import")) {
      try {
        const pcUrl = new URL("/data/product-costs.json", url.origin).toString();
        const pcResp = await fetch(pcUrl, {
          headers: { "Cookie": request.headers.get("Cookie") || "" },
        });
        if (!pcResp.ok) {
          return jsonResponse({ error: `Không tải được product-costs.json (HTTP ${pcResp.status})` }, 502);
        }
        const pc = await pcResp.json();
        const products = pc.products || {};
        let added = 0, kept = 0, skipped = 0;
        for (const [code, v] of Object.entries(products)) {
          if (!code) { skipped++; continue; }
          const existing = await env.INVENTORY.get(code);
          if (existing) {
            kept++;
            continue;
          }
          await env.INVENTORY.put(code, JSON.stringify({
            ten_day_du: v.dinh_danh || v.ten || code,
            gia_nhap_vnd: Number(v.gia_nhap_vnd) || 0,
            gia_ban_vnd: Number(v.gia_ban_vnd) || 0,
            ton_kho: parseInt(v.ton_kho || 0, 10) || 0,
            trang_thai: normalizeStatus(v.trang_thai),
            updated_at: new Date().toISOString(),
            updated_by: "import:misa",
          }));
          added++;
        }
        return jsonResponse({
          ok: true,
          added,
          kept,
          skipped,
          total_in_misa: Object.keys(products).length,
        });
      } catch (e) {
        return jsonResponse({ error: "Lỗi khi import: " + e.message }, 500);
      }
    }

    // POST /api/inventory — update items
    // Body: { items: [{code, gia_nhap_vnd, gia_ban_vnd, ton_kho, trang_thai, ten_day_du}] }
    if (Array.isArray(body.items)) {
      try {
        let updated = 0, errors = [];
        for (const item of body.items) {
          if (!item.code) { errors.push("Thiếu code"); continue; }
          const code = String(item.code).trim();
          const existing = await env.INVENTORY.get(code, { type: "json" }) || {};
          const newValue = {
            ten_day_du: item.ten_day_du !== undefined ? String(item.ten_day_du) : (existing.ten_day_du || code),
            gia_nhap_vnd: item.gia_nhap_vnd !== undefined ? Number(item.gia_nhap_vnd) || 0 : (existing.gia_nhap_vnd || 0),
            gia_ban_vnd:  item.gia_ban_vnd  !== undefined ? Number(item.gia_ban_vnd)  || 0 : (existing.gia_ban_vnd  || 0),
            ton_kho:      item.ton_kho      !== undefined ? parseInt(item.ton_kho, 10) || 0 : (existing.ton_kho || 0),
            trang_thai:   item.trang_thai   !== undefined ? normalizeStatus(item.trang_thai) : (existing.trang_thai || "Đang kinh doanh"),
            updated_at: new Date().toISOString(),
            updated_by: email,
          };
          await env.INVENTORY.put(code, JSON.stringify(newValue));
          updated++;
        }
        return jsonResponse({ ok: true, updated, errors });
      } catch (e) {
        return jsonResponse({ error: "Lỗi khi cập nhật: " + e.message }, 500);
      }
    }

    // POST /api/inventory với body.add — thêm SP mới thủ công
    if (body.add && body.code) {
      try {
        const code = String(body.code).trim();
        if (!code) return jsonResponse({ error: "Mã rỗng" }, 400);
        const existing = await env.INVENTORY.get(code);
        if (existing) return jsonResponse({ error: `SP ${code} đã tồn tại` }, 409);
        await env.INVENTORY.put(code, JSON.stringify({
          ten_day_du: body.ten_day_du || code,
          gia_nhap_vnd: Number(body.gia_nhap_vnd) || 0,
          gia_ban_vnd: Number(body.gia_ban_vnd) || 0,
          ton_kho: parseInt(body.ton_kho || 0, 10) || 0,
          trang_thai: normalizeStatus(body.trang_thai),
          updated_at: new Date().toISOString(),
          updated_by: email,
        }));
        return jsonResponse({ ok: true, added: code });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // POST /api/inventory với body.delete — xoá SP
    if (body.delete && body.code) {
      try {
        const code = String(body.code).trim();
        await env.INVENTORY.delete(code);
        return jsonResponse({ ok: true, deleted: code });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    return jsonResponse({ error: "Body không hợp lệ. Cần items[] hoặc add/delete." }, 400);
  }

  return jsonResponse({ error: "Method không hỗ trợ" }, 405);
}

// POST /api/admin/migrate — Import dữ liệu cũ vào D1
// Chỉ CEO/COO chạy được (level >= 50)
// Body: { dry_run?: boolean, scope?: "products" | "all" }
//
// Idempotent: chạy nhiều lần OK, dùng INSERT OR REPLACE.

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail, requireLevel } from "../../lib/rbac.js";
import { run, queryFirst, newId, nowVN, logAudit, healthCheck } from "../../lib/db.js";

const SESSION_COOKIE = "doscom_session";

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Classifier mirror functions/lib/fbAdsHelpers + agent-google-ai
function classifyGroup(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return "OTHER";
  if (/noma|a002|tẩy|chà kính|kính xe|chăm sóc xe/i.test(n)) return "NOMA";
  if (/^da\s*8\.1|da8\.1|gọi.*2.*chiều|video.*call/i.test(n)) return "CAMERA_VIDEO_CALL";
  if (/^dr\s*\d|máy\s*ghi\s*âm|ghi âm/i.test(n)) return "GHI_AM";
  if (/chống ghi âm|chống nghe lén/i.test(n) || /^di\s*\d/.test(n)) return "CHONG_GHI_AM";
  if (/^dt\s*\d|tag/i.test(n)) return "DINH_VI";
  if (/^dv\s*\d|định vị|tracker|gps/i.test(n)) return "DINH_VI";
  if (/4g|nlmt|năng lượng mặt trời|sim/i.test(n)) return "CAMERA_4G";
  if (/^da\s*[12-9]/.test(n)) return "CAMERA_WIFI";
  if (/^d\s*\d|máy dò|may do/i.test(n)) return "MAY_DO";
  return "OTHER";
}

async function fetchJson(origin, path, cookieHeader) {
  try {
    const r = await fetch(new URL(path, origin).toString(), { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── PRODUCTS migration ──
async function migrateProducts(env, costsJson, dryRun) {
  const out = { count: 0, skipped: 0, errors: [] };
  if (!costsJson?.products) return out;
  for (const [key, p] of Object.entries(costsJson.products)) {
    if (!p.dinh_danh || !p.gia_nhap_vnd) { out.skipped++; continue; }
    const productId = key.toLowerCase().replace(/\s+/g, "_");
    const groupCode = classifyGroup(p.dinh_danh);
    if (dryRun) { out.count++; continue; }
    try {
      await run(env, `
        INSERT OR REPLACE INTO products
        (id, sku, name, group_code, cost_vnd, sell_vnd, current_stock, unit, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        productId,
        p.sku || key,
        p.dinh_danh,
        groupCode,
        Math.round(p.gia_nhap_vnd),
        p.gia_ban_vnd ? Math.round(p.gia_ban_vnd) : null,
        parseInt(p.ton_kho) || 0,
        p.don_vi || "Cái",
        p.trang_thai === "Ngừng kinh doanh" ? "discontinued" : "active",
        nowVN(),
      );
      out.count++;
    } catch (e) {
      out.errors.push(`${productId}: ${e.message}`);
    }
  }
  return out;
}

// ── ORDERS migration (từ Pancake source_groups DUY + PHUONG_NAM) ──
async function migrateOrdersFromPancake(env, revenueJson, dryRun) {
  const out = { customers: 0, orders: 0, skipped: 0, errors: [] };
  if (!revenueJson?.source_groups) return out;

  const SOURCES = ["DUY", "PHUONG_NAM"];
  for (const sg of SOURCES) {
    const node = revenueJson.source_groups[sg];
    if (!node?.products) continue;

    // Iterate qua từng product, từng date
    for (const [productName, p] of Object.entries(node.products)) {
      const groupCode = classifyGroup(productName);
      const ordersByDate = p.orders_by_date || {};
      const revByDate = p.by_date || {};
      const productId = productName.toLowerCase().replace(/\s+/g, "_");

      for (const [date, orderCount] of Object.entries(ordersByDate)) {
        const numOrders = Number(orderCount) || 0;
        const dailyRev = Number(revByDate[date]) || 0;
        if (numOrders === 0) continue;

        // Lưu ý: Pancake aggregate per-day, không có order_id riêng cho mỗi đơn
        // → tạo placeholder order với pancake_order_id format: DATE_PRODUCT_SOURCE_n
        // Cần pull Pancake API để có order_id thật (làm sau, phase later)
        const aov = numOrders > 0 ? dailyRev / numOrders : 0;

        for (let i = 1; i <= numOrders; i++) {
          const orderId = `pcsync_${sg}_${date}_${productId}_${i}`;
          if (dryRun) { out.orders++; continue; }
          try {
            await run(env, `
              INSERT OR IGNORE INTO orders
              (id, pancake_order_id, total_vnd, items_json, source_group, channel, status, created_at, imported_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              orderId,
              orderId,
              Math.round(aov),
              JSON.stringify([{ product_id: productId, name: productName, qty: 1, unit_price: Math.round(aov) }]),
              sg,
              "FB", // tạm assume FB cho DUY+PHUONG_NAM
              "delivered",
              date,
              nowVN(),
            );
            out.orders++;
          } catch (e) {
            out.errors.push(`order ${orderId}: ${e.message}`);
          }
        }
      }
    }
  }
  return out;
}

// ── DAILY SNAPSHOTS ──
async function buildDailySnapshots(env, revenueJson, dryRun) {
  const out = { count: 0, errors: [] };
  if (!revenueJson?.total_orders_by_date) return out;
  const dates = Object.keys(revenueJson.total_orders_by_date || {}).slice(-90);
  const revByDate = revenueJson.order_revenue_by_status_by_date?.delivered || {};
  for (const date of dates) {
    const orders = Number(revenueJson.total_orders_by_date[date]) || 0;
    const revenue = Number(revByDate[date]) || 0;
    if (dryRun) { out.count++; continue; }
    try {
      await run(env, `
        INSERT OR REPLACE INTO daily_snapshots (date, total_orders, total_revenue_vnd, generated_at)
        VALUES (?, ?, ?, ?)
      `, date, orders, Math.round(revenue), nowVN());
      out.count++;
    } catch (e) {
      out.errors.push(`${date}: ${e.message}`);
    }
  }
  return out;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);

  const employee = await getEmployeeFromEmail(env, session.email);
  if (!employee) return jsonResponse({ error: "Email chưa đăng ký trong ERP" }, 403);
  if (!requireLevel(employee, 50)) {
    return jsonResponse({ error: "Chỉ CEO/COO mới chạy được migrate" }, 403);
  }

  // DB ready check
  const health = await healthCheck(env);
  if (!health.ok) return jsonResponse({ error: "DB chưa ready: " + health.error }, 500);

  // Body
  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const dryRun = !!body.dry_run;
  const scope = body.scope || "all";

  const origin = new URL(request.url).origin;
  const cookieHeader = request.headers.get("Cookie") || "";

  const result = { dry_run: dryRun, scope, started_at: nowVN(), steps: {} };

  // 1. Products
  if (scope === "all" || scope === "products") {
    const costsJson = await fetchJson(origin, "/data/product-costs.json", cookieHeader);
    if (!costsJson) {
      result.steps.products = { error: "Không fetch được product-costs.json" };
    } else {
      result.steps.products = await migrateProducts(env, costsJson, dryRun);
    }
  }

  // 2. Orders + customers (placeholder)
  if (scope === "all" || scope === "orders") {
    const revJson = await fetchJson(origin, "/data/product-revenue.json", cookieHeader);
    if (!revJson) {
      result.steps.orders = { error: "Không fetch được product-revenue.json" };
    } else {
      result.steps.orders = await migrateOrdersFromPancake(env, revJson, dryRun);
    }
  }

  // 3. Daily snapshots
  if (scope === "all" || scope === "snapshots") {
    const revJson = await fetchJson(origin, "/data/product-revenue.json", cookieHeader);
    if (!revJson) {
      result.steps.snapshots = { error: "Không fetch được product-revenue.json" };
    } else {
      result.steps.snapshots = await buildDailySnapshots(env, revJson, dryRun);
    }
  }

  result.finished_at = nowVN();

  // Audit log
  if (!dryRun) {
    await logAudit(env, employee, "migrate_data", { type: "system", id: "all" }, result);
  }

  return jsonResponse(result);
}

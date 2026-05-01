// Warehouse — Products API
// GET  /api/warehouse/products?group=&status=&search=&limit=
// POST /api/warehouse/products  (Leader+ only)
//
// RBAC:
// - Tất cả nhân viên có thể GET (read products list)
// - POST/PUT/DELETE: chỉ Leader+ phòng Kho hoặc TP+

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail, requireLevel, canAccess } from "../../lib/rbac.js";
import { query, queryFirst, run, newId, nowVN, logAudit } from "../../lib/db.js";

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

async function getCurrentEmployee(context) {
  const sessionCookie = getCookie(context.request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, context.env.SESSION_SECRET);
  if (!session) return null;
  return await getEmployeeFromEmail(context.env, session.email);
}

// ─── GET: List products with filters ───
export async function onRequestGet(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const group = url.searchParams.get("group");
  const status = url.searchParams.get("status") || "active";
  const search = url.searchParams.get("search");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
  const lowStockOnly = url.searchParams.get("low_stock") === "1";

  const conditions = [];
  const params = [];

  if (status && status !== "all") {
    conditions.push("status = ?");
    params.push(status);
  }
  if (group && group !== "ALL") {
    conditions.push("group_code = ?");
    params.push(group);
  }
  if (search) {
    conditions.push("(name LIKE ? OR sku LIKE ? OR id LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (lowStockOnly) {
    conditions.push("current_stock <= reorder_threshold");
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const sql = `
    SELECT id, sku, name, group_code, cost_vnd, sell_vnd,
           current_stock, reorder_threshold, unit, status,
           supplier_id, notes, updated_at
    FROM products
    ${where}
    ORDER BY current_stock ASC, name ASC
    LIMIT ?
  `;
  params.push(limit);

  try {
    const rows = await query(env, sql, ...params);
    // Aggregate stats
    const totalRows = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active'`);
    const lowStockCount = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active' AND current_stock <= reorder_threshold`);
    const outOfStockCount = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active' AND current_stock = 0`);
    const totalValueRow = await queryFirst(env, `SELECT SUM(current_stock * cost_vnd) AS v FROM products WHERE status = 'active'`);

    return jsonResponse({
      ok: true,
      products: rows,
      stats: {
        total_active: totalRows?.n || 0,
        low_stock_count: lowStockCount?.n || 0,
        out_of_stock_count: outOfStockCount?.n || 0,
        total_inventory_value_vnd: totalValueRow?.v || 0,
      },
      filters: { group, status, search, low_stock_only: lowStockOnly },
    });
  } catch (e) {
    return jsonResponse({ error: "DB error: " + e.message }, 500);
  }
}

// ─── POST: Create new product (Leader+ only) ───
export async function onRequestPost(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  // Check permission: Leader+ phòng Kho HOẶC TP+/COO/CEO
  const isWarehouseLeader = employee.department_id === "WAREHOUSE" && employee.role_level >= 30;
  const isHighLevel = employee.role_level >= 40;
  if (!isWarehouseLeader && !isHighLevel) {
    return jsonResponse({ error: "Chỉ Leader Kho hoặc TP+ mới tạo SP mới" }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  const { id, sku, name, group_code, cost_vnd, sell_vnd, current_stock, reorder_threshold, unit, supplier_id, notes } = body;
  if (!name) return jsonResponse({ error: "name là bắt buộc" }, 400);

  const productId = id || newId("prod");
  try {
    await run(env, `
      INSERT INTO products (id, sku, name, group_code, cost_vnd, sell_vnd, current_stock, reorder_threshold, unit, supplier_id, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `,
      productId,
      sku || null,
      name,
      group_code || null,
      cost_vnd || null,
      sell_vnd || null,
      current_stock || 0,
      reorder_threshold || 10,
      unit || "Cái",
      supplier_id || null,
      notes || null,
      nowVN(), nowVN(),
    );
    await logAudit(env, employee, "create_product", { type: "product", id: productId }, { name, group_code });
    return jsonResponse({ ok: true, id: productId, name }, 201);
  } catch (e) {
    return jsonResponse({ error: "Insert fail: " + e.message }, 500);
  }
}

// Warehouse — Single Product API (alternative without dynamic route folder)
// GET  /api/warehouse/product-detail?id=PRODUCT_ID  → product info + recent movements
// PUT  /api/warehouse/product-detail?id=PRODUCT_ID  → update fields (Leader+ only)
//
// Sử dụng query string thay vì dynamic route folder để đơn giản hóa.

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail } from "../../lib/rbac.js";
import { query, queryFirst, run, nowVN, logAudit } from "../../lib/db.js";

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

function getProductId(request) {
  const url = new URL(request.url);
  return url.searchParams.get("id");
}

// ─── GET: Product detail + recent movements ───
export async function onRequestGet(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  const id = getProductId(request);
  if (!id) return jsonResponse({ error: "Missing ?id=" }, 400);

  try {
    const product = await queryFirst(env, "SELECT * FROM products WHERE id = ?", id);
    if (!product) return jsonResponse({ error: "Product not found" }, 404);

    // Last 30 movements
    const movements = await query(env, `
      SELECT m.*, e.name AS by_name
      FROM inventory_movements m
      LEFT JOIN employees e ON m.by_employee_id = e.id
      WHERE m.product_id = ?
      ORDER BY m.created_at DESC
      LIMIT 30
    `, id);

    // Sales last 90 days from orders
    const salesSql = `
      SELECT date(created_at) AS day, COUNT(*) AS orders, SUM(total_vnd) AS revenue
      FROM orders
      WHERE items_json LIKE ?
        AND created_at >= date('now', '-90 days')
      GROUP BY date(created_at)
      ORDER BY day DESC
    `;
    const sales = await query(env, salesSql, `%${id}%`);

    return jsonResponse({ ok: true, product, movements, sales_last_90d: sales });
  } catch (e) {
    return jsonResponse({ error: "DB error: " + e.message }, 500);
  }
}

// ─── PUT: Update product fields ───
export async function onRequestPut(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  const isWarehouseStaff = employee.department_id === "WAREHOUSE";
  const isHighLevel = employee.role_level >= 40;
  if (!isWarehouseStaff && !isHighLevel) {
    return jsonResponse({ error: "Chỉ phòng Kho hoặc TP+ mới sửa SP" }, 403);
  }

  const id = getProductId(request);
  if (!id) return jsonResponse({ error: "Missing ?id=" }, 400);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  const allowedFields = ["sku", "name", "group_code", "cost_vnd", "sell_vnd", "reorder_threshold", "unit", "status", "supplier_id", "notes"];
  const updates = [];
  const params = [];
  for (const f of allowedFields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(body[f]);
    }
  }
  if (updates.length === 0) return jsonResponse({ error: "Không có field nào để update" }, 400);
  updates.push("updated_at = ?");
  params.push(nowVN());
  params.push(id);

  try {
    const meta = await run(env, `UPDATE products SET ${updates.join(", ")} WHERE id = ?`, ...params);
    await logAudit(env, employee, "update_product", { type: "product", id }, body);
    return jsonResponse({ ok: true, id, changed_fields: updates.length - 1, rows_affected: meta?.changes });
  } catch (e) {
    return jsonResponse({ error: "Update fail: " + e.message }, 500);
  }
}

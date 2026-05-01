// Warehouse — Inventory Movement API
// GET  /api/warehouse/movement?product_id=&type=&days=  → list movements
// POST /api/warehouse/movement  → log mới (IN/OUT/ADJUSTMENT/TRANSFER)
//
// Mọi POST tự động update products.current_stock + sinh stock_alert nếu vượt threshold.
// RBAC: Phòng Kho hoặc TP+ mới được POST.

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail } from "../../lib/rbac.js";
import { query, queryFirst, run, batch, newId, nowVN, todayVN, logAudit } from "../../lib/db.js";

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

const VALID_TYPES = ["IN", "OUT", "ADJUSTMENT", "TRANSFER", "RETURN"];

// ─── GET: List movements ───
export async function onRequestGet(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id");
  const type = url.searchParams.get("type");
  const days = Math.min(parseInt(url.searchParams.get("days") || "30", 10), 365);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

  const conditions = [];
  const params = [];
  if (productId) { conditions.push("m.product_id = ?"); params.push(productId); }
  if (type && VALID_TYPES.includes(type)) { conditions.push("m.type = ?"); params.push(type); }
  if (days) { conditions.push(`m.created_at >= date('now', '-${days} days')`); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  try {
    const rows = await query(env, `
      SELECT m.*, p.name AS product_name, p.sku, e.name AS by_name
      FROM inventory_movements m
      LEFT JOIN products p ON m.product_id = p.id
      LEFT JOIN employees e ON m.by_employee_id = e.id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT ?
    `, ...params, limit);
    return jsonResponse({ ok: true, count: rows.length, movements: rows });
  } catch (e) {
    return jsonResponse({ error: "DB error: " + e.message }, 500);
  }
}

// ─── POST: Log movement (cập nhật stock + alert) ───
export async function onRequestPost(context) {
  const { request, env } = context;
  const employee = await getCurrentEmployee(context);
  if (!employee) return jsonResponse({ error: "Unauthorized" }, 401);

  // RBAC: Phòng Kho or TP+
  const isWarehouseStaff = employee.department_id === "WAREHOUSE";
  const isHighLevel = employee.role_level >= 40;
  if (!isWarehouseStaff && !isHighLevel) {
    return jsonResponse({ error: "Chỉ phòng Kho hoặc TP+ mới log nhập/xuất" }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  const { product_id, qty, type, reference_type, reference_id, warehouse_id, notes } = body;
  if (!product_id) return jsonResponse({ error: "product_id bắt buộc" }, 400);
  if (qty === undefined || qty === 0) return jsonResponse({ error: "qty bắt buộc và khác 0" }, 400);
  if (!type || !VALID_TYPES.includes(type)) {
    return jsonResponse({ error: `type phải là 1 trong: ${VALID_TYPES.join(", ")}` }, 400);
  }

  // Validate qty sign theo type
  let signedQty = parseInt(qty, 10);
  if (type === "IN" || type === "RETURN") signedQty = Math.abs(signedQty);
  else if (type === "OUT" || type === "TRANSFER") signedQty = -Math.abs(signedQty);
  // ADJUSTMENT: giữ nguyên dấu

  // Get current product
  const product = await queryFirst(env, "SELECT * FROM products WHERE id = ?", product_id);
  if (!product) return jsonResponse({ error: "Product not found" }, 404);

  const newStock = (product.current_stock || 0) + signedQty;
  if (newStock < 0) {
    return jsonResponse({ error: `Stock không thể âm. Hiện tại ${product.current_stock}, yêu cầu xuất ${Math.abs(signedQty)}` }, 400);
  }

  const movementId = newId("mvt");
  const ts = nowVN();
  const today = todayVN();

  try {
    // Use batch để atomic update stock + insert movement
    await batch(env, [
      [`INSERT INTO inventory_movements (id, product_id, qty, type, reference_type, reference_id, warehouse_id, by_employee_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        movementId, product_id, signedQty, type, reference_type || "MANUAL", reference_id || null, warehouse_id || "MAIN", employee.id, notes || null, ts],
      [`UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?`,
        newStock, ts, product_id],
    ]);

    // Check stock alert
    let alertCreated = null;
    if (newStock === 0) {
      const alertId = newId("alert");
      await run(env, `
        INSERT INTO stock_alerts (id, product_id, level, current_stock, threshold, triggered_at, notified_departments)
        VALUES (?, ?, 'OUT', ?, ?, ?, ?)
      `, alertId, product_id, newStock, product.reorder_threshold, ts, JSON.stringify(["MARKETING", "SALES"]));
      alertCreated = { id: alertId, level: "OUT" };

      // Publish KV event for marketing dashboards
      if (env.INVENTORY) {
        await env.INVENTORY.put(`stock_alert:${product_id}`,
          JSON.stringify({ product_id, name: product.name, level: "OUT", at: ts }),
          { expirationTtl: 86400 * 7 }); // 7 days
      }
    } else if (newStock <= product.reorder_threshold && product.current_stock > product.reorder_threshold) {
      // Crossed below threshold (was above, now below)
      const alertId = newId("alert");
      await run(env, `
        INSERT INTO stock_alerts (id, product_id, level, current_stock, threshold, triggered_at, notified_departments)
        VALUES (?, ?, 'LOW', ?, ?, ?, ?)
      `, alertId, product_id, newStock, product.reorder_threshold, ts, JSON.stringify(["MARKETING", "SALES"]));
      alertCreated = { id: alertId, level: "LOW" };

      if (env.INVENTORY) {
        await env.INVENTORY.put(`stock_alert:${product_id}`,
          JSON.stringify({ product_id, name: product.name, level: "LOW", at: ts, stock: newStock, threshold: product.reorder_threshold }),
          { expirationTtl: 86400 * 7 });
      }
    } else if (newStock > product.reorder_threshold && product.current_stock <= product.reorder_threshold) {
      // Restocked above threshold → resolve alerts + clear KV
      await run(env, `UPDATE stock_alerts SET resolved_at = ? WHERE product_id = ? AND resolved_at IS NULL`, ts, product_id);
      if (env.INVENTORY) {
        await env.INVENTORY.delete(`stock_alert:${product_id}`);
      }
    }

    await logAudit(env, employee, `inventory_${type.toLowerCase()}`, { type: "product", id: product_id }, { qty: signedQty, prev_stock: product.current_stock, new_stock: newStock });

    return jsonResponse({
      ok: true,
      movement_id: movementId,
      product: { id: product_id, name: product.name },
      stock_change: { previous: product.current_stock, new: newStock, delta: signedQty },
      alert: alertCreated,
    }, 201);
  } catch (e) {
    return jsonResponse({ error: "DB error: " + e.message }, 500);
  }
}

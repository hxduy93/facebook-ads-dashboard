// Warehouse — Dashboard Stats API
// GET /api/warehouse/dashboard
// Trả về số liệu tổng quan để render dashboard kho:
// - Tổng SP active, low stock, out of stock, tổng giá trị tồn kho
// - Top 10 SP cần re-order
// - Top 10 SP bán chạy 30d (từ orders)
// - Recent movements (last 20)
// - Active alerts

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail } from "../../lib/rbac.js";
import { query, queryFirst } from "../../lib/db.js";

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);

  const employee = await getEmployeeFromEmail(env, session.email);
  if (!employee) return jsonResponse({ error: "Email chưa đăng ký" }, 403);

  // Tất cả nhân viên đều có thể xem dashboard kho (read-only)
  try {
    // Stats overview
    const totalActive = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active'`);
    const lowStock = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active' AND current_stock <= reorder_threshold AND current_stock > 0`);
    const outOfStock = await queryFirst(env, `SELECT COUNT(*) AS n FROM products WHERE status = 'active' AND current_stock = 0`);
    const totalValue = await queryFirst(env, `SELECT SUM(current_stock * cost_vnd) AS v FROM products WHERE status = 'active'`);

    // Per-group breakdown
    const byGroup = await query(env, `
      SELECT group_code, COUNT(*) AS sku_count, SUM(current_stock) AS total_qty, SUM(current_stock * cost_vnd) AS total_value
      FROM products
      WHERE status = 'active'
      GROUP BY group_code
      ORDER BY total_value DESC
    `);

    // Top 10 needs reorder (lowest stock vs threshold ratio)
    const reorderList = await query(env, `
      SELECT id, name, sku, group_code, current_stock, reorder_threshold, cost_vnd
      FROM products
      WHERE status = 'active' AND current_stock <= reorder_threshold * 1.5
      ORDER BY (CAST(current_stock AS REAL) / NULLIF(reorder_threshold, 0)) ASC
      LIMIT 10
    `);

    // Top selling 30 days (count orders containing each product_id in items_json)
    // Note: Pancake orders chưa có product_id mapping chi tiết, dùng items_json LIKE
    const topSelling = await query(env, `
      SELECT p.id, p.name, p.group_code, p.current_stock,
             COUNT(o.id) AS order_count
      FROM products p
      LEFT JOIN orders o ON o.items_json LIKE '%' || p.id || '%'
        AND o.created_at >= date('now', '-30 days')
      WHERE p.status = 'active'
      GROUP BY p.id
      HAVING order_count > 0
      ORDER BY order_count DESC
      LIMIT 10
    `);

    // Recent movements (last 20)
    const recentMvts = await query(env, `
      SELECT m.id, m.product_id, m.qty, m.type, m.created_at,
             p.name AS product_name, e.name AS by_name
      FROM inventory_movements m
      LEFT JOIN products p ON m.product_id = p.id
      LEFT JOIN employees e ON m.by_employee_id = e.id
      ORDER BY m.created_at DESC
      LIMIT 20
    `);

    // Active alerts (unresolved)
    const alerts = await query(env, `
      SELECT a.id, a.product_id, a.level, a.current_stock, a.threshold, a.triggered_at,
             p.name AS product_name, p.sku
      FROM stock_alerts a
      LEFT JOIN products p ON a.product_id = p.id
      WHERE a.resolved_at IS NULL
      ORDER BY a.triggered_at DESC
      LIMIT 20
    `);

    return jsonResponse({
      ok: true,
      stats: {
        total_active: totalActive?.n || 0,
        low_stock: lowStock?.n || 0,
        out_of_stock: outOfStock?.n || 0,
        total_inventory_value_vnd: totalValue?.v || 0,
      },
      by_group: byGroup,
      reorder_top10: reorderList,
      top_selling_30d: topSelling,
      recent_movements: recentMvts,
      active_alerts: alerts,
      generated_at: new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " "),
    });
  } catch (e) {
    return jsonResponse({ error: "DB error: " + e.message, hint: "D1 chưa setup hoặc schema chưa run" }, 500);
  }
}

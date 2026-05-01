// GET /api/me — Trả về thông tin user đang đăng nhập
// Frontend dùng để biết role + department + tên hiển thị

import { verifySession } from "../_middleware.js";
import { getEmployeeFromEmail, ROLE_LABELS } from "../lib/rbac.js";
import { healthCheck } from "../lib/db.js";

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
  if (!session) return jsonResponse({ error: "Unauthorized", logged_in: false }, 401);

  const email = session.email;
  const dbHealth = await healthCheck(env);

  if (!dbHealth.ok) {
    // D1 chưa setup hoặc chưa run schema → trả về session info cơ bản
    return jsonResponse({
      logged_in: true,
      email,
      employee: null,
      db_status: dbHealth,
      hint: "D1 database chưa setup. Liên hệ Tech để setup binding + run schema.sql.",
    });
  }

  const employee = await getEmployeeFromEmail(env, email);
  if (!employee) {
    // Có session Google OAuth nhưng chưa add vào D1 employees
    return jsonResponse({
      logged_in: true,
      email,
      employee: null,
      hint: "Email chưa được đăng ký trong ERP. Liên hệ CEO/COO để add nhân viên.",
    });
  }

  return jsonResponse({
    logged_in: true,
    email,
    employee: {
      id: employee.id,
      email: employee.email,
      name: employee.name,
      department_id: employee.department_id,
      team_id: employee.team_id,
      role_level: employee.role_level,
      role_label: employee.role_label || ROLE_LABELS[employee.role_level] || "Unknown",
      active: !!employee.active,
    },
  });
}

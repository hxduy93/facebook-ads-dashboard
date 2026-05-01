// D1 Database wrapper helpers
// Sử dụng env.DB binding (cấu hình ở Cloudflare Pages → Settings → Functions → Bindings)

// Generate UUID-like ID (Cloudflare Workers có crypto.randomUUID)
export function newId(prefix = "") {
  const u = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return prefix ? `${prefix}_${u}` : u;
}

// Vietnamese-localized timestamp
export function nowVN() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export function todayVN() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// Run query, return all rows
export async function query(env, sql, ...params) {
  if (!env.DB) throw new Error("DB binding chưa setup. Setup trong Cloudflare Pages → Settings → Functions → Bindings → D1.");
  const stmt = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  const r = await stmt.all();
  return r.results || [];
}

// Run query, return first row only
export async function queryFirst(env, sql, ...params) {
  if (!env.DB) throw new Error("DB binding chưa setup");
  const stmt = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  return await stmt.first();
}

// Run write (INSERT/UPDATE/DELETE), return meta
export async function run(env, sql, ...params) {
  if (!env.DB) throw new Error("DB binding chưa setup");
  const stmt = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  const r = await stmt.run();
  return r.meta;
}

// Batch multiple statements (transaction)
export async function batch(env, statements) {
  if (!env.DB) throw new Error("DB binding chưa setup");
  return await env.DB.batch(statements.map(s => {
    if (typeof s === "string") return env.DB.prepare(s);
    const [sql, ...params] = s;
    return env.DB.prepare(sql).bind(...params);
  }));
}

// Audit log shortcut
export async function logAudit(env, employee, action, target, metadata = {}) {
  try {
    await run(env, `
      INSERT INTO audit_log (id, employee_id, employee_email, department, action, target_type, target_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      newId("aud"),
      employee?.id || null,
      employee?.email || null,
      employee?.department_id || null,
      action,
      target?.type || null,
      target?.id || null,
      JSON.stringify(metadata),
    );
  } catch (e) {
    console.error("audit log fail:", e.message);
  }
}

// Check D1 binding healthy + tables exist
export async function healthCheck(env) {
  if (!env.DB) return { ok: false, error: "DB binding not configured" };
  try {
    const r = await queryFirst(env, "SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
    if (!r) return { ok: false, error: "Table 'employees' chưa tồn tại. Chạy schema.sql trước." };
    const count = await queryFirst(env, "SELECT COUNT(*) AS n FROM employees");
    return { ok: true, employees_count: count?.n || 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Endpoint: GET/POST /api/geo/queries
//
// GET  /api/geo/queries?brand=doscom&active=1
//   → list queries với filter
//
// POST /api/geo/queries
//   body: { action: "create" | "update" | "delete", id?, text?, category?, brand_target?, language?, active? }
//   - create: cần text + category + brand_target
//   - update: cần id + ít nhất 1 field cần update
//   - delete: cần id → soft delete (set active=0)

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  const url = new URL(request.url);
  const brand = url.searchParams.get("brand");
  const activeParam = url.searchParams.get("active");
  const category = url.searchParams.get("category");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 1000);

  let sql = "SELECT * FROM geo_queries WHERE 1=1";
  const params = [];
  if (brand)    { sql += " AND brand_target = ?"; params.push(brand); }
  if (category) { sql += " AND category = ?";     params.push(category); }
  if (activeParam !== null) {
    sql += " AND active = ?";
    params.push(activeParam === "1" ? 1 : 0);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return jsonResponse({ queries: results, count: results.length });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

  const action = body.action || "create";
  const now = Math.floor(Date.now() / 1000);

  if (action === "create") {
    if (!body.text || !body.category || !body.brand_target) {
      return jsonResponse({
        error: "Missing required: text, category, brand_target",
        hint: 'Vd: { "action": "create", "text": "...", "category": "BOFU", "brand_target": "doscom" }',
      }, 400);
    }
    if (!["TOFU", "MOFU", "BOFU"].includes(body.category)) {
      return jsonResponse({ error: "category phải là TOFU | MOFU | BOFU" }, 400);
    }
    if (!["doscom", "noma", "both"].includes(body.brand_target)) {
      return jsonResponse({ error: "brand_target phải là doscom | noma | both" }, 400);
    }
    const id = body.id || `q_custom_${crypto.randomUUID().slice(0, 8)}`;
    try {
      await env.DB.prepare(
        `INSERT INTO geo_queries (id, text, category, brand_target, language, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(id, body.text, body.category, body.brand_target, body.language || "vi", now, now).run();
    } catch (err) {
      return jsonResponse({ error: `Insert failed: ${err.message}` }, 500);
    }
    return jsonResponse({ id, action: "created", text: body.text }, 201);
  }

  if (action === "update") {
    if (!body.id) return jsonResponse({ error: "Missing id" }, 400);
    const fields = [];
    const params = [];
    for (const k of ["text", "category", "brand_target", "active", "language"]) {
      if (k in body) {
        fields.push(`${k} = ?`);
        params.push(k === "active" ? (body[k] ? 1 : 0) : body[k]);
      }
    }
    if (fields.length === 0) return jsonResponse({ error: "Nothing to update" }, 400);
    fields.push("updated_at = ?");
    params.push(now);
    params.push(body.id);
    await env.DB.prepare(`UPDATE geo_queries SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...params).run();
    return jsonResponse({ id: body.id, action: "updated", fields_updated: fields.length - 1 });
  }

  if (action === "delete") {
    if (!body.id) return jsonResponse({ error: "Missing id" }, 400);
    // Soft delete — vẫn giữ row để geo_runs FK không break
    await env.DB.prepare(
      `UPDATE geo_queries SET active = 0, updated_at = ? WHERE id = ?`
    ).bind(now, body.id).run();
    return jsonResponse({ id: body.id, action: "soft_deleted" });
  }

  return jsonResponse({
    error: `Unknown action: ${action}`,
    valid_actions: ["create", "update", "delete"],
  }, 400);
}

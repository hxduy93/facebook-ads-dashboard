// Endpoints cho 1 article:
//   GET    /api/geo/queue/:id            — chi tiết 1 article (kèm image_base64 nếu có)
//   PATCH  /api/geo/queue/:id            — update (sửa title/content/meta/...). Body: { field: value }
//   DELETE /api/geo/queue/:id            — reject (mark rejected, KHÔNG xóa khỏi DB để giữ history)
//
// Các field cho phép PATCH:
//   title, slug, meta_description, excerpt, content_html, content_markdown,
//   faq_json (JSON string), image_alt, image_prompt, image_url, image_base64,
//   wp_categories (JSON string), wp_tags (JSON string), target_site,
//   reject_reason, status (chỉ cho phép 'edited', 'pending_review', 'rejected')

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const ALLOWED_PATCH_FIELDS = new Set([
  "title", "slug", "meta_description", "excerpt",
  "content_html", "content_markdown",
  "faq_json", "schema_jsonld",
  "internal_links_json", "external_links_json",
  "image_alt", "image_prompt", "image_url", "image_base64",
  "wp_categories", "wp_tags", "target_site",
  "reject_reason",
]);

const ALLOWED_STATUS_TRANSITIONS = new Set([
  "edited", "pending_review", "rejected",
]);

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);
  const id = params.id;
  if (!id) return jsonResponse({ error: "Missing id" }, 400);

  const article = await env.DB.prepare(`
    SELECT q.*, gq.text as query_text, gq.category as query_category
    FROM geo_content_queue q
    LEFT JOIN geo_queries gq ON gq.id = q.query_id
    WHERE q.id = ?
  `).bind(id).first();

  if (!article) return jsonResponse({ error: `Article ${id} not found` }, 404);

  return jsonResponse(article);
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);
  const id = params.id;
  if (!id) return jsonResponse({ error: "Missing id" }, 400);

  let body = {};
  try { body = await request.json(); } catch {}

  const existing = await env.DB.prepare(
    `SELECT id, status FROM geo_content_queue WHERE id = ?`
  ).bind(id).first();
  if (!existing) return jsonResponse({ error: `Article ${id} not found` }, 404);

  const updates = [];
  const binds = [];

  for (const [field, value] of Object.entries(body)) {
    if (field === "status") {
      if (!ALLOWED_STATUS_TRANSITIONS.has(value)) {
        return jsonResponse({
          error: `status='${value}' không cho phép. Chỉ chấp nhận: ${[...ALLOWED_STATUS_TRANSITIONS].join(",")}`,
        }, 400);
      }
      updates.push("status = ?");
      binds.push(value);
      if (value === "rejected") {
        updates.push("rejected_at = ?");
        binds.push(Math.floor(Date.now() / 1000));
      } else if (value === "edited") {
        updates.push("reviewed_at = ?");
        binds.push(Math.floor(Date.now() / 1000));
      }
      continue;
    }

    if (!ALLOWED_PATCH_FIELDS.has(field)) continue;

    updates.push(`${field} = ?`);
    // JSON fields: nếu user gửi object/array, stringify
    if (["faq_json", "schema_jsonld", "internal_links_json", "external_links_json",
         "wp_categories", "wp_tags"].includes(field) && typeof value !== "string") {
      binds.push(JSON.stringify(value));
    } else {
      binds.push(value);
    }
  }

  if (updates.length === 0) {
    return jsonResponse({ error: "No valid fields to update" }, 400);
  }

  binds.push(id);
  await env.DB.prepare(
    `UPDATE geo_content_queue SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...binds).run();

  const updated = await env.DB.prepare(
    `SELECT id, status, title, slug, word_count, cost_total_usd FROM geo_content_queue WHERE id = ?`
  ).bind(id).first();

  return jsonResponse({
    updated: true,
    fields_changed: Object.keys(body).filter(k =>
      ALLOWED_PATCH_FIELDS.has(k) || k === "status"
    ),
    article: updated,
  });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);
  const id = params.id;
  if (!id) return jsonResponse({ error: "Missing id" }, 400);

  let body = {};
  try { body = await request.json(); } catch {}
  const reason = body.reason || "User rejected";

  const existing = await env.DB.prepare(
    `SELECT id, status FROM geo_content_queue WHERE id = ?`
  ).bind(id).first();
  if (!existing) return jsonResponse({ error: `Article ${id} not found` }, 404);

  if (existing.status === "published") {
    return jsonResponse({
      error: "Article đã published — không reject được. Unpublish thủ công trên WP admin trước.",
    }, 400);
  }

  await env.DB.prepare(`
    UPDATE geo_content_queue
    SET status = 'rejected', rejected_at = ?, reject_reason = ?
    WHERE id = ?
  `).bind(Math.floor(Date.now() / 1000), reason.slice(0, 500), id).run();

  return jsonResponse({ rejected: true, id, reason });
}

// Endpoint: GET /api/geo/queue?status=...&brand=...&limit=50
//
// Lấy danh sách articles trong geo_content_queue. Default chỉ lấy active
// (idea, drafting, pending_review, edited, publishing, failed) — không lấy published/rejected
// trừ khi explicit yêu cầu.
//
// Query params:
//   status     — comma-separated, vd "pending_review,edited"
//   brand      — "doscom" | "noma" | "all"
//   limit      — default 50, max 200
//   include_published — "1" để bao gồm published
//   include_image     — "1" để return base64 ảnh (preview), default ẨN vì quá to

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
  const statusParam = url.searchParams.get("status");
  const brand = url.searchParams.get("brand") || "all";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50"), 1), 200);
  const includePublished = url.searchParams.get("include_published") === "1";
  const includeImage = url.searchParams.get("include_image") === "1";

  let whereClause = "1=1";
  const binds = [];

  if (statusParam) {
    const statuses = statusParam.split(",").filter(Boolean);
    if (statuses.length) {
      whereClause += ` AND status IN (${statuses.map(() => "?").join(",")})`;
      binds.push(...statuses);
    }
  } else if (!includePublished) {
    whereClause += ` AND status NOT IN ('published','rejected')`;
  }

  if (brand !== "all" && ["doscom", "noma"].includes(brand)) {
    whereClause += ` AND brand = ?`;
    binds.push(brand);
  }

  binds.push(limit);

  const imageColumn = includeImage ? "image_base64," : "";

  const { results } = await env.DB.prepare(`
    SELECT
      q.id, q.query_id, q.brand, q.status,
      q.gap_severity, q.gap_engines, q.gap_summary,
      q.competitor_winners, q.source_citations,
      q.title, q.slug, q.meta_description, q.excerpt,
      q.content_html, q.content_markdown, q.faq_json, q.schema_jsonld,
      q.internal_links_json, q.external_links_json,
      q.word_count, q.reading_time_min,
      q.image_url, q.image_alt, q.image_prompt, q.image_provider,
      ${imageColumn}
      q.target_site, q.wp_post_id, q.wp_post_url,
      q.wp_categories, q.wp_tags,
      q.created_at, q.drafted_at, q.reviewed_at, q.published_at, q.rejected_at,
      q.reject_reason, q.last_error,
      q.cost_content_usd, q.cost_image_usd, q.cost_total_usd,
      q.content_model, q.content_tokens_input, q.content_tokens_output,
      gq.text as query_text, gq.category as query_category
    FROM geo_content_queue q
    LEFT JOIN geo_queries gq ON gq.id = q.query_id
    WHERE ${whereClause}
    ORDER BY q.created_at DESC
    LIMIT ?
  `).bind(...binds).all();

  // Count summary by status
  const { results: counts } = await env.DB.prepare(`
    SELECT status, COUNT(*) as count
    FROM geo_content_queue
    GROUP BY status
  `).all();

  const summary = {};
  for (const c of counts) summary[c.status] = c.count;

  // Cost summary
  const totalCost = await env.DB.prepare(
    `SELECT SUM(cost_total_usd) as total FROM geo_content_queue`
  ).first();

  return jsonResponse({
    count: results.length,
    summary,
    total_cost_usd: Number((totalCost.total || 0).toFixed(4)),
    items: results,
  });
}

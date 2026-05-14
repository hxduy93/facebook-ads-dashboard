// Endpoint: GET /api/geo/sov?days=30
//
// Share-of-Voice aggregation:
// - Per day × engine: số runs có doscom_mentioned, noma_mentioned, URL brand cited
// - Overall summary của toàn bộ period
// - Top 10 competitors by mention count
//
// Dùng cho dashboard tab GEO Monitor (Phase 4).

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
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 90);
  const from = Math.floor(Date.now() / 1000) - days * 86400;

  // Daily per-engine breakdown
  const { results: daily } = await env.DB.prepare(`
    SELECT
      date(timestamp, 'unixepoch') as day,
      engine,
      COUNT(*) as total_runs,
      SUM(doscom_mentioned) as doscom_mentions,
      SUM(noma_mentioned)   as noma_mentions,
      SUM(brand_url_cited)  as url_cited,
      ROUND(AVG(CASE WHEN doscom_mentioned = 1 THEN doscom_position END), 2) as avg_doscom_pos,
      ROUND(AVG(CASE WHEN noma_mentioned   = 1 THEN noma_position   END), 2) as avg_noma_pos,
      ROUND(SUM(cost_usd), 4) as total_cost
    FROM geo_runs
    WHERE timestamp >= ?
    GROUP BY day, engine
    ORDER BY day DESC, engine
  `).bind(from).all();

  const daily_sov = daily.map(r => ({
    day: r.day,
    engine: r.engine,
    total_runs: r.total_runs,
    doscom_mentions: r.doscom_mentions || 0,
    noma_mentions:   r.noma_mentions   || 0,
    doscom_sov: r.total_runs ? Number((r.doscom_mentions / r.total_runs).toFixed(4)) : 0,
    noma_sov:   r.total_runs ? Number((r.noma_mentions   / r.total_runs).toFixed(4)) : 0,
    url_citation_rate: r.total_runs ? Number((r.url_cited / r.total_runs).toFixed(4)) : 0,
    avg_doscom_position: r.avg_doscom_pos,
    avg_noma_position:   r.avg_noma_pos,
    cost_usd: r.total_cost || 0,
  }));

  // Overall summary
  const summary = await env.DB.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(doscom_mentioned) as doscom_mentions,
      SUM(noma_mentioned)   as noma_mentions,
      SUM(brand_url_cited)  as url_cited,
      ROUND(SUM(cost_usd), 4) as total_cost,
      MIN(timestamp) as first_run,
      MAX(timestamp) as last_run
    FROM geo_runs WHERE timestamp >= ?
  `).bind(from).first();

  // Top 10 competitors
  const { results: competitors } = await env.DB.prepare(`
    SELECT c.competitor_name, SUM(c.mention_count) as total_mentions, COUNT(DISTINCT c.run_id) as runs_appeared
    FROM geo_competitor_mentions c
    JOIN geo_runs r ON r.id = c.run_id
    WHERE r.timestamp >= ?
    GROUP BY c.competitor_name
    ORDER BY total_mentions DESC
    LIMIT 10
  `).bind(from).all();

  // Top brand citation domains
  const { results: brandDomains } = await env.DB.prepare(`
    SELECT c.domain, COUNT(*) as count
    FROM geo_citations c
    JOIN geo_runs r ON r.id = c.run_id
    WHERE r.timestamp >= ? AND c.is_brand_url = 1
    GROUP BY c.domain
    ORDER BY count DESC
    LIMIT 5
  `).bind(from).all();

  // Worst-performing queries (Doscom mention rate = 0)
  const { results: worstQueries } = await env.DB.prepare(`
    SELECT r.query_id, q.text as query_text,
           COUNT(*) as runs,
           SUM(r.doscom_mentioned) as doscom_hits
    FROM geo_runs r
    LEFT JOIN geo_queries q ON q.id = r.query_id
    WHERE r.timestamp >= ?
    GROUP BY r.query_id
    HAVING runs >= 3 AND doscom_hits = 0
    ORDER BY runs DESC
    LIMIT 10
  `).bind(from).all();

  return jsonResponse({
    days,
    from,
    to: Math.floor(Date.now() / 1000),
    summary: {
      total_runs: summary.total_runs || 0,
      doscom_sov: summary.total_runs ? Number((summary.doscom_mentions / summary.total_runs).toFixed(4)) : 0,
      noma_sov:   summary.total_runs ? Number((summary.noma_mentions   / summary.total_runs).toFixed(4)) : 0,
      url_citation_rate: summary.total_runs ? Number((summary.url_cited / summary.total_runs).toFixed(4)) : 0,
      total_cost_usd: summary.total_cost || 0,
      first_run: summary.first_run,
      last_run:  summary.last_run,
    },
    daily_sov,
    top_competitors: competitors,
    brand_citation_domains: brandDomains,
    worst_queries_doscom: worstQueries,
  });
}

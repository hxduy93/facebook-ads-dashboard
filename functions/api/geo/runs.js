// Endpoint: GET /api/geo/runs
//
// Trả về list runs với filter. Mặc định KHÔNG include response_text và raw_json
// (payload to). Set include_text=1 để có full text.
//
// Query params:
//   query_id    — filter theo 1 query
//   engine      — chatgpt | gemini | meta_ai
//   from, to    — unix timestamp range
//   days        — shortcut: last N days (default 30)
//   limit       — số rows tối đa (default 100, max 500)
//   include_text — "1" để include response_text + raw_json

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
  const queryId = url.searchParams.get("query_id");
  const engine  = url.searchParams.get("engine");
  const days    = parseInt(url.searchParams.get("days") || "30", 10);
  const fromParam = url.searchParams.get("from");
  const toParam   = url.searchParams.get("to");
  const limit   = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const includeText = url.searchParams.get("include_text") === "1";

  const now = Math.floor(Date.now() / 1000);
  const from = fromParam ? parseInt(fromParam, 10) : (now - days * 86400);
  const to   = toParam   ? parseInt(toParam, 10)   : now;

  const cols = includeText
    ? "*"
    : `id, query_id, engine, model, run_seq, timestamp,
       doscom_mentioned, doscom_position, doscom_sentiment,
       noma_mentioned, noma_position, noma_sentiment,
       brand_url_cited, tokens_input, tokens_output, cost_usd, error, processed_at`;

  let sql = `SELECT ${cols} FROM geo_runs WHERE timestamp BETWEEN ? AND ?`;
  const params = [from, to];

  if (queryId) { sql += " AND query_id = ?"; params.push(queryId); }
  if (engine)  { sql += " AND engine = ?";   params.push(engine);  }

  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  // Also fetch citations for these run IDs (1 query, batched)
  let citationsByRun = {};
  if (results.length > 0) {
    const runIds = results.map(r => r.id);
    const placeholders = runIds.map(() => "?").join(",");
    const { results: cits } = await env.DB.prepare(
      `SELECT run_id, url, title, domain, is_brand_url, position
       FROM geo_citations WHERE run_id IN (${placeholders}) ORDER BY position`
    ).bind(...runIds).all();
    for (const c of cits) {
      if (!citationsByRun[c.run_id]) citationsByRun[c.run_id] = [];
      citationsByRun[c.run_id].push(c);
    }
  }

  // Attach citations to runs
  const runs = results.map(r => ({ ...r, citations: citationsByRun[r.id] || [] }));

  return jsonResponse({
    runs,
    count: runs.length,
    filter: { query_id: queryId, engine, from, to, days, limit, include_text: includeText },
  });
}

// Endpoint: GET hoặc POST /api/geo/test-engine
//
// GET  /api/geo/test-engine?q=máy+dò+camera+ẩn+nào+tốt
// GET  /api/geo/test-engine?query_id=q_dos_001
// POST /api/geo/test-engine  body: { "query": "..." } hoặc { "query_id": "q_dos_001" }
//
// Auth: tự động qua functions/_middleware.js (Google OAuth session cookie).
//       Mở trực tiếp trong browser sau khi đã login dashboard.
//
// Trả về kết quả 3 AI engine (chatgpt + gemini + meta_ai) chạy song song,
// kèm brand detection (Doscom/NOMA mentions, position, sentiment).
// Dùng để debug Phase 2 trước khi build chunked cron + dashboard tab.

import { queryAllEngines } from "./_utils/ai-engines/index.js";
import { detectMentions }  from "./_utils/brand-detect.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handle(queryText, queryId, env) {
  if (!queryText && queryId) {
    if (!env.DB) {
      return jsonResponse({
        error: "D1 binding 'DB' missing. Settings → Functions → Bindings → Add D1 → name: DB → doscom_geo.",
      }, 500);
    }
    const row = await env.DB.prepare(
      "SELECT id, text FROM geo_queries WHERE id = ?"
    ).bind(queryId).first();
    if (!row) return jsonResponse({ error: `Query không tồn tại: ${queryId}` }, 404);
    queryText = row.text;
  }

  if (!queryText) {
    return jsonResponse({
      error: "Thiếu 'query' (string) hoặc 'query_id' (id của geo_queries).",
      hint: "Vd GET: /api/geo/test-engine?q=máy+dò+camera+ẩn+nào+tốt | ?query_id=q_dos_001",
    }, 400);
  }

  const t0 = Date.now();
  const engineResults = await queryAllEngines(queryText, env);
  const elapsedMs = Date.now() - t0;

  const results = {};
  let totalCost = 0;
  let doscomCount = 0;
  let nomaCount = 0;
  let urlCitedCount = 0;

  for (const [eng, r] of Object.entries(engineResults)) {
    const mentions = detectMentions(r);
    results[eng] = {
      engine: r.engine,
      model:  r.model,
      response_text: r.response_text,
      citations:     r.citations,
      mentions,
      tokens:   { input: r.tokens_input, output: r.tokens_output },
      cost_usd: r.cost_usd,
      error:    r.error || null,
    };
    totalCost += r.cost_usd || 0;
    if (mentions.doscom_mentioned) doscomCount++;
    if (mentions.noma_mentioned)   nomaCount++;
    if (mentions.brand_url_cited)  urlCitedCount++;
  }

  return jsonResponse({
    query: queryText,
    query_id: queryId || null,
    results,
    summary: {
      doscom_mentions: doscomCount,
      noma_mentions:   nomaCount,
      brand_url_cited_count: urlCitedCount,
      total_cost_usd: Number(totalCost.toFixed(6)),
      elapsed_ms: elapsedMs,
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q   = url.searchParams.get("q") || url.searchParams.get("query");
  const qid = url.searchParams.get("query_id");
  if (!q && !qid) {
    return jsonResponse({
      info: "GEO test-engine — chạy 1 query qua 3 AI engine (chatgpt + gemini + meta_ai).",
      usage: {
        get_by_text: "/api/geo/test-engine?q=máy+dò+camera+ẩn+nào+tốt",
        get_by_id:   "/api/geo/test-engine?query_id=q_dos_001",
        post: "POST /api/geo/test-engine  body: {\"query\":\"...\"} hoặc {\"query_id\":\"q_dos_001\"}",
      },
      sample_query_ids: ["q_dos_001", "q_dos_011", "q_nom_004", "q_nom_010"],
    });
  }
  return handle((q || "").trim(), qid, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Body không phải JSON hợp lệ." }, 400);
  }
  const q   = (body?.query || "").trim();
  const qid = body?.query_id || null;
  return handle(q, qid, env);
}

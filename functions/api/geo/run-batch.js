// Endpoint: POST /api/geo/run-batch (cũng support GET cho manual test trên browser)
//
// Lấy N pending jobs từ geo_job_queue → chạy 3 AI engine → ghi kết quả vào
// geo_runs + geo_citations + geo_competitor_mentions → mark job done/failed.
//
// Được GitHub Actions cron gọi mỗi 30 phút với header X-Test-Token (whitelist
// trong _middleware.js). Có thể trigger thủ công qua browser (cookie auth).
//
// Retry logic: nếu engine fail → retry_count++. Khi retry_count = 3 → mark failed.
// Batch size mặc định 6 (đủ trong Cloudflare 30s timeout, ngay cả khi tất cả là ChatGPT
// web_search ~8-15s do chạy song song qua Promise.allSettled).

import { queryEngine } from "./_utils/ai-engines/index.js";
import { detectMentions } from "./_utils/brand-detect.js";

const BATCH_SIZE  = 6;
const MAX_RETRIES = 3;
const BRAND_DOMAINS = ["doscom.vn", "noma-autocare.vn", "noma.vn"];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function isBrandUrl(url, title) {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();
  return BRAND_DOMAINS.some(d => u.includes(d) || t.includes(d));
}

async function processJob(job, env) {
  const t0 = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE geo_job_queue SET status = 'processing', started_at = ? WHERE id = ?`
  ).bind(t0, job.id).run();

  try {
    const q = await env.DB.prepare(
      `SELECT text FROM geo_queries WHERE id = ?`
    ).bind(job.query_id).first();
    if (!q) throw new Error(`Query not found: ${job.query_id}`);

    const response = await queryEngine(job.engine, q.text, env);
    if (response.error) throw new Error(response.error);

    const mentions = detectMentions(response);
    const runId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(`
      INSERT INTO geo_runs (
        id, query_id, engine, model, run_seq, timestamp,
        response_text, doscom_mentioned, doscom_position, doscom_sentiment,
        noma_mentioned, noma_position, noma_sentiment,
        brand_url_cited, tokens_input, tokens_output, cost_usd,
        raw_json, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId, job.query_id, response.engine, response.model, job.run_seq, now,
      (response.response_text || "").slice(0, 8000),
      mentions.doscom_mentioned ? 1 : 0, mentions.doscom_position, mentions.doscom_sentiment,
      mentions.noma_mentioned   ? 1 : 0, mentions.noma_position,   mentions.noma_sentiment,
      mentions.brand_url_cited  ? 1 : 0,
      response.tokens_input || 0, response.tokens_output || 0, response.cost_usd || 0,
      JSON.stringify(response.raw_json || {}).slice(0, 20000), now
    ).run();

    // Insert citations
    for (let i = 0; i < (response.citations || []).length; i++) {
      const c = response.citations[i];
      const domain = extractDomain(c.url);
      await env.DB.prepare(`
        INSERT INTO geo_citations (id, run_id, url, title, domain, is_brand_url, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), runId,
        (c.url || "").slice(0, 1000),
        (c.title || "").slice(0, 500),
        domain,
        isBrandUrl(c.url, c.title) ? 1 : 0,
        i + 1
      ).run();
    }

    // Insert competitor mentions
    for (const [name, count] of Object.entries(mentions.competitor_mentions || {})) {
      await env.DB.prepare(`
        INSERT INTO geo_competitor_mentions (id, run_id, competitor_name, mention_count)
        VALUES (?, ?, ?, ?)
      `).bind(crypto.randomUUID(), runId, name, count).run();
    }

    await env.DB.prepare(
      `UPDATE geo_job_queue SET status = 'done', finished_at = ? WHERE id = ?`
    ).bind(Math.floor(Date.now() / 1000), job.id).run();

    return {
      job_id: job.id,
      status: "done",
      run_id: runId,
      engine: job.engine,
      cost_usd: response.cost_usd || 0,
      tokens: response.tokens_output || 0,
    };

  } catch (err) {
    const newRetry = (job.retry_count || 0) + 1;
    const newStatus = newRetry >= MAX_RETRIES ? "failed" : "pending";
    const errMsg = String(err?.message || err).slice(0, 500);

    await env.DB.prepare(
      `UPDATE geo_job_queue SET status = ?, retry_count = ?, error = ? WHERE id = ?`
    ).bind(newStatus, newRetry, errMsg, job.id).run();

    return {
      job_id: job.id,
      status: newStatus,
      retry: newRetry,
      engine: job.engine,
      error: errMsg,
    };
  }
}

async function handle(env, opts = {}) {
  if (!env.DB) {
    return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);
  }

  const limit = Math.min(Math.max(parseInt(opts.limit) || BATCH_SIZE, 1), 20);

  const { results: jobs } = await env.DB.prepare(
    `SELECT * FROM geo_job_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
  ).bind(limit).all();

  if (jobs.length === 0) {
    return jsonResponse({
      message: "No pending jobs",
      processed: 0,
      batch_size: limit,
    });
  }

  const t0 = Date.now();
  const results = await Promise.allSettled(jobs.map(j => processJob(j, env)));
  const elapsedMs = Date.now() - t0;

  const summary = { done: 0, failed: 0, retry: 0, total_cost_usd: 0 };
  const details = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      const v = r.value;
      if (v.status === "done")    summary.done++;
      if (v.status === "failed")  summary.failed++;
      if (v.status === "pending") summary.retry++;
      summary.total_cost_usd += v.cost_usd || 0;
      details.push(v);
    } else {
      details.push({ status: "error", error: r.reason?.message || String(r.reason) });
    }
  }
  summary.total_cost_usd = Number(summary.total_cost_usd.toFixed(6));

  return jsonResponse({
    batch_size: limit,
    processed: jobs.length,
    elapsed_ms: elapsedMs,
    summary,
    details,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = await request.json(); } catch {}
  return handle(env, body || {});
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return handle(context.env, {
    limit: url.searchParams.get("limit"),
  });
}

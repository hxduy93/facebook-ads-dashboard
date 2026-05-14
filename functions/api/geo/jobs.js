// Endpoint: POST /api/geo/jobs (cũng support GET cho manual test)
//
// Tạo daily batch jobs cho geo_job_queue: mọi active query × 3 engine × runs_per_query.
// Idempotent — skip nếu hôm nay (UTC 00:00) đã có jobs created, trừ khi {force: true}.
//
// Được GitHub Actions cron gọi mỗi 30 phút (cùng workflow với run-batch). Bypass auth
// qua X-Test-Token (_middleware.js whitelist). Manual trigger qua browser cũng OK.

import { ENGINES } from "./_utils/ai-engines/index.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function todayStartUnix() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

async function handle(env, opts = {}) {
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  const runsPerQuery = Math.min(Math.max(parseInt(opts.runs_per_query) || 1, 1), 3);
  const force = !!opts.force;
  const todayStart = todayStartUnix();

  if (!force) {
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM geo_job_queue WHERE created_at >= ?`
    ).bind(todayStart).first();
    if (existing && existing.cnt > 0) {
      return jsonResponse({
        message: "Today's jobs already created — skipping (idempotent)",
        existing_count: existing.cnt,
        hint: "Pass {\"force\": true} để override",
      });
    }
  }

  const { results: queries } = await env.DB.prepare(
    `SELECT id FROM geo_queries WHERE active = 1`
  ).all();

  if (queries.length === 0) {
    return jsonResponse({ error: "No active queries in geo_queries table" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const stmts = [];
  for (const q of queries) {
    for (const engine of ENGINES) {
      for (let seq = 1; seq <= runsPerQuery; seq++) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO geo_job_queue (id, query_id, engine, run_seq, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`
          ).bind(crypto.randomUUID(), q.id, engine, seq, now)
        );
      }
    }
  }

  // D1 batch limit ~1000 statements. 30 queries × 3 engines × 3 runs = 270 statements.
  // Chia chunk để an toàn nếu sau này scale up queries.
  const CHUNK = 50;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }

  return jsonResponse({
    message: "Daily jobs created",
    queries: queries.length,
    engines: ENGINES.length,
    runs_per_query: runsPerQuery,
    total_jobs: stmts.length,
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
    runs_per_query: url.searchParams.get("runs_per_query"),
    force: url.searchParams.get("force") === "1",
  });
}

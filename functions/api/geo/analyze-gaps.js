// Endpoint: POST /api/geo/analyze-gaps
//
// Phân tích GEO data trong N ngày gần nhất → tìm query mà brand bị "ghost"
// (AI không nhắc Doscom/NOMA) → gọi Claude sinh title + brief cho từng lỗ hổng
// → lưu vào geo_content_queue với status='idea' để user duyệt.
//
// Body: {
//   days: 7,           // số ngày data để phân tích
//   brand: "doscom" | "noma" | "both",
//   max_ideas: 10,     // tối đa bao nhiêu ý tưởng sinh ra
//   severity: ["A","B"], // 'A' (3/3 engine miss), 'B' (2/3), 'C' (1/3)
//   dry_run: false     // true = chỉ trả về preview, không lưu DB
// }

import { callClaude } from "./_utils/claude.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const IDEA_SYSTEM_PROMPT = `Bạn là chuyên gia GEO (Generative Engine Optimization) cho Doscom (phần mềm quản lý bán hàng) và NOMA (auto care/bảo dưỡng xe). Nhiệm vụ: phân tích "lỗ hổng" — câu hỏi mà AI engine (ChatGPT/Gemini) KHÔNG nhắc brand → đề xuất bài viết SEO để fix.

NGUYÊN TẮC:
- Title phải khác câu hỏi gốc, mang góc nhìn người dùng đang search.
- Title chứa keyword chính + benefit/năm hiện tại (2026) khi phù hợp.
- Title 50-65 ký tự để hiển thị đẹp trên SERP + ChatGPT.
- Mỗi bài có angle riêng (so sánh / hướng dẫn / case study / listicle), KHÔNG trùng angle nếu cùng query.
- Slug viết thường, dấu gạch ngang, không dấu tiếng Việt.
- Brief 2-3 câu mô tả vì sao bài này sẽ giúp brand được AI nhắc.

OUTPUT BẮT BUỘC: JSON array hợp lệ, không markdown, không text bao quanh.`;

function buildIdeaPrompt(gap, brand) {
  const brandName = brand === "doscom" ? "Doscom" : "NOMA";
  const winners = JSON.parse(gap.competitor_winners || "[]");
  const citations = JSON.parse(gap.source_citations || "[]");

  return `LỖ HỔNG ${gap.severity}: ${brandName} bị "ghost" trên query này.

QUERY GỐC: "${gap.query_text}"
CATEGORY: ${gap.category || "?"}
ENGINES MISS: ${(JSON.parse(gap.gap_engines || "[]")).join(", ")}
ĐỐI THỦ THẮNG: ${winners.slice(0, 5).map(w => `${w.name} (${w.mentions} mentions)`).join(", ") || "không có"}
NGUỒN AI TRÍCH (đối thủ): ${citations.slice(0, 5).map(c => c.domain).join(", ") || "không có"}

Sinh 3 ý tưởng bài viết (3 angle khác nhau) để fix lỗ hổng này. Output JSON array:
[
  {
    "title": "...",
    "slug": "...",
    "angle": "comparison" | "howto" | "listicle" | "case_study" | "explainer",
    "primary_keyword": "...",
    "brief": "2-3 câu: bài này sẽ chứa gì, cấu trúc thế nào để AI dễ trích",
    "target_word_count": 1500-3000
  },
  ...
]`;
}

async function findGaps(env, { days, brand }) {
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  const brandFilter = brand === "both"
    ? "q.brand_target IN ('doscom','noma','both')"
    : `q.brand_target IN ('${brand}','both')`;
  const mentionCol = brand === "noma" ? "noma_mentioned" : "doscom_mentioned";

  // Group by query: đếm số engine miss / hit
  const { results: gaps } = await env.DB.prepare(`
    SELECT
      r.query_id,
      q.text as query_text,
      q.category,
      q.brand_target,
      COUNT(DISTINCT r.engine) as engines_total,
      SUM(CASE WHEN r.${mentionCol} = 0 THEN 1 ELSE 0 END) as engines_miss,
      GROUP_CONCAT(DISTINCT CASE WHEN r.${mentionCol} = 0 THEN r.engine END) as engines_missed_csv,
      COUNT(*) as runs,
      MAX(r.timestamp) as last_run
    FROM geo_runs r
    JOIN geo_queries q ON q.id = r.query_id
    WHERE r.timestamp >= ?
      AND ${brandFilter}
    GROUP BY r.query_id
    HAVING engines_miss >= 1
    ORDER BY engines_miss DESC, runs DESC
  `).bind(from).all();

  // Enrich từng gap với competitors + citations
  for (const g of gaps) {
    const engines_missed = (g.engines_missed_csv || "").split(",").filter(Boolean);
    const severity = engines_missed.length >= 3 ? "A"
                   : engines_missed.length === 2 ? "B"
                   : "C";
    g.gap_engines = JSON.stringify(engines_missed);
    g.severity = severity;

    // Top competitors winning this query
    const { results: comps } = await env.DB.prepare(`
      SELECT cm.competitor_name as name, SUM(cm.mention_count) as mentions
      FROM geo_competitor_mentions cm
      JOIN geo_runs r ON r.id = cm.run_id
      WHERE r.query_id = ? AND r.timestamp >= ?
      GROUP BY cm.competitor_name
      ORDER BY mentions DESC
      LIMIT 8
    `).bind(g.query_id, from).all();
    g.competitor_winners = JSON.stringify(comps);

    // Citations đối thủ được trích
    const { results: cits } = await env.DB.prepare(`
      SELECT c.domain, c.url, c.title, COUNT(*) as freq
      FROM geo_citations c
      JOIN geo_runs r ON r.id = c.run_id
      WHERE r.query_id = ? AND r.timestamp >= ? AND c.is_brand_url = 0
      GROUP BY c.domain
      ORDER BY freq DESC
      LIMIT 8
    `).bind(g.query_id, from).all();
    g.source_citations = JSON.stringify(cits);
  }

  return gaps;
}

async function generateIdeasForGap(env, gap, brand) {
  const userPrompt = buildIdeaPrompt(gap, brand);
  const result = await callClaude(env, {
    model: "haiku",
    systemPrompt: IDEA_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 2000,
    jsonOutput: true,
  });

  const ideas = Array.isArray(result.parsed) ? result.parsed : [];
  return { ideas, cost: result.cost_usd, model: result.model };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}

  const days     = Math.min(Math.max(parseInt(body.days) || 7, 1), 90);
  const brand    = ["doscom", "noma", "both"].includes(body.brand) ? body.brand : "both";
  const maxIdeas = Math.min(Math.max(parseInt(body.max_ideas) || 10, 1), 30);
  const severityFilter = Array.isArray(body.severity) && body.severity.length
    ? body.severity : ["A", "B"];
  const dryRun = !!body.dry_run;

  // 1. Find gaps
  const allGaps = await findGaps(env, { days, brand });
  const gaps = allGaps.filter(g => severityFilter.includes(g.severity));

  if (gaps.length === 0) {
    return jsonResponse({
      message: `No gaps found with severity ${severityFilter.join(",")} in last ${days} days`,
      gaps_total: allGaps.length,
      gaps_filtered: 0,
      ideas: [],
    });
  }

  // 2. Limit top-N gaps để khỏi đốt tiền Claude (mỗi gap = 1 call)
  const topGaps = gaps.slice(0, maxIdeas);

  // 3. Gen ideas qua Claude (chạy song song, tối đa 5 cùng lúc để khỏi rate-limit)
  const allIdeas = [];
  let totalCost = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < topGaps.length; i += CONCURRENCY) {
    const batch = topGaps.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(g => {
        // Decide brand per gap: ưu tiên doscom nếu brand_target='both' và đang scan both
        const targetBrand = g.brand_target === "noma" ? "noma" : "doscom";
        return generateIdeasForGap(env, g, targetBrand).then(r => ({ gap: g, ...r, targetBrand }));
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        totalCost += r.value.cost;
        for (const idea of r.value.ideas) {
          allIdeas.push({ ...idea, gap: r.value.gap, targetBrand: r.value.targetBrand, content_model: r.value.model });
        }
      } else {
        allIdeas.push({ error: r.reason?.message || String(r.reason) });
      }
    }
  }

  // 4. Lưu vào DB (trừ khi dry_run)
  let inserted = 0;
  if (!dryRun) {
    const now = Math.floor(Date.now() / 1000);
    for (const idea of allIdeas) {
      if (idea.error || !idea.title) continue;
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(`
          INSERT INTO geo_content_queue (
            id, query_id, brand, status,
            gap_severity, gap_engines, gap_summary, competitor_winners, source_citations,
            title, slug, content_model, created_at, cost_content_usd
          ) VALUES (?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          idea.gap.query_id,
          idea.targetBrand,
          idea.gap.severity,
          idea.gap.gap_engines,
          idea.brief || null,
          idea.gap.competitor_winners,
          idea.gap.source_citations,
          (idea.title || "").slice(0, 250),
          (idea.slug || "").slice(0, 200),
          idea.content_model || null,
          now,
          0  // chưa sinh content nên cost = 0
        ).run();
        inserted++;
      } catch (err) {
        // Skip duplicate slug, etc.
      }
    }
  }

  return jsonResponse({
    days,
    brand,
    severity_filter: severityFilter,
    gaps_total: allGaps.length,
    gaps_analyzed: topGaps.length,
    ideas_generated: allIdeas.filter(i => !i.error).length,
    ideas_failed: allIdeas.filter(i => i.error).length,
    ideas_inserted: inserted,
    total_cost_usd: Number(totalCost.toFixed(6)),
    preview: dryRun ? allIdeas.slice(0, 10) : undefined,
    dry_run: dryRun,
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return onRequestPost({
    request: new Request(context.request.url, {
      method: "POST",
      body: JSON.stringify({
        days: url.searchParams.get("days"),
        brand: url.searchParams.get("brand"),
        max_ideas: url.searchParams.get("max_ideas"),
        dry_run: url.searchParams.get("dry_run") === "1",
        severity: (url.searchParams.get("severity") || "A,B").split(","),
      }),
    }),
    env: context.env,
  });
}

// API Agent Google Ads AI — Cloudflare Workers AI (Llama 3.3 70B)
// Endpoint: POST /api/agent-google-ai
// Body: {
//   mode: "audit_account" | "audit_keyword" | "audit_gdn" | "audit_headline"
//        | "suggest_keyword" | "suggest_headline" | "suggest_banner" | "ask",
//   question?: string,    // required nếu mode === "ask"
//   context?: { product?, period?, campaign? }
// }
// Response: { ok, mode, response (markdown), neurons_used, model }
//
// Powered by Cloudflare Workers AI — free tier 10K neurons/day.
// Reuses pattern từ generate-ad-copy.js đã hoạt động ổn định.

import { verifySession } from "../_middleware.js";

const SESSION_COOKIE = "doscom_session";
const CF_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SKILL_FILES = {
  parent: "/data/skills-md/doscom-google-ads-audit.md",
  keyword: "/data/skills-md/doscom-keyword-audit-suggest.md",
  gdn: "/data/skills-md/doscom-gdn-audit-suggest.md",
  headline: "/data/skills-md/doscom-headline-audit-suggest.md",
};

// Mode → skill nào cần load + data nào cần
const MODE_CONFIG = {
  audit_account:    { skills: ["parent"],   data: ["context", "spend", "revenue", "inventory"] },
  audit_keyword:    { skills: ["keyword"],  data: ["context", "search_terms", "spend", "revenue", "inventory"] },
  audit_gdn:        { skills: ["gdn"],      data: ["context", "ads", "placement", "spend", "inventory"] },
  audit_headline:   { skills: ["headline"], data: ["ads", "context", "inventory"] },
  suggest_keyword:  { skills: ["keyword"],  data: ["search_terms", "context", "inventory"] },
  suggest_headline: { skills: ["headline"], data: ["ads", "context", "inventory"] },
  suggest_banner:   { skills: ["gdn"],      data: ["ads", "placement", "context", "inventory"] },
  ask:              { skills: ["parent", "keyword", "gdn", "headline"], data: ["context", "spend", "revenue", "inventory"] },
};

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Helper: fetch JSON file từ /data với fallback null
async function fetchJson(origin, path, cookieHeader) {
  try {
    const url = new URL(path, origin).toString();
    const r = await fetch(url, { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function fetchText(origin, path, cookieHeader) {
  try {
    const url = new URL(path, origin).toString();
    const r = await fetch(url, { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}

// Compact KV inventory để giảm token
async function fetchInventoryCompact(env) {
  try {
    const list = await env.INVENTORY.list({ limit: 1000 });
    const items = [];
    for (const k of list.keys.slice(0, 300)) {
      try {
        const v = await env.INVENTORY.get(k.name, { type: "json" });
        if (v && v.gia_nhap_vnd > 0) {
          items.push({
            code: k.name,
            cost: v.gia_nhap_vnd,
            price: v.gia_ban_vnd,
            stock: v.ton_kho,
            status: v.trang_thai,
          });
        }
      } catch (e) {}
    }
    return items;
  } catch (e) { return []; }
}

// Compact data sources để gửi vào AI (giảm token)
function compactSearchTerms(j, topN = 50) {
  if (!j || !j.term_aggregates) return null;
  const arr = Object.entries(j.term_aggregates)
    .map(([term, s]) => ({
      term,
      clicks: s.clicks_30d,
      conv: s.conversions_30d,
      cpc: s.cpc_30d,
      ctr: s.ctr_30d,
      spend: s.spend_30d,
    }))
    .sort((a, b) => (b.conv * 1000 + b.clicks) - (a.conv * 1000 + a.clicks))
    .slice(0, topN);
  return { date_range: j.date_range, top_terms: arr, total_unique: j.unique_search_terms };
}

function compactRevenue(j) {
  if (!j) return null;
  return {
    generated_at: j.generated_at,
    window_days: j.window_days,
    total_orders: j.total_orders,
    summary: j.summary,
    category_breakdown: j.category_breakdown_by_period,
    top_products: (j.top_products_website_by_period || {}).last_30d || (j.top_products_website_by_period || {}).this_month || null,
  };
}

function compactSpend(j) {
  if (!j) return null;
  return {
    generated_at: j.generated_at,
    date_range: j.date_range,
    total_spend: j.total_spend,
    by_category: j.by_category,
    by_campaign_top: (j.campaigns_raw || []).slice(0, 30),
  };
}

function compactAds(j, topN = 30) {
  if (!j) return null;
  const ads = (j.ads || []).slice(0, topN);
  return { date_range: j.date_range, total_ads: (j.ads || []).length, sample_ads: ads };
}

function compactPlacement(j, topN = 30) {
  if (!j) return null;
  const list = (j.placements || []).sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, topN);
  return { date_range: j.date_range, top_spend: list };
}

function buildSystemPrompt(skillTexts) {
  return [
    "Bạn là chuyên gia phân tích Google Ads cho Doscom Holdings.",
    "Trả lời 100% TIẾNG VIỆT, có dấu, dùng dấu phẩy ngàn cho số tiền (vd 1,250,000đ).",
    "Phong cách: thẳng thắn, ngắn gọn, có bảng so sánh, KHÔNG lan man, KHÔNG khen sáo rỗng.",
    "Mọi số liệu phải dựa trên DATA cụ thể trong context — KHÔNG bịa.",
    "Nếu thiếu data → ghi rõ 'Insufficient data — cần thêm X ngày'.",
    "Khi đề xuất action, mỗi action phải có: cụ thể (làm gì), đo được (bao nhiêu đ tiết kiệm/tăng), ưu tiên (cao/trung/thấp).",
    "",
    "═══ SKILL & RULE ═══",
    skillTexts.join("\n\n---\n\n"),
  ].join("\n");
}

function buildUserPrompt(mode, question, dataContext) {
  const parts = [];
  parts.push(`MODE: ${mode}`);
  if (question) parts.push(`USER QUESTION: ${question}`);
  parts.push("");
  parts.push("═══ DATA CONTEXT ═══");
  parts.push(JSON.stringify(dataContext, null, 2));
  parts.push("");
  parts.push("═══ YÊU CẦU ═══");
  switch (mode) {
    case "audit_account":
      parts.push("Audit toàn bộ tài khoản theo skill parent. Output: tổng điểm/100, xếp loại A-F, top 5 Quick Win, cảnh báo nguy hiểm.");
      break;
    case "audit_keyword":
      parts.push("Audit từ khoá: chấm điểm 7 nhóm, phân bậc Tier 1/2/3, ngưỡng pause, top SP có CPA vượt trần.");
      break;
    case "audit_gdn":
      parts.push("Audit GDN/PMax: chấm điểm 6 nhóm, asset disapproved, placement lãng phí, brand safety risk.");
      break;
    case "audit_headline":
      parts.push("Audit RSA + PMax text asset: chấm điểm 6 nhóm, headline cliché, công thức thiếu, USP chưa cover.");
      break;
    case "suggest_keyword":
      parts.push("Đề xuất từ khoá thay thế: chạy 5 cơ chế (Harvest, Replace, Long-tail, Competitor, Seasonal). Top 15 đề xuất kèm Impact.");
      break;
    case "suggest_headline":
      parts.push("Sinh brief headline mới: 5 cơ chế (Replicate, Replace, Formula Gap, USP-Driven, Seasonal). Mỗi brief có ký tự count, công thức, hypothesis.");
      break;
    case "suggest_banner":
      parts.push("Sinh brief banner mới: 5 cơ chế (Top Performer, Replace Loser, Aspect Gap, A/B Challenger, Seasonal). Mỗi brief có size, layout, color hex, copy, CTA.");
      break;
    case "ask":
      parts.push("Trả lời câu hỏi của user dựa trên skill + data. Nếu cần, gọi formula từ skill.");
      break;
  }
  return parts.join("\n");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.AI) {
    return jsonResponse({
      error: "Thiếu Workers AI binding. Vào Cloudflare Pages → Settings → Functions → Bindings → Add → Workers AI → name: AI.",
    }, 500);
  }

  // Auth check
  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Chưa đăng nhập" }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Body phải là JSON" }, 400); }

  const mode = body.mode || "ask";
  const question = (body.question || "").trim();
  const userContext = body.context || {};

  const cfg = MODE_CONFIG[mode];
  if (!cfg) return jsonResponse({ error: `Mode không hỗ trợ: ${mode}. Modes: ${Object.keys(MODE_CONFIG).join(", ")}` }, 400);

  if (mode === "ask" && !question) return jsonResponse({ error: "Mode 'ask' cần question" }, 400);

  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = url.origin;

  // 1. Load skills
  const skillTexts = [];
  for (const sk of cfg.skills) {
    const t = await fetchText(origin, SKILL_FILES[sk], cookieHeader);
    if (t) skillTexts.push(t);
  }
  if (!skillTexts.length) return jsonResponse({ error: "Không load được skill markdown từ /data/skills-md/" }, 502);

  // 2. Load data nguồn
  const dataContext = { mode, user_context: userContext, generated_at: new Date().toISOString() };
  const tasks = [];

  if (cfg.data.includes("context")) tasks.push(fetchJson(origin, "/data/google-ads-context.json", cookieHeader).then(j => dataContext.google_ads_context = j ? { date_range: j.date_range, total_campaigns: (j.campaigns_raw||[]).length, generated_at: j.generated_at } : null));
  if (cfg.data.includes("spend")) tasks.push(fetchJson(origin, "/data/google-ads-spend.json", cookieHeader).then(j => dataContext.google_ads_spend = compactSpend(j)));
  if (cfg.data.includes("revenue")) tasks.push(fetchJson(origin, "/data/product-revenue.json", cookieHeader).then(j => dataContext.pancake_revenue = compactRevenue(j)));
  if (cfg.data.includes("search_terms")) tasks.push(fetchJson(origin, "/data/google-ads-search-terms.json", cookieHeader).then(j => dataContext.search_terms = compactSearchTerms(j, 50)));
  if (cfg.data.includes("ads")) tasks.push(fetchJson(origin, "/data/google-ads-ads.json", cookieHeader).then(j => dataContext.ads = compactAds(j, 30)));
  if (cfg.data.includes("placement")) tasks.push(fetchJson(origin, "/data/google-ads-placement.json", cookieHeader).then(j => dataContext.placement = compactPlacement(j, 30)));
  if (cfg.data.includes("inventory") && env.INVENTORY) tasks.push(fetchInventoryCompact(env).then(items => dataContext.inventory = items));

  await Promise.all(tasks);

  // 3. Build prompt
  const systemPrompt = buildSystemPrompt(skillTexts);
  const userPrompt = buildUserPrompt(mode, question, dataContext);

  // 4. Gọi Cloudflare AI
  let aiResult;
  try {
    aiResult = await env.AI.run(CF_AI_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });
  } catch (e) {
    return jsonResponse({ error: "Lỗi gọi Workers AI: " + e.message }, 502);
  }

  return jsonResponse({
    ok: true,
    mode,
    model: CF_AI_MODEL,
    response: aiResult.response || aiResult.result || "",
    skills_loaded: cfg.skills,
    data_loaded: cfg.data,
  });
}

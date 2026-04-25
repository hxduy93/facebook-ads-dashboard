// API Agent Google Ads AI — Cloudflare Workers AI
// Endpoint: POST /api/agent-google-ai
// Body: { mode, question?, context? }
//
// Tối ưu v2: dùng compact skill summary thay full markdown để giảm token
// Model fast: Llama 3.1 8B cho ask + suggest, Llama 3.3 70B cho audit phức tạp

import { verifySession } from "../_middleware.js";

const SESSION_COOKIE = "doscom_session";
const MODEL_FAST = "@cf/meta/llama-3.1-8b-instruct-fast";  // < 10s response
const MODEL_BIG = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";  // dùng cho audit

// Skill summary (compact — không full file) để giảm token
const SKILL_SUMMARY = {
  parent: `# DOSCOM GOOGLE ADS AUDIT — Tổng quan

Mục tiêu: Lợi nhuận ≥30% doanh thu (KHÔNG dùng ROAS)

CÔNG THỨC:
- Profit = Revenue − VAT 10% − Giá vốn − Chi phí QC
- Trần CPA Search = 0.6 × Giá bán − Giá vốn − VAT 10%
- Trần CPA Display = 0.5 × Giá bán − Giá vốn − VAT 10%

8 nhóm chấm điểm (100đ):
1. Theo dõi chuyển đổi & Tracking — 25%
2. Hiệu quả lợi nhuận theo nhóm SP — 22%
3. Lãng phí ngân sách — 13%
4. Quảng cáo sáng tạo Search RSA — 12%
5. Cấu trúc & Loại khớp từ khoá — 10%
6. Trang đích — 8%
7. Ngân sách & Thị phần hiển thị — 5%
8. Tuân thủ chính sách — 5%

Xếp loại: 85+=A, 70-84=B, 55-69=C, 40-54=D, <40=F`,

  keyword: `# DOSCOM KEYWORD AUDIT + SUGGEST

Phân bậc 3-Tier (làm TRƯỚC mọi quyết định):
- Tier 1 Cốt lõi: máy dò nghe lén, camera giấu, ghi âm, định vị, NOMA → KHÔNG BAO GIỜ pause
- Tier 2 Kế cận: liên quan nhưng không chính → áp rule sau Statistical Gate
- Tier 3 Không liên quan → pause mạnh tay

Cổng kiểm định: Số đơn dự kiến < 3 → KHÔNG pause dù 0 conv

7 nhóm chấm điểm (100đ):
1. Quality Score — 20%
2. Match Type & CTR — 15%
3. CVR & CPA per Tier — 20%
4. Cấu trúc & Negative — 15%
5. Brand vs Non-brand — 10%
6. Cannibalization — 10%
7. Search Term Health — 10%

5 cơ chế đề xuất từ khoá thay thế:
1. HARVEST: search term có conv ≥2, CTR ≥4%, CVR ≥3%, chưa là kw → tạo Exact
2. REPLACE DYING: kw Tier 2/3 sắp pause → tạo Phrase trước, pause sau 7 ngày
3. LONG-TAIL: Tier 1 chạy tốt → 5-10 long-tail (use case + SP code + intent)
4. COMPETITOR: Auction Insights → flag + defensive brand
5. SEASONAL: Tết / 8/3 / hè / Black Friday`,

  gdn: `# DOSCOM GDN/PMAX AUDIT + SUGGEST BANNER

Trần CPA Display chặt: 0.5 × (Bán − Vốn − VAT)

6 nhóm chấm điểm (100đ):
1. Chất lượng Banner/Asset — 25%
2. PMax Asset Rating — 20%
3. Placement Quality — 20%
4. Targeting & Audience — 15%
5. Measurement & Attribution — 10%
6. Cấu trúc Campaign Display — 10%

5 cơ chế đề xuất banner:
1. TOP PERFORMER REPLICATION: banner CTR >0.8% → 5-7 biến thể giữ format
2. REPLACE LOSER với Brief: CTR <0.1% → chẩn đoán + brief đầy đủ
3. FILL ASPECT RATIO GAP: thiếu 9:16 / 4:5 / 1.91:1 → ưu tiên 9:16
4. A/B TEST CHALLENGER: 3 challenger có hypothesis cụ thể
5. SEASONAL: Tết / hè / du lịch

Brief banner phải có: size, layout vùng, color hex, copy, CTA, hypothesis, cost dựng`,

  headline: `# DOSCOM HEADLINE AUDIT + SUGGEST (RSA + PMax)

USP catalog 8 nhóm SP Doscom:
- Camera video call (DA8.1): Gọi 2 chiều, ông bà bố mẹ, không cần smartphone, HD
- Camera 4G: Không wifi, không hồng ngoại, quay đêm rõ, pin 10-90 ngày
- Camera WiFi: Pin lâu, 4K, lưu cloud
- Máy dò: Phát hiện định vị/quay lén/nghe lén, dùng cho chủ xe / doanh nhân / pháp lý
- Máy ghi âm: Pin 30h, nhỏ, ghi 1 chạm, lưu 500h
- Định vị: Không dây, mini, real-time, chính xác 5m, pin 20 ngày
- Chống ghi âm: Nhiễu sóng, phòng VIP, bảo mật doanh nghiệp
- NOMA: Chuẩn Mỹ, DIY tại nhà, HSD 3 năm

7 công thức copywriting cho headline ads: AIDA, FAB, PAS, BAB, Hook-Value-CTA, 4Cs, SLAP

6 nhóm chấm điểm (100đ):
1. Số lượng & Độ phủ — 15%
2. Công thức copywriting — 20%
3. USP rõ ràng — 20%
4. CTA + Trust — 15%
5. Tránh cliché — 15%
6. Chính tả + Ad Strength — 15%

5 cơ chế đề xuất headline:
1. REPLICATE WINNER: CTR >5% → 5 biến thể giữ format
2. REPLACE LOSER: CTR <0.5% → brief với hypothesis
3. FILL FORMULA GAP: thiếu PAS/Hook/BAB → sinh lấp
4. USP-DRIVEN: USP chưa có headline → sinh
5. SEASONAL

Cliché TUYỆT ĐỐI tránh: "tốt nhất", "rẻ nhất", "số 1", "uy tín #1", "cam kết hoàn tiền 100%", "click ngay"`,
};

const MODE_CONFIG = {
  audit_account:    { skills: ["parent"], data: ["context", "spend", "revenue", "inventory"], model: MODEL_BIG },
  audit_keyword:    { skills: ["keyword"], data: ["context", "search_terms", "spend", "inventory"], model: MODEL_BIG },
  audit_gdn:        { skills: ["gdn"], data: ["context", "ads", "placement", "spend", "inventory"], model: MODEL_BIG },
  audit_headline:   { skills: ["headline"], data: ["ads", "context", "inventory"], model: MODEL_BIG },
  suggest_keyword:  { skills: ["keyword"], data: ["search_terms", "context", "inventory"], model: MODEL_BIG },
  suggest_headline: { skills: ["headline"], data: ["ads", "context", "inventory"], model: MODEL_BIG },
  suggest_banner:   { skills: ["gdn"], data: ["ads", "placement", "inventory"], model: MODEL_BIG },
  ask:              { skills: ["parent", "keyword", "gdn", "headline"], data: ["context", "spend", "revenue", "inventory"], model: MODEL_FAST },
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

async function fetchJson(origin, path, cookieHeader) {
  try {
    const r = await fetch(new URL(path, origin).toString(), { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchInventoryCompact(env) {
  try {
    const list = await env.INVENTORY.list({ limit: 1000 });
    const items = [];
    const sample = list.keys.slice(0, 100);  // Giảm từ 300 → 100
    await Promise.all(sample.map(async (k) => {
      try {
        const v = await env.INVENTORY.get(k.name, { type: "json" });
        if (v && v.gia_nhap_vnd > 0) {
          items.push({ code: k.name.slice(0, 50), cost: v.gia_nhap_vnd, price: v.gia_ban_vnd, status: v.trang_thai });
        }
      } catch {}
    }));
    return items;
  } catch { return []; }
}

function compactSearchTerms(j, topN = 30) {
  if (!j || !j.term_aggregates) return null;
  const arr = Object.entries(j.term_aggregates)
    .map(([term, s]) => ({ term, clicks: s.clicks_30d, conv: s.conversions_30d, cpc: s.cpc_30d, ctr: s.ctr_30d }))
    .sort((a, b) => (b.conv * 1000 + b.clicks) - (a.conv * 1000 + a.clicks))
    .slice(0, topN);
  return { date_range: j.date_range, top: arr, total: j.unique_search_terms };
}

function compactRevenue(j) {
  if (!j) return null;
  return {
    window_days: j.window_days,
    total_orders: j.total_orders,
    summary: j.summary,
    category_breakdown: j.category_breakdown_by_period?.last_30d || j.category_breakdown_by_period?.this_month,
  };
}

function compactSpend(j) {
  if (!j) return null;
  return {
    date_range: j.date_range,
    total_spend: j.total_spend,
    by_category: j.by_category,
  };
}

function compactAds(j, topN = 15) {
  if (!j) return null;
  return { date_range: j.date_range, total: (j.ads || []).length, sample: (j.ads || []).slice(0, topN) };
}

function compactPlacement(j, topN = 15) {
  if (!j) return null;
  const list = (j.placements || []).sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, topN);
  return { date_range: j.date_range, top_spend: list };
}

function buildSystemPrompt(skills) {
  return [
    "Bạn là chuyên gia phân tích Google Ads cho Doscom Holdings.",
    "Trả lời 100% TIẾNG VIỆT có dấu, dùng dấu phẩy ngàn cho số tiền (vd 1,250,000đ).",
    "Phong cách: thẳng thắn, có bảng so sánh, ngắn gọn, không lan man.",
    "Mọi số liệu DỰA TRÊN DATA cụ thể trong context — KHÔNG bịa.",
    "Nếu thiếu data → ghi rõ 'Thiếu dữ liệu'.",
    "Mỗi action đề xuất phải có: cụ thể (làm gì), đo được (đ tiết kiệm), ưu tiên.",
    "",
    "═══ RULE & SKILL ═══",
    skills.join("\n\n"),
  ].join("\n");
}

function buildUserPrompt(mode, question, dataContext) {
  const parts = [`MODE: ${mode}`];
  if (question) parts.push(`USER QUESTION: ${question}`);
  parts.push("");
  parts.push("═══ DATA CONTEXT ═══");
  parts.push(JSON.stringify(dataContext, null, 1));
  parts.push("");
  parts.push("═══ OUTPUT FORMAT ═══");
  switch (mode) {
    case "audit_account":
      parts.push("Output markdown:\n# Audit Tài khoản Google Ads\n## Tổng điểm: XX/100 — Loại: A/B/C/D/F\n## Tóm tắt 1 dòng\n## Top 5 Quick Win (cụ thể, đ tiết kiệm)\n## Cảnh báo nguy hiểm\n## Phân tích 8 nhóm chấm điểm");
      break;
    case "audit_keyword":
      parts.push("Output:\n# Audit Từ khoá\n## Phân bậc Tier 1/2/3 (số kw, % chi)\n## Top 10 từ khoá lỗ (CPA > trần)\n## Top 10 search term ngon chưa phải kw (HARVEST candidates)\n## Top 5 Quick Win");
      break;
    case "audit_gdn":
      parts.push("Output:\n# Audit GDN/PMax\n## Tổng điểm 6 nhóm\n## Asset disapproved\n## Placement lãng phí\n## Top 5 Quick Win");
      break;
    case "audit_headline":
      parts.push("Output:\n# Audit Headline\n## Tổng điểm 6 nhóm\n## Headline rate Thấp + cliché\n## USP chưa có headline đề cập\n## Top 5 Quick Win");
      break;
    case "suggest_keyword":
      parts.push("Output:\n# 15 đề xuất từ khoá MỚI\n| # | Cơ chế | Action | Ad Group | Keyword mới | Match | Bid | Lý do | Tăng đơn dự kiến |");
      break;
    case "suggest_headline":
      parts.push("Output:\n# 10 brief headline mới\nMỗi brief: ký tự count, công thức (AIDA/FAB/...), USP nhắc, hypothesis, test plan");
      break;
    case "suggest_banner":
      parts.push("Output:\n# 5-7 brief banner mới\nMỗi brief: size, layout vùng, color hex, copy, CTA, hypothesis, cost dựng (AI 80K vs designer 300K)");
      break;
    case "ask":
      parts.push("Trả lời ngắn gọn, có dẫn chứng từ data + skill rule.");
      break;
  }
  return parts.join("\n");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.AI) return jsonResponse({ error: "Thiếu Workers AI binding" }, 500);

  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Chưa đăng nhập" }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Body không hợp lệ" }, 400); }

  const mode = body.mode || "ask";
  const question = (body.question || "").trim();
  const userContext = body.context || {};

  const cfg = MODE_CONFIG[mode];
  if (!cfg) return jsonResponse({ error: `Mode không hỗ trợ: ${mode}` }, 400);
  if (mode === "ask" && !question) return jsonResponse({ error: "Mode 'ask' cần question" }, 400);

  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = url.origin;

  // Skill summary (compact)
  const skills = cfg.skills.map(k => SKILL_SUMMARY[k]).filter(Boolean);

  // Data context
  const dataContext = { mode, user_context: userContext };
  const tasks = [];
  if (cfg.data.includes("context")) tasks.push(fetchJson(origin, "/data/google-ads-context.json", cookieHeader).then(j => { if (j) dataContext.context = { date_range: j.date_range, total_campaigns: (j.campaigns_raw||[]).length }; }));
  if (cfg.data.includes("spend")) tasks.push(fetchJson(origin, "/data/google-ads-spend.json", cookieHeader).then(j => dataContext.spend = compactSpend(j)));
  if (cfg.data.includes("revenue")) tasks.push(fetchJson(origin, "/data/product-revenue.json", cookieHeader).then(j => dataContext.revenue = compactRevenue(j)));
  if (cfg.data.includes("search_terms")) tasks.push(fetchJson(origin, "/data/google-ads-search-terms.json", cookieHeader).then(j => dataContext.search_terms = compactSearchTerms(j, 30)));
  if (cfg.data.includes("ads")) tasks.push(fetchJson(origin, "/data/google-ads-ads.json", cookieHeader).then(j => dataContext.ads = compactAds(j, 15)));
  if (cfg.data.includes("placement")) tasks.push(fetchJson(origin, "/data/google-ads-placement.json", cookieHeader).then(j => dataContext.placement = compactPlacement(j, 15)));
  if (cfg.data.includes("inventory") && env.INVENTORY) tasks.push(fetchInventoryCompact(env).then(items => dataContext.inventory = items));

  await Promise.all(tasks);

  const systemPrompt = buildSystemPrompt(skills);
  const userPrompt = buildUserPrompt(mode, question, dataContext);

  let aiResult;
  try {
    aiResult = await env.AI.run(cfg.model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 3072,
    });
  } catch (e) {
    return jsonResponse({ error: "Lỗi gọi Workers AI: " + e.message }, 502);
  }

  return jsonResponse({
    ok: true,
    mode,
    model: cfg.model,
    response: aiResult.response || aiResult.result || "",
    skills_used: cfg.skills,
    data_used: cfg.data,
  });
}

// API Agent Google Ads AI v3 — Cloudflare Workers AI + Filter theo nhóm SP
// Endpoint: POST /api/agent-google-ai
// Body: {
//   mode,
//   question?,
//   context?: { product_group?: "ALL"|"CAMERA_WIFI"|"CAMERA_4G"|"CAMERA_VIDEO_CALL"|"MAY_DO"|"GHI_AM"|"DINH_VI"|"CHONG_GHI_AM"|"NOMA" }
// }

import { verifySession } from "../_middleware.js";

const SESSION_COOKIE = "doscom_session";
const MODEL_FAST = "@cf/meta/llama-3.1-8b-instruct-fast";
const MODEL_BIG = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const GROUP_LABELS = {
  ALL: "Tất cả 8 nhóm SP",
  CAMERA_VIDEO_CALL: "Camera video call (DA8.1)",
  CAMERA_4G: "Camera 4G",
  CAMERA_WIFI: "Camera WiFi",
  MAY_DO: "Máy dò",
  GHI_AM: "Máy ghi âm",
  DINH_VI: "Định vị",
  CHONG_GHI_AM: "Chống ghi âm",
  NOMA: "NOMA (chăm sóc xe)",
};

// Classify SP code (KV inventory) → group
function classifyByName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "OTHER";
  if (/noma|a002|khăn/.test(n)) return "NOMA";
  if (/^da\s*8\.1/.test(n)) return "CAMERA_VIDEO_CALL";
  if (/^da\d/.test(n)) {
    if (/4g|sim|nlmt|năng lượng/.test(n)) return "CAMERA_4G";
    const g4 = ["da1 pro 4g","da1 zoomx6","da1 pro","da2","da3 pro 4g","da5.1","da6","da6.1","da6.2"];
    for (const c of g4) if (n.startsWith(c)) return "CAMERA_4G";
    return "CAMERA_WIFI";
  }
  if (/^dr\d/.test(n)) return "GHI_AM";
  if (/^di\d/.test(n)) return "CHONG_GHI_AM";
  if (/^dv\d|^dt\d/.test(n)) return "DINH_VI";
  if (/^d\d/.test(n)) return "MAY_DO";
  return "OTHER";
}

// Classify search term theo intent
const ST_PATTERNS = {
  CAMERA_VIDEO_CALL: /(gọi.*2.*chiều|video.*call|trò chuyện|ông.*bà|nhìn.*con|gọi điện 2)/i,
  CAMERA_4G: /(không.*wifi|không cần wifi|năng lượng mặt trời|nlmt|4g|sim|ngoài trời)/i,
  CAMERA_WIFI: /(camera.*wifi|cam.*nhà|camera.*phòng|camera ip|camera trong nhà)/i,
  MAY_DO: /(dò.*nghe lén|dò.*camera|máy dò|phát hiện thiết bị|dò.*sóng|dò.*định vị)/i,
  GHI_AM: /(máy.*ghi.*âm|ghi âm|recorder|thiết bị ghi)/i,
  DINH_VI: /(định vị|gps|theo dõi.*xe|theo dõi.*con|tracker)/i,
  CHONG_GHI_AM: /(chống.*ghi.*âm|nhiễu sóng|chống nghe lén|bảo mật.*họp)/i,
  NOMA: /(noma|chăm sóc.*xe|tẩy.*ố|tẩy.*kính|đèn pha|nhựa.*xe)/i,
};

function classifySearchTerm(term) {
  const t = String(term || "").toLowerCase();
  for (const [g, pat] of Object.entries(ST_PATTERNS)) {
    if (pat.test(t)) return g;
  }
  return "OTHER";
}

// Skill summary compact
const SKILL_SUMMARY = {
  parent: `# DOSCOM GOOGLE ADS — TỔNG QUAN
Mục tiêu: Lợi nhuận ≥30% (KHÔNG dùng ROAS)
Profit = Doanh thu − VAT 10% − Giá vốn − Chi phí QC
Trần CPA Search = 0.6 × Bán − Vốn − VAT
Trần CPA Display = 0.5 × Bán − Vốn − VAT
8 nhóm chấm điểm: Tracking 25% · Profit/SP 22% · Lãng phí 13% · RSA 12% · Cấu trúc kw 10% · Trang đích 8% · Budget 5% · Compliance 5%
Loại: 85+=A, 70-84=B, 55-69=C, 40-54=D, <40=F`,

  keyword: `# KEYWORD AUDIT + SUGGEST
Tier 1 Cốt lõi (KHÔNG pause): máy dò nghe lén, camera giấu, ghi âm, định vị, NOMA
Tier 2 Kế cận: liên quan nhưng không chính
Tier 3 Không liên quan: pause mạnh
Cổng kiểm định: số đơn dự kiến < 3 → KHÔNG pause
7 nhóm chấm điểm: QS 20% · Match 15% · CVR/CPA 20% · Cấu trúc 15% · Brand 10% · Cannibalization 10% · ST Health 10%
5 cơ chế suggest: HARVEST, REPLACE DYING, LONG-TAIL, COMPETITOR FLAG, SEASONAL`,

  gdn: `# GDN/PMAX AUDIT + SUGGEST BANNER
Trần CPA Display chặt 0.5x
6 nhóm: Asset 25% · PMax Rating 20% · Placement 20% · Targeting 15% · Measurement 10% · Cấu trúc 10%
5 cơ chế suggest banner: TOP PERFORMER REPLICATION, REPLACE LOSER (brief đầy đủ), FILL ASPECT RATIO GAP, A/B CHALLENGER, SEASONAL
Brief banner: size, layout vùng, color hex, copy, CTA, hypothesis, cost dựng (~80K AI / 300K designer)`,

  headline: `# HEADLINE AUDIT + SUGGEST
USP catalog 8 nhóm SP Doscom (USP cụ thể, không cliché)
- DA8.1 (video call): Gọi 2 chiều, ông bà bố mẹ, không smartphone, HD
- Camera 4G: Không wifi, không hồng ngoại, quay đêm, pin 10-90 ngày
- Camera WiFi: Pin lâu, 4K, lưu cloud
- Máy dò: Phát hiện định vị/quay lén/nghe lén
- Máy ghi âm: Pin 30h, nhỏ, ghi 1 chạm, lưu 500h
- Định vị: Không dây, mini, real-time, 5m, pin 20 ngày
- Chống ghi âm: Nhiễu sóng, phòng VIP
- NOMA: Chuẩn Mỹ, DIY, HSD 3 năm
7 công thức: AIDA, FAB, PAS, BAB, Hook-Value-CTA, 4Cs, SLAP
6 nhóm chấm điểm: Số lượng 15% · Công thức 20% · USP 20% · CTA+Trust 15% · Tránh cliché 15% · Chính tả+Strength 15%
5 cơ chế: REPLICATE WINNER, REPLACE LOSER, FILL FORMULA GAP, USP-DRIVEN, SEASONAL
Cliché TUYỆT ĐỐI tránh: "tốt nhất", "rẻ nhất", "số 1", "uy tín #1", "hoàn tiền 100%", "click ngay"`,
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
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function fetchJson(origin, path, cookieHeader) {
  try {
    const r = await fetch(new URL(path, origin).toString(), { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchInventoryCompact(env, group) {
  try {
    const list = await env.INVENTORY.list({ limit: 1000 });
    const items = [];
    await Promise.all(list.keys.slice(0, 200).map(async (k) => {
      try {
        const v = await env.INVENTORY.get(k.name, { type: "json" });
        if (v && v.gia_nhap_vnd > 0) {
          const g = classifyByName(k.name);
          if (group === "ALL" || g === group) {
            items.push({ code: k.name.slice(0, 60), group: g, cost: v.gia_nhap_vnd, price: v.gia_ban_vnd, status: v.trang_thai });
          }
        }
      } catch {}
    }));
    return items.slice(0, 80);
  } catch { return []; }
}

function compactSearchTerms(j, topN, group) {
  if (!j || !j.term_aggregates) return null;
  let arr = Object.entries(j.term_aggregates)
    .map(([term, s]) => ({ term, group: classifySearchTerm(term), clicks: s.clicks_30d, conv: s.conversions_30d, cpc: s.cpc_30d, ctr: s.ctr_30d, spend: s.spend_30d }));
  if (group !== "ALL") arr = arr.filter(x => x.group === group);
  arr = arr.sort((a, b) => (b.conv * 1000 + b.clicks) - (a.conv * 1000 + a.clicks)).slice(0, topN);
  return { date_range: j.date_range, group_filter: group, top: arr, total_in_group: arr.length };
}

function compactRevenue(j, group) {
  if (!j) return null;
  const cb = j.category_breakdown_by_period?.last_30d || j.category_breakdown_by_period?.this_month || {};
  if (group === "ALL") {
    return { window_days: j.window_days, total_orders: j.total_orders, summary: j.summary, all_categories: cb.categories };
  }
  return {
    window_days: j.window_days,
    group_filter: group,
    group_data: (cb.categories || {})[group] || { revenue: 0, orders: 0, units: 0 },
    total_revenue_all: cb.total_revenue,
  };
}

function compactSpend(j, group) {
  if (!j) return null;
  if (group === "ALL") return { date_range: j.date_range, total_spend: j.total_spend, by_category: j.by_category };
  const grpSpend = (j.by_category || {})[group] || { spend: 0, conversions: 0 };
  return { date_range: j.date_range, group_filter: group, group_spend: grpSpend, total_spend_all: j.total_spend };
}

function compactAds(j, topN, group) {
  if (!j) return null;
  let ads = j.ads || [];
  if (group !== "ALL") {
    ads = ads.filter(a => {
      const txt = (a.headlines || []).map(h => h.text || h).join(" ") + " " + (a.descriptions || []).map(d => d.text || d).join(" ");
      return classifyByName(txt) === group || classifySearchTerm(txt) === group;
    });
  }
  return { date_range: j.date_range, group_filter: group, total: ads.length, sample: ads.slice(0, topN) };
}

function compactPlacement(j, topN) {
  if (!j) return null;
  const list = (j.placements || []).sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, topN);
  return { date_range: j.date_range, top_spend: list };
}

function buildSystemPrompt(skills, group) {
  const groupNote = group !== "ALL" ? `\n\n⚠ FOCUS: Chỉ phân tích nhóm SP "${GROUP_LABELS[group]}". Bỏ qua các SP khác.` : "";
  return [
    "Bạn là chuyên gia phân tích Google Ads cho Doscom Holdings.",
    "Trả lời 100% TIẾNG VIỆT có dấu, dùng dấu phẩy ngàn cho số tiền (vd 1,250,000đ).",
    "Phong cách: thẳng thắn, có bảng so sánh, ngắn gọn, không lan man.",
    "Mọi số liệu DỰA TRÊN DATA cụ thể trong context — KHÔNG bịa.",
    "Nếu thiếu data → ghi rõ 'Thiếu dữ liệu'.",
    "Mỗi action đề xuất phải có: cụ thể (làm gì), đo được (đ tiết kiệm/tăng), ưu tiên (cao/trung/thấp).",
    groupNote,
    "",
    "═══ RULE & SKILL ═══",
    skills.join("\n\n"),
  ].join("\n");
}

function buildUserPrompt(mode, question, dataContext, group) {
  const parts = [`MODE: ${mode}`, `GROUP FILTER: ${GROUP_LABELS[group]}`];
  if (question) parts.push(`USER QUESTION: ${question}`);
  parts.push("");
  parts.push("═══ DATA CONTEXT ═══");
  parts.push(JSON.stringify(dataContext, null, 1));
  parts.push("");
  parts.push("═══ OUTPUT FORMAT (markdown) ═══");
  const groupSuffix = group !== "ALL" ? ` cho ${GROUP_LABELS[group]}` : "";
  switch (mode) {
    case "audit_account":
      parts.push(`# Audit Tổng quan${groupSuffix}\n## Tổng điểm /100 — Loại A-F\n## Tóm tắt 1 dòng\n## Top 5 Quick Win (cụ thể, đ tiết kiệm)\n## Cảnh báo nguy hiểm\n## Phân tích 8 nhóm chấm điểm`);
      break;
    case "audit_keyword":
      parts.push(`# Audit Từ khoá${groupSuffix}\n## Phân bậc Tier 1/2/3 (số kw, % chi)\n## Top 10 từ khoá lỗ\n## Top 10 search term ngon (HARVEST candidates)\n## Top 5 Quick Win`);
      break;
    case "audit_gdn":
      parts.push(`# Audit GDN/PMax${groupSuffix}\n## Tổng điểm 6 nhóm\n## Asset disapproved\n## Placement lãng phí\n## Top 5 Quick Win`);
      break;
    case "audit_headline":
      parts.push(`# Audit Headline${groupSuffix}\n## Tổng điểm 6 nhóm\n## Headline rate Thấp + cliché\n## USP chưa cover\n## Top 5 Quick Win`);
      break;
    case "suggest_keyword":
      parts.push(`# Đề xuất Từ khoá MỚI${groupSuffix}\nBảng 15 đề xuất: | # | Cơ chế | Action | Ad Group | Keyword mới | Match | Bid | Lý do | Tăng đơn dự kiến |`);
      break;
    case "suggest_headline":
      parts.push(`# Brief Headline${groupSuffix}\n10 brief với: ký tự count, công thức (AIDA/FAB/PAS), USP nhắc, hypothesis, test plan`);
      break;
    case "suggest_banner":
      parts.push(`# Brief Banner${groupSuffix}\n5-7 brief: size, layout vùng, color hex, copy, CTA, hypothesis, cost (AI 80K vs designer 300K)`);
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
  const group = (userContext.product_group || "ALL").toUpperCase();

  if (!GROUP_LABELS[group]) return jsonResponse({ error: `Nhóm SP không hợp lệ: ${group}` }, 400);

  const cfg = MODE_CONFIG[mode];
  if (!cfg) return jsonResponse({ error: `Mode không hỗ trợ: ${mode}` }, 400);
  if (mode === "ask" && !question) return jsonResponse({ error: "Mode 'ask' cần question" }, 400);

  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = url.origin;

  const skills = cfg.skills.map(k => SKILL_SUMMARY[k]).filter(Boolean);

  const dataContext = { mode, group_filter: group, group_label: GROUP_LABELS[group] };
  const tasks = [];
  if (cfg.data.includes("context")) tasks.push(fetchJson(origin, "/data/google-ads-context.json", cookieHeader).then(j => { if (j) dataContext.context = { date_range: j.date_range, total_campaigns: (j.campaigns_raw || []).length }; }));
  if (cfg.data.includes("spend")) tasks.push(fetchJson(origin, "/data/google-ads-spend.json", cookieHeader).then(j => dataContext.spend = compactSpend(j, group)));
  if (cfg.data.includes("revenue")) tasks.push(fetchJson(origin, "/data/product-revenue.json", cookieHeader).then(j => dataContext.revenue = compactRevenue(j, group)));
  if (cfg.data.includes("search_terms")) tasks.push(fetchJson(origin, "/data/google-ads-search-terms.json", cookieHeader).then(j => dataContext.search_terms = compactSearchTerms(j, 30, group)));
  if (cfg.data.includes("ads")) tasks.push(fetchJson(origin, "/data/google-ads-ads.json", cookieHeader).then(j => dataContext.ads = compactAds(j, 15, group)));
  if (cfg.data.includes("placement")) tasks.push(fetchJson(origin, "/data/google-ads-placement.json", cookieHeader).then(j => dataContext.placement = compactPlacement(j, 15)));
  if (cfg.data.includes("inventory") && env.INVENTORY) tasks.push(fetchInventoryCompact(env, group).then(items => dataContext.inventory = items));

  await Promise.all(tasks);

  const systemPrompt = buildSystemPrompt(skills, group);
  const userPrompt = buildUserPrompt(mode, question, dataContext, group);

  let aiResult;
  try {
    aiResult = await env.AI.run(cfg.model, {
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.3,
      max_tokens: 3072,
    });
  } catch (e) {
    return jsonResponse({ error: "Lỗi gọi Workers AI: " + e.message }, 502);
  }

  return jsonResponse({
    ok: true,
    mode,
    group,
    group_label: GROUP_LABELS[group],
    model: cfg.model,
    response: aiResult.response || aiResult.result || "",
    skills_used: cfg.skills,
    data_used: cfg.data,
  });
}

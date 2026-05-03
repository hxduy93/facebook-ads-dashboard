// API Agent FB Ads AI v1 — Cloudflare Workers AI + filter qua DUY+PHƯƠNG NAM
// Endpoint: POST /api/agent-fb-ai
// Body: {
//   mode: "audit_account_json" | "audit_account" | "audit_funnel" | "analyze_metrics" | "ask",
//   group?: "ALL" | "MAY_DO" | "CAMERA_VIDEO_CALL" | "GHI_AM" | "NOMA",
//   question?: string,
//   force_refresh?: boolean
// }

import { verifySession, hasTestBypass } from "../_middleware.js";
import {
  FB_GROUP_LABELS,
  FB_ACTIVE_GROUPS,
  compactFbInsights,
  compactFbOrders,
  computeFbProfit,
  compactFbDailyTrend,
  resolveTimeRange,
  compactFbOrdersInRange,
  computeFbProfitInRange,
  compactFbAccounts,
  compactFbCampaigns,
} from "../lib/fbAdsHelpers.js";

const SESSION_COOKIE = "doscom_session";
const MODEL_FAST = "@cf/meta/llama-3.1-8b-instruct-fast";       // light, weak, ~30-100 neurons
const MODEL_BIG  = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";   // structured output reliable, ~500-1500 neurons
const MODEL_CLAUDE_HAIKU = "anthropic/claude-haiku-4-5";        // best quality, billed per token (cần Workers Paid + AI Models marketplace)

// Map model_pref string → actual model id
// Default 70B cho tất cả mode quan trọng. 8B chỉ dùng làm fallback nếu 70B fail.
const MODEL_MAP = {
  big: MODEL_BIG,                 // default + recommend
  fast: MODEL_FAST,               // chỉ làm fallback
  claude_haiku: MODEL_CLAUDE_HAIKU,
};

const CACHE_VERSION = "v5";  // bumped: stronger scale prompt + 70B default
const CACHE_TTL_SECONDS = 21600;  // 6h cho mode analyze (FB data ít cập nhật)

const SUGGEST_MODES = new Set([]);  // không có suggest mode trong v1

// MODE config — default 70B cho mọi mode (chất lượng tốt). 8B chỉ làm fallback.
const MODE_CONFIG = {
  audit_account_json:  { skills: ["fb_overview"], data: ["insights", "orders", "profit"], json_output: true, model_pref: "big" },
  audit_account:       { skills: ["fb_overview"], data: ["insights", "orders", "profit", "trend"], model_pref: "big" },
  audit_funnel:        { skills: ["fb_funnel"],   data: ["insights", "orders", "trend"], model_pref: "big" },
  analyze_metrics:     { skills: ["fb_overview"], data: ["insights", "trend"], model_pref: "big" },
  optimize_campaign:   { skills: ["fb_overview", "fb_optimize"], data: ["insights", "orders", "profit"], json_output: true, model_pref: "big" },
  ask:                 { skills: ["fb_overview", "fb_funnel"], data: ["insights", "orders", "profit", "trend"], model_pref: "big" },
};

// Skill summary compact (Vietnamese)
const SKILL_SUMMARY = {
  fb_overview: `# FB ADS AUDIT — DOSCOM
Doscom chạy FB Ads cho 4 nhóm SP (DUY + PHƯƠNG NAM chốt đơn):
- MAY_DO: D1 chính (152 đơn 90d), AOV 2.5M, margin 33.9% ⭐
- CAMERA_VIDEO_CALL: DA8.1 (222 đơn), AOV 1.07M, margin 18.3% ⚠
- GHI_AM: DR1 (108 đơn), AOV 1.26M, margin 11% 🔴 (margin yếu, cần audit gấp)
- NOMA: 911+922 (2,971 đơn), AOV 216K, margin 31% ✅ (volume play)

Track event = complete_registrations (lead form). Lead → Pancake CRM → DUY/PN chốt → POSPancake order.
Cost ratio target: Spend / Revenue ≤ 40% (= ROAS ≥ 2.5x).
Lead close rate trung bình: 65%.

8 nhóm chấm điểm:
1. Tracking 15% — pixel + lead form working, leads count khớp Pancake?
2. Creative 20% — CTR, frequency, hook quality
3. Audience 15% — demographics targeting hiệu quả
4. Cost ratio 20% — Spend/Revenue ≤ 40%
5. Profit/SP 15% — margin theo từng nhóm SP
6. Funnel 10% — Lead → Pancake order rate
7. Frequency 5% — frequency < 4
8. Compliance 5% — disapprovals, account quality`,

  fb_funnel: `# FB ADS FUNNEL
Funnel Doscom:
  Impression → Click → Lead form → Pancake CRM → Sales chốt → POSPancake order

Mỗi step có drop rate. Sales DUY + PHƯƠNG NAM convert lead → đơn với rate ~65% (trung bình).
Cần check:
- Lead → order rate per nhóm SP (NOMA cao? MAY_DO thấp?)
- Time-to-order (median ngày)
- Lead chất lượng theo audience/campaign
- Phone capture rate (form fail?)`,

  fb_optimize: `# FB ADS CAMPAIGN OPTIMIZATION — DOSCOM SCALE FRAMEWORK

Bạn là FB Ads Strategist 8 năm tại agency US. Phân tích campaign + đưa ra scale recommendation CỤ THỂ với số liệu.

═══ DOSCOM CONTEXT ═══
- 4 nhóm SP active (DUY+PHƯƠNG NAM chốt qua Pancake):
  • MAY_DO: AOV 2.5M, CPL target 655K, margin 33.9% ⭐ (winner)
  • CAMERA_VIDEO_CALL (DA8.1): AOV 1.07M, CPL target 279K, margin 18.3% ⚠
  • GHI_AM (DR1): AOV 1.26M, CPL target 328K, margin 11% 🔴 (margin yếu)
  • NOMA: AOV 216K, CPL target 56K, margin 31% (volume play, 30+ đơn/ngày)
- Cost ratio target: spend/revenue ≤ 40%
- Lead close rate: 65%

═══ 5 EVALUATION DIMENSIONS (mỗi cái 1-10 score) ═══

1. **SPEND EFFICIENCY** (CPA quality):
   - Score 9-10: CPA ≤ 50% target → cực ngon, scale aggressive
   - Score 7-8: CPA 50-80% target → tốt, scale moderate
   - Score 5-6: CPA 80-120% target → OK, giữ hoặc optimize creative
   - Score 3-4: CPA 120-200% target → cảnh báo, cắt bid
   - Score 1-2: CPA > 2x target → pause

2. **VOLUME** (conversions/day so với benchmark):
   - 9-10: > 2x benchmark
   - 7-8: 1.2-2x benchmark
   - 5-6: 0.7-1.2x benchmark (đúng kỳ vọng)
   - 3-4: 0.3-0.7x → volume yếu
   - 1-2: < 0.3x → almost dead

3. **CTR QUALITY**:
   - 9-10: CTR > 3%
   - 7-8: CTR 2-3% (chuẩn FB)
   - 5-6: CTR 1.5-2%
   - 3-4: CTR 1-1.5%
   - 1-2: CTR < 1% → hook yếu

4. **FREQUENCY** (saturation):
   - 9-10: < 1.5 (mới, chưa saturate)
   - 7-8: 1.5-2.5 (healthy)
   - 5-6: 2.5-3.5 (đang saturate)
   - 3-4: 3.5-4.5 (cần refresh creative)
   - 1-2: > 4.5 (saturate hoàn toàn)

5. **TREND**: so spend/conv 7d trước (nếu có data trend), hoặc trend trong time range:
   - Stable + scaling: 8-10
   - Stable performance: 6-7
   - Slight decline: 4-5
   - Sharp decline: 1-3

═══ VERDICT DECISION TREE (BẮT BUỘC theo logic này) ═══

**SCALE** (verdict_color: "green"):
- Điều kiện: AVG score ≥ 7.5 AND CPA < 70% target AND CTR ≥ 2% AND frequency < 3
- Action: Tăng budget +20% đến +50% theo độ stable
- WHAT cụ thể: "Tăng daily budget từ X → Y (+Z%) trong 3 ngày, monitor CPA"
- Risk: low

**SCALE_CAREFUL** (verdict: "SCALE", color: "yellow"):
- Điều kiện: AVG score 6-7.5 AND CPA < 90% target AND có volume
- Action: Tăng budget +10-15% (chậm), test trước khi tăng tiếp
- Risk: medium

**KEEP** (verdict_color: "green" or "yellow"):
- Điều kiện: AVG score 5-7, performance OK, CPA gần target
- Action: "Giữ nguyên budget, theo dõi 3-5 ngày tiếp"
- Risk: low

**REFRESH** (verdict_color: "yellow"):
- Điều kiện: Frequency > 3.5 OR CTR giảm > 25% so trend
- Action: "Đổi 2-3 creative mới (hook khác, hình mới), giữ targeting"
- Risk: medium

**AUDIENCE_FIX** (verdict: "AUDIENCE", color: "yellow"):
- Điều kiện: CTR < 1% AND frequency < 2 AND volume thấp
- Action: "Audience sai target. Test LAL từ buyer 30d gần nhất, hoặc thêm interest cụ thể"
- Risk: medium

**PAUSE** (verdict_color: "red"):
- Điều kiện: CPA > 2x target AND spend > 200K AND conversions = 0
  HOẶC trend giảm sâu + CPA tăng 50%+
- Action: "Pause ngay, audit creative + audience trước khi reactivate"
- Risk: low (lose audience nhỏ vs bleeding tiền)

═══ FORMAT OUTPUT (JSON BẮT BUỘC) ═══

{
  "verdict": "SCALE" | "KEEP" | "REFRESH" | "AUDIENCE" | "PAUSE",
  "verdict_color": "green" | "yellow" | "red",
  "summary": "2-3 câu có 4 con số: spend, conversions, CPA, CTR — và verdict reason ngắn gọn",
  "performance": {
    "spend_vnd": <int>,
    "conversions": <int>,
    "cpa_vnd": <int_or_null>,
    "ctr_pct": <float>,
    "rating_overall": <1-10 - average của 4 evaluation scores>
  },
  "evaluation": {
    "spend_efficiency": {"score": 1-10, "note": "CPA X = Y% target Z (group)"},
    "volume":           {"score": 1-10, "note": "conversions/day = N, benchmark cho group là M"},
    "ctr_quality":      {"score": 1-10, "note": "CTR X% — chuẩn FB là 2-3%"},
    "trend":            {"score": 1-10, "note": "trend stable/up/down theo time range"}
  },
  "action": {
    "what": "1 dòng hướng dẫn CỤ THỂ với SỐ TIỀN/% (vd 'Tăng daily budget từ 500K → 600K (+20%)')",
    "why": "Lý do dựa trên SCORES + thresholds (vd 'AVG score 8.5, CPA chỉ 45% target → có dư cap budget')",
    "impact_expected": "Số liệu dự kiến (vd '+5-8 conversions/ngày, +250K profit/ngày')",
    "risk": "low" | "medium" | "high",
    "risk_note": "Risk cụ thể (vd 'CPA có thể tăng nhẹ 10-20%, monitor trong 3 ngày')"
  },
  "next_check": {
    "after_days": <SCALE: 3, KEEP: 7, REFRESH/AUDIENCE: 5, PAUSE: 1>,
    "metric_to_watch": "metric chính cần check (vd 'CPA + conversions/day')",
    "threshold_revert": "Khi nào revert (vd 'Nếu CPA > 350K trong 3 ngày → revert budget cũ')"
  },
  "warnings": []
}`,
};

const GROUPS = ["ALL", ...FB_ACTIVE_GROUPS];

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
    const r = await fetch(new URL(path, origin).toString(), {
      headers: { Cookie: cookieHeader || "" },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function buildSystemPrompt(skills, group, jsonOutput) {
  const skillBlocks = skills.map(s => SKILL_SUMMARY[s]).filter(Boolean).join("\n\n");
  const formatNote = jsonOutput
    ? "\n🚨 OUTPUT BẮT BUỘC: 1 JSON object hợp lệ. Bắt đầu bằng { kết thúc bằng }. KHÔNG markdown, KHÔNG heading, KHÔNG text bao quanh."
    : "\nOutput markdown, heading H1/H2/H3 + bullet points. Tiếng Việt.";
  return `Bạn là Sarah — Senior FB Ads Auditor 8 năm tại agency US, chuyên audit account Việt Nam. Phân tích kỹ, có số liệu cụ thể, không chung chung.

═══ SKILLS DOSCOM ═══
${skillBlocks}

${formatNote}`;
}

function buildUserPrompt(mode, question, dataContext, group) {
  const groupLabel = FB_GROUP_LABELS[group] || "Tất cả";
  const parts = [`MODE: ${mode}`, `GROUP: ${groupLabel} (${group})`];
  if (question) parts.push(`QUESTION: ${question}`);
  parts.push("");
  parts.push("═══ DATA ═══");
  parts.push(JSON.stringify(dataContext, null, 1));
  parts.push("");
  parts.push("═══ OUTPUT FORMAT ═══");

  switch (mode) {
    case "audit_account_json":
      parts.push(`🚨 OUTPUT 1 JSON object với 8 nhóm chấm điểm:

{
  "total_score": 1-100,
  "grade": "A"|"B"|"C"|"D"|"F",
  "summary": "2-3 câu có ít nhất 3 con số cụ thể (revenue, orders, margin, cost ratio)",
  "breakdown": {
    "tracking":    {"score":1-100, "weight":15, "note":"... (có số leads, conv match)"},
    "creative":    {"score":1-100, "weight":20, "note":"... (CTR, frequency, hook quality)"},
    "audience":    {"score":1-100, "weight":15, "note":"... (geo/demo/lookalike)"},
    "cost_ratio":  {"score":1-100, "weight":20, "note":"... (spend/revenue %, target 40%)"},
    "profit":      {"score":1-100, "weight":15, "note":"... (margin per group)"},
    "funnel":      {"score":1-100, "weight":10, "note":"... (lead→order rate)"},
    "frequency":   {"score":1-100, "weight":5,  "note":"... (frequency value)"},
    "compliance":  {"score":1-100, "weight":5,  "note":"... (disapproval, quality)"}
  },
  "top_findings": [
    "Finding 1: action + số tiền cụ thể",
    "Finding 2: ...",
    "Finding 3: ..."
  ]
}

Quy tắc:
- summary phải có ít nhất 3 con số
- mỗi note ≥ 8 từ, có số liệu cụ thể
- top_findings: 3 action có thể làm được ngay, có số liệu
- total_score = round(sum(score×weight)/100)
- Grade: 85+=A, 70-84=B, 55-69=C, 40-54=D, <40=F
- KHÔNG để score=0 hay score giống nhau ≥4 nhóm. Nếu thiếu data thật sự → score=35 + note "Thiếu data X"
- Nếu fb_insights.has_data=false → tracking score = 30 + note "fb-ads-data.json đang rỗng, workflow auto-sync có thể lỗi"`);
      break;

    case "audit_account":
      parts.push(`# Audit FB Ads — ${groupLabel}

Output markdown với cấu trúc:
## Tổng điểm /100 + Grade
## Tóm tắt 1 dòng
## Top 5 Quick Win (có số tiền)
## Cảnh báo nguy hiểm
## Phân tích theo nhóm SP (4 nhóm Doscom)
## Trend tuần này vs tuần trước

Quy tắc: số liệu cụ thể, action rõ ràng, không vague.`);
      break;

    case "audit_funnel":
      parts.push(`# Audit Funnel FB Ads

## 1. Tổng quan funnel
- Impression → Click → Lead → Pancake order, mỗi step drop bao nhiêu?

## 2. Lead → Order rate per nhóm
- 4 nhóm Doscom (MAY_DO, DA8.1, GHI_AM, NOMA), close rate khác nhau ra sao?

## 3. Time-to-order
- Median ngày từ lead → đơn (per group)

## 4. Bottleneck phát hiện
- Step nào drop > 50% là bottleneck

## 5. 3 actions cải thiện funnel
- Cụ thể, có số liệu tham chiếu`);
      break;

    case "analyze_metrics":
      parts.push(`# Phân tích chỉ số FB Ads

## 1. Sức khoẻ tổng quan
- Total spend, leads, orders, revenue, margin (90d)

## 2. Trend tuần này vs tuần trước
- WoW orders %, WoW revenue %

## 3. Top 3 cảnh báo
- Nhóm nào margin yếu, nhóm nào volume tăng/giảm

## 4. 5 Action items cụ thể
- Mỗi action có WHAT/WHY/IMPACT`);
      break;

    case "optimize_campaign":
      parts.push(`🚨 OUTPUT 1 JSON object hợp lệ. Bắt đầu bằng { kết thúc bằng }. KHÔNG markdown.

Phân tích campaign trong fb_focus_campaign + so sánh với context (fb_profit margin per group, time range).

Verdict choice (chọn 1):
- "SCALE": CPA tốt (< 60% benchmark) + spend stable + conversions ổn → tăng budget
- "KEEP": Performance OK, không cần thay đổi
- "REFRESH": Frequency cao (>4) hoặc CTR giảm → cần creative mới
- "AUDIENCE": CTR thấp (<1%) + frequency thấp → audience sai
- "PAUSE": CPA cao (>2x benchmark) + spend > 200K + 0 conversions

Schema bắt buộc:
{
  "verdict": "SCALE" | "KEEP" | "REFRESH" | "AUDIENCE" | "PAUSE",
  "verdict_color": "green" | "yellow" | "red",
  "summary": "2-3 câu tóm tắt có 3 con số cụ thể (spend, conversions, CPA)",
  "performance": {
    "spend_vnd": <number>,
    "conversions": <number>,
    "cpa_vnd": <number_or_null>,
    "ctr_pct": <number>,
    "rating_overall": 1-10
  },
  "evaluation": {
    "spend_efficiency": {"score": 1-10, "note": "vd 'CPA 270K vs benchmark 655K = 41%'"},
    "volume":          {"score": 1-10, "note": "vd 'leads/day = 5, benchmark 2-3'"},
    "ctr_quality":     {"score": 1-10, "note": "vd 'CTR 1.39%, dưới benchmark 2%'"},
    "trend":           {"score": 1-10, "note": "vd 'Spend tăng 20% tuần trước, conv stable'"}
  },
  "action": {
    "what": "Vd 'Tăng daily budget từ 500K → 600K (+20%)'",
    "why": "Vd 'CPA chỉ 41% target, ROAS positive, có dư cap budget'",
    "impact_expected": "Vd '+10 conversions/ngày, total +250K profit/ngày'",
    "risk": "low" | "medium" | "high",
    "risk_note": "Vd 'Scale chậm, theo dõi CPA, nếu tăng > 50% thì revert'"
  },
  "next_check": {
    "after_days": <1-14>,
    "metric_to_watch": "Vd 'CPA + conversions/day'",
    "threshold_revert": "Vd 'Nếu CPA > 350K thì revert budget cũ'"
  },
  "warnings": ["string"]  // có thể empty []
}

Quy tắc:
- spend_efficiency lấy từ profit data nếu có, hoặc CPA campaign
- "next_check.after_days": SCALE 3d, REFRESH 7d, PAUSE 1d, KEEP 7d
- Tiếng Việt cho mọi text
- KHÔNG để score=0 hay tất cả score giống nhau`);
      break;

    case "ask":
      parts.push("Trả lời ngắn gọn, có dẫn chứng từ data + skill rule. Tiếng Việt.");
      break;
  }
  return parts.join("\n");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

  const {
    mode, question, group = "ALL", force_refresh,
    time_preset, custom_start, custom_end,
    account_id, campaign_id,
  } = body;
  if (!MODE_CONFIG[mode]) {
    return jsonResponse({ error: `Mode không hợp lệ: ${mode}. Choices: ${Object.keys(MODE_CONFIG).join(",")}` }, 400);
  }
  if (!GROUPS.includes(group)) {
    return jsonResponse({ error: `Group không hợp lệ: ${group}. Choices: ${GROUPS.join(",")}` }, 400);
  }
  if (mode === "ask" && !question) {
    return jsonResponse({ error: "Mode 'ask' cần question" }, 400);
  }

  // Resolve time range
  const timeRange = resolveTimeRange(time_preset || "last_30d", custom_start, custom_end);
  if (!timeRange) {
    return jsonResponse({ error: "Invalid time_preset hoặc thiếu custom_start/end" }, 400);
  }

  const cfg = MODE_CONFIG[mode];
  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = new URL(request.url).origin;

  // Cache check (chỉ cache audit modes) — include time + account + campaign in key
  const todayVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const tKey = `${timeRange.start}_${timeRange.end}`;
  const ctxKey = `${tKey}|${account_id || "noacc"}|${campaign_id || "nocamp"}`;
  const cacheKey = (mode !== "ask") ? `fb_cache:${CACHE_VERSION}:${mode}:${group}:${ctxKey}:${todayVN}` : null;
  if (cacheKey && !force_refresh && env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get(cacheKey, { type: "json" });
      if (cached?.response) {
        return jsonResponse({
          ok: true, mode, group, group_label: FB_GROUP_LABELS[group], model: cached.model || MODEL_FAST,
          response: cached.response, parsed_json: cached.parsed_json || null,
          cached: true, cached_at: cached.cached_at,
          cache_note: `Cache từ ${cached.cached_at}. Bấm Làm mới để regenerate.`,
        });
      }
    } catch { /* ignore */ }
  }

  // Fetch data
  const dataContext = {
    mode, group,
    group_label: FB_GROUP_LABELS[group],
    time_range: timeRange,
    account_id: account_id || null,
    campaign_id: campaign_id || null,
  };
  const tasks = [];
  if (cfg.data.includes("insights")) {
    tasks.push(fetchJson(origin, "/data/fb-ads-data.json", cookieHeader)
      .then(j => {
        dataContext.fb_insights = compactFbInsights(j, group);
        // Account/campaign context
        if (account_id && j) {
          dataContext.fb_campaigns = compactFbCampaigns(j, account_id, timeRange);
          if (campaign_id && dataContext.fb_campaigns?.campaigns) {
            dataContext.fb_focus_campaign = dataContext.fb_campaigns.campaigns.find(c => c.id === campaign_id);
          }
        }
      }));
  }
  if (cfg.data.includes("orders") || cfg.data.includes("profit") || cfg.data.includes("trend")) {
    tasks.push(fetchJson(origin, "/data/product-revenue.json", cookieHeader)
      .then(async (revJson) => {
        if (cfg.data.includes("orders")) dataContext.fb_orders = compactFbOrdersInRange(revJson, group, timeRange);
        if (cfg.data.includes("trend")) dataContext.fb_trend = compactFbDailyTrend(revJson, 30);
        if (cfg.data.includes("profit")) {
          const costsJson = await fetchJson(origin, "/data/product-costs.json", cookieHeader);
          dataContext.fb_profit = computeFbProfitInRange(revJson, costsJson, group, timeRange);
        }
      }));
  }
  await Promise.all(tasks);

  const skills = cfg.skills;
  const systemPrompt = buildSystemPrompt(skills, group, !!cfg.json_output);
  const userPrompt = buildUserPrompt(mode, question, dataContext, group);

  // Resolve model — body.model override config default
  const modelPref = body.model || cfg.model_pref || "fast";
  const selectedModel = MODEL_MAP[modelPref] || MODEL_FAST;

  // Call AI với auto-fallback: nếu model lớn fail (quota / timeout) → retry với Llama 8B
  let aiResult;
  let actualModel = selectedModel;
  let fallbackUsed = false;
  const aiParams = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: cfg.json_output ? 0.1 : 0.3,
    max_tokens: cfg.json_output ? 3000 : 2500,
  };

  try {
    aiResult = await env.AI.run(selectedModel, aiParams, { gateway: { id: "doscom-erp" } });
  } catch (e) {
    const errMsg = String(e.message || e);
    const isQuotaErr = /4006|neurons|quota|allocation|paid plan/i.test(errMsg);

    // Nếu đang dùng model lớn (big/claude) + lỗi quota → fallback xuống 8B Fast
    if ((modelPref === "big" || modelPref === "claude_haiku") && (isQuotaErr || /timeout|503|502/i.test(errMsg))) {
      console.log(`[FALLBACK] ${selectedModel} fail (${errMsg.slice(0,80)}), retry với 8B Fast`);
      try {
        aiResult = await env.AI.run(MODEL_FAST, aiParams, { gateway: { id: "doscom-erp" } });
        actualModel = MODEL_FAST;
        fallbackUsed = true;
      } catch (e2) {
        return jsonResponse({
          error: `Cả 2 models đều fail. Quota có thể hết hoặc Workers AI down.`,
          original_error: errMsg.slice(0, 200),
          fallback_error: String(e2.message || e2).slice(0, 200),
          hint: "Đợi 7h sáng mai VN reset quota free, hoặc upgrade Workers Paid $5/tháng (10M neurons).",
        }, 502);
      }
    } else {
      return jsonResponse({
        error: `Workers AI fail (${selectedModel}): ${errMsg.slice(0, 200)}`,
        hint: isQuotaErr
          ? "Hết 10K neurons free hôm nay. Reset 7h sáng mai VN. Hoặc upgrade Workers Paid $5/tháng."
          : (modelPref === "claude_haiku" ? "Claude Haiku cần Workers Paid + AI Models marketplace access" : null),
      }, 502);
    }
  }

  // Workers AI có thể trả response = string HOẶC object đã parse (khi json_output mode)
  let rawResp = "";
  let parsedJson = null;
  const respField = aiResult.response ?? aiResult.result ?? aiResult;
  if (typeof respField === "string") {
    rawResp = respField;
  } else if (respField && typeof respField === "object") {
    // Llama 70B với JSON mode có thể trả parsed object trực tiếp
    parsedJson = respField;
    rawResp = JSON.stringify(respField, null, 2);
  } else {
    rawResp = String(respField || "");
  }

  // Parse JSON nếu là JSON mode VÀ chưa có parsedJson từ object response
  // (skip re-parse nếu Workers AI đã trả parsed object trực tiếp)
  if (cfg.json_output && rawResp && !parsedJson) {
    let cleaned = String(rawResp).trim();
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (fenced) cleaned = fenced[1].trim();
    const start = cleaned.indexOf("{");
    if (start >= 0) {
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > start) {
        try { parsedJson = JSON.parse(cleaned.slice(start, end + 1)); }
        catch (e) { parsedJson = { _parse_error: e.message, _raw_excerpt: rawResp.slice(0, 500) }; }
      }
    }
    // Validation: 8 nhóm score 1-100, không 0
    if (parsedJson && !parsedJson._parse_error && mode === "audit_account_json") {
      const REQ = ["tracking","creative","audience","cost_ratio","profit","funnel","frequency","compliance"];
      const W = { tracking:15, creative:20, audience:15, cost_ratio:20, profit:15, funnel:10, frequency:5, compliance:5 };
      if (!parsedJson.breakdown) parsedJson.breakdown = {};
      let fixed = 0;
      for (const k of REQ) {
        if (!parsedJson.breakdown[k]) parsedJson.breakdown[k] = {};
        const it = parsedJson.breakdown[k];
        const sc = Number(it.score) || 0;
        if (sc < 1) { it.score = 35; it.note = (it.note || "") + " [Auto-fix: score=0 → 35]"; fixed++; }
        else if (sc > 100) it.score = 100;
        it.weight = W[k];
      }
      let total = 0;
      for (const k of REQ) total += parsedJson.breakdown[k].score * W[k];
      parsedJson.total_score = Math.round(total / 100);
      const t = parsedJson.total_score;
      parsedJson.grade = t>=85?"A":t>=70?"B":t>=55?"C":t>=40?"D":"F";
      if (fixed > 0) parsedJson._validation_note = `Auto-fix ${fixed}/8 nhóm score=0`;
    }
  }

  // Save cache
  if (cacheKey && env.INVENTORY && rawResp) {
    const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    try {
      await env.INVENTORY.put(cacheKey, JSON.stringify({
        response: rawResp, parsed_json: parsedJson, cached_at: nowVN, model: actualModel,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* ignore */ }
  }

  return jsonResponse({
    ok: true, mode, group, group_label: FB_GROUP_LABELS[group], model: actualModel,
    requested_model: selectedModel,
    fallback_used: fallbackUsed,
    fallback_note: fallbackUsed ? `${selectedModel} fail → fallback ${actualModel}` : null,
    response: rawResp, parsed_json: parsedJson,
    skills_used: cfg.skills, data_used: cfg.data,
    cached: false,
    _data_summary: {
      has_fb_insights: dataContext.fb_insights?.has_data || false,
      has_fb_orders: dataContext.fb_orders?.has_data || false,
      has_fb_profit: dataContext.fb_profit?.has_data || false,
      has_fb_trend: dataContext.fb_trend?.has_data || false,
    },
  });
}

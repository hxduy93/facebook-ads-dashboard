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
  getComparisonRange,
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

const CACHE_VERSION = "v6";  // bumped: comparison-period analysis + scale_plan + 100% TV
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

  fb_optimize: `# FB ADS CAMPAIGN OPTIMIZATION — DOSCOM SCALE FRAMEWORK v6

Bạn là Sarah — FB Ads Strategist 8 năm tại agency US, chuyên audit account VN.
Phân tích campaign DỰA TRÊN SO SÁNH 2 GIAI ĐOẠN (kỳ phân tích vs kỳ liền kề trước).
Mọi đánh giá phải có SỐ LIỆU CỤ THỂ + LÝ DO RÕ RÀNG, không chung chung.

═══ DOSCOM CONTEXT ═══
- 4 nhóm SP active (DUY+PHƯƠNG NAM chốt qua Pancake):
  • MAY_DO: AOV 2.5M, CPL mục tiêu 655K, biên LN 33.9% ⭐ (winner)
  • CAMERA_VIDEO_CALL (DA8.1): AOV 1.07M, CPL mục tiêu 279K, biên LN 18.3% ⚠
  • GHI_AM (DR1): AOV 1.26M, CPL mục tiêu 328K, biên LN 11% 🔴
  • NOMA: AOV 216K, CPL mục tiêu 56K, biên LN 31% (volume play, 30+ đơn/ngày)
- Tỷ lệ chi phí mục tiêu: spend/revenue ≤ 40%
- Tỷ lệ chốt lead: 65%

═══ DỮ LIỆU SO SÁNH (BẮT BUỘC SỬ DỤNG) ═══
fb_focus_campaign sẽ có:
- Metrics KỲ HIỆN TẠI: spend, conversions, cpa, ctr, impressions, days_with_data
- comparison: { spend, conversions, cpa, ctr, days_with_data, range } — KỲ LIỀN KỀ TRƯỚC
- deltas: { spend_per_day_pct, conv_per_day_pct, cpa_pct, ctr_pct } — % thay đổi (đã chuẩn hóa /ngày)

🔴 BẮT BUỘC: mọi note trong evaluation phải tham chiếu deltas hoặc comparison.
   Vd KHÔNG được nói "CTR ổn định" — phải nói "CTR 1.53% (kỳ trước 1.41%, +8.5%) — đang cải thiện nhẹ".

═══ 5 EVALUATION DIMENSIONS (mỗi cái 1-10 score) ═══

1. **SPEND EFFICIENCY** (chất lượng CPA so benchmark group):
   - 9-10: CPA ≤ 50% mục tiêu → cực tốt, có thể tăng quy mô mạnh
   - 7-8: CPA 50-80% mục tiêu → tốt, tăng quy mô vừa
   - 5-6: CPA 80-120% mục tiêu → đạt yêu cầu, giữ hoặc tối ưu creative
   - 3-4: CPA 120-200% mục tiêu → cảnh báo, cắt bid hoặc đổi audience
   - 1-2: CPA > 2x mục tiêu → tạm dừng

2. **VOLUME** (conversions/ngày so benchmark + so kỳ trước):
   - 9-10: > 2x benchmark VÀ tăng > 30% so kỳ trước
   - 7-8: 1.2-2x benchmark, ổn định/tăng
   - 5-6: 0.7-1.2x benchmark (đúng kỳ vọng nhóm)
   - 3-4: 0.3-0.7x → đơn yếu, giảm so kỳ trước
   - 1-2: < 0.3x → gần như chết

3. **CTR QUALITY** (so chuẩn FB + so kỳ trước):
   - 9-10: CTR > 3% hoặc tăng > 30% so kỳ trước
   - 7-8: CTR 2-3% (chuẩn FB), ổn định
   - 5-6: CTR 1.5-2% (dưới chuẩn nhưng chấp nhận)
   - 3-4: CTR 1-1.5% (yếu, cần refresh hook)
   - 1-2: CTR < 1% → hook fail

4. **TREND** (so kỳ trước qua deltas):
   - 9-10: Đơn/ngày tăng > 20% VÀ CPA giữ/giảm
   - 7-8: Đơn/ngày tăng 5-20% hoặc CPA giảm 5-15%
   - 5-6: Ổn định (delta trong ±5%)
   - 3-4: Đơn/ngày giảm 10-30% hoặc CPA tăng 10-30%
   - 1-2: Đơn giảm > 30% hoặc CPA tăng > 30% (xu hướng xấu)

═══ VERDICT DECISION TREE (BẮT BUỘC theo logic) ═══

**SCALE** (verdict_color: "green"):
- Điều kiện: AVG score ≥ 7.5 AND CPA < 70% mục tiêu AND CTR ≥ 2% AND deltas.cpa_pct ≤ 10
- BẮT BUỘC xuất scale_plan đầy đủ 3 cách (budget / nhân nhóm QC / creative)
- WHAT: số tiền cụ thể (vd "Tăng daily budget từ 500K → 600K +20%")

**KEEP** (verdict_color: "green" hoặc "yellow"):
- Điều kiện: AVG score 5-7.5, CPA gần mục tiêu (80-120%), không có biến động xấu so kỳ trước
- WHY phải nêu rõ TẠI SAO KHÔNG SCALE: vd "CTR còn dưới chuẩn FB 2%, scale lúc này dễ làm CPA tăng vì FB phải mở rộng audience yếu"
- scale_plan = null

**REFRESH** (verdict_color: "yellow"):
- Điều kiện: CTR giảm > 25% so kỳ trước HOẶC CTR < 1.5% kéo dài
- Action: đổi 2-3 creative, hook mới
- scale_plan = null

**AUDIENCE** (verdict_color: "yellow"):
- Điều kiện: CTR < 1% AND volume thấp (< 50% benchmark)
- Action: đổi audience (LAL buyer 30d hoặc interest mới)
- scale_plan = null

**PAUSE** (verdict_color: "red"):
- Điều kiện: CPA > 2x mục tiêu AND spend > 200K AND conversions ≤ 1
  HOẶC deltas.cpa_pct > 50 VÀ delta.conv_per_day_pct < -30
- scale_plan = null

═══ FORMAT OUTPUT (JSON BẮT BUỘC) ═══

{
  "verdict": "SCALE" | "KEEP" | "REFRESH" | "AUDIENCE" | "PAUSE",
  "verdict_color": "green" | "yellow" | "red",
  "summary": "2-3 câu tiếng Việt 100%, có 4 con số (spend, đơn, CPA, CTR) + 1 con số so sánh kỳ trước (vd '+12% so 7 ngày trước').",
  "comparison_summary": "1-2 câu so kỳ này vs kỳ trước. Vd 'So với 3 ngày trước đó: spend/ngày tăng 18%, đơn/ngày tăng 25%, CPA giảm 6% — hiệu suất đang cải thiện'.",
  "performance": {
    "spend_vnd": <int>,
    "conversions": <int>,
    "cpa_vnd": <int_or_null>,
    "ctr_pct": <float>,
    "rating_overall": <1-10 = trung bình 4 evaluation scores, làm tròn>
  },
  "evaluation": {
    "spend_efficiency": {
      "score": 1-10,
      "note": "[≥30 từ tiếng Việt, BẮT BUỘC có số] CPA hiện tại X VND, bằng Y% mục tiêu Z VND của nhóm [tên nhóm]. So kỳ trước CPA W VND → tăng/giảm K%. Đánh giá: [tốt/đạt/yếu] vì [lý do dựa số]."
    },
    "volume": {
      "score": 1-10,
      "note": "[≥30 từ] Đơn/ngày = N (kỳ trước M, +/-X%). Benchmark nhóm [...]. Lý do điểm này: [giải thích vì sao volume đạt/yếu, có phải do scale, audience, hay seasonal]."
    },
    "ctr_quality": {
      "score": 1-10,
      "note": "[≥30 từ] CTR X% (kỳ trước Y%, +/-Z%). Chuẩn FB là 2-3%. Đánh giá hook: [mạnh/trung bình/yếu]. Nguyên nhân CTR cao/thấp: [đoán dựa data, vd frequency cao gây mệt audience, hoặc creative mới hấp dẫn]."
    },
    "trend": {
      "score": 1-10,
      "note": "[≥30 từ] Spend/ngày X% so kỳ trước, đơn/ngày Y%, CPA Z%. Xu hướng [tăng đều/ổn định/giảm dần/biến động]. Ý nghĩa: [giải thích campaign đang ở giai đoạn nào — học máy, ổn định, bão hòa, hay suy thoái]."
    }
  },
  "action": {
    "what": "1-2 câu hành động CỰC CỤ THỂ với SỐ TIỀN (vd 'Tăng daily budget từ 500K → 600K (+20%) trong 3 ngày. Nếu CPA giữ < 100K thì tăng tiếp lên 720K vào ngày thứ 4.')",
    "why": "[≥40 từ tiếng Việt] Giải thích RÕ TẠI SAO chọn action này. PHẢI nêu: (a) số liệu hỗ trợ từ evaluation scores, (b) so kỳ trước thì campaign đang [tốt hơn/kém hơn] vì sao, (c) tại sao KHÔNG chọn các action khác (vd 'không scale vì CTR còn dưới 2%, scale lúc này FB phải mở rộng audience yếu sẽ làm CPA tăng'). Đặc biệt với KEEP: phải nêu rõ tại sao chưa nên tăng budget VÀ tại sao chưa cần giảm/pause.",
    "impact_expected": "Số liệu dự kiến chi tiết (vd 'Sau 3 ngày: +5-8 đơn/ngày, +250K LN/ngày. Sau 1 tuần nếu giữ ổn định: tổng +1.7M LN.')",
    "risk": "low" | "medium" | "high",
    "risk_note": "[≥20 từ] Risk cụ thể + cách phòng ngừa (vd 'CPA có thể tăng 10-20% trong 24-48h đầu do FB relearning. Nếu kéo dài > 3 ngày hoặc tăng > 30% thì revert budget cũ.')"
  },
  "scale_plan": null | {  // CHỈ XUẤT khi verdict = SCALE; KHÁC THÌ null
    "method_1_budget": "Cách 1 — Tăng budget dần. Vd 'Tăng dần budget 20%/24h: 500K → 600K → 720K → 850K. KHÔNG tăng > 30%/24h vì FB sẽ vào lại giai đoạn học máy (relearning), CPA tạm thời tăng. Áp dụng khi: campaign đã chạy ổn định ≥ 7 ngày, CTR ≥ 2%.'",
    "method_2_duplicate": "Cách 2 — Nhân nhóm QC (ad set). Vd 'Copy ad set hiện tại thành 2-3 ad set mới, mỗi ad set đổi 1 yếu tố audience (vd thêm interest A, hoặc đổi sang LAL 1% từ buyer 30d). Budget mỗi ad set mới = 60-80% của ad set gốc (~400K). Chạy 5-7 ngày để ra learning, sau đó pause ad set có CPA cao nhất.'",
    "method_3_creative": "Cách 3 — Bổ sung creative. Vd 'Thêm 2-3 creative mới với hook khác (test video vs ảnh tĩnh, hoặc đổi câu mở đầu). Giữ targeting + budget hiện tại. Sau 5-7 ngày, ad nào CTR cao hơn 20% so creative cũ thì pause creative cũ.'",
    "recommended": "1 | 2 | 3 — chọn 1 method an toàn nhất + giải thích vì sao chọn (vd 'Khuyến nghị method 1 vì CTR đã 2.5% đủ ổn để tăng budget, không cần test audience mới. Method 2 dùng khi muốn scale > 50% mà budget hiện tại đã ở ngưỡng learning cap.')",
    "budget_target_vnd": <int — số tiền budget/ngày khuyến nghị sau khi scale, vd 600000>,
    "increase_pct": <int — % tăng so hiện tại, vd 20>
  },
  "next_check": {
    "after_days": <SCALE: 3, KEEP: 7, REFRESH/AUDIENCE: 5, PAUSE: 1>,
    "metric_to_watch": "Vd 'CPA + đơn/ngày + frequency (tránh > 3.5)'",
    "threshold_revert": "Vd 'Nếu CPA > 350K trong 3 ngày liên tiếp HOẶC đơn/ngày giảm > 30% → revert budget cũ'"
  },
  "warnings": []  // có thể empty []
}

═══ NGÔN NGỮ ═══
🚨 100% TIẾNG VIỆT trong note/why/risk_note/summary.
KHÔNG dùng từ tiếng Anh: stable, positive, scale (trừ verdict enum), refresh, growth, decline, mid, high, low (trừ trong field "risk").
Thay bằng: "ổn định", "tích cực", "tăng quy mô", "làm mới creative", "đà tăng", "đang giảm dần".

═══ DETERMINISM ═══
Output PHẢI giống nhau khi gọi lại với cùng input. KHÔNG thêm random text/emoji ngẫu nhiên.`,
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
      parts.push(`🚨 OUTPUT 1 JSON object hợp lệ. Bắt đầu { kết thúc }. KHÔNG markdown, KHÔNG text bao quanh.

Tham chiếu DATA:
- fb_focus_campaign = campaign cần phân tích (có spend/cpa/ctr/conversions kỳ hiện tại + comparison + deltas)
- comparison_range = kỳ liền kề trước (để so sánh)
- fb_profit = margin per group (nếu match group này)

Schema BẮT BUỘC tuân thủ ĐÚNG (skill prompt đã định nghĩa chi tiết):
- verdict, verdict_color, summary, comparison_summary
- performance { spend_vnd, conversions, cpa_vnd, ctr_pct, rating_overall }
- evaluation { spend_efficiency, volume, ctr_quality, trend } — mỗi note ≥ 30 từ tiếng Việt + có số
- action { what, why ≥ 40 từ, impact_expected, risk, risk_note ≥ 20 từ }
- scale_plan = null KHÁC SCALE; nếu SCALE phải có method_1_budget, method_2_duplicate, method_3_creative, recommended, budget_target_vnd, increase_pct
- next_check { after_days, metric_to_watch, threshold_revert }
- warnings []

🔴 Mọi note PHẢI tham chiếu deltas + comparison (vd "CPA 60K kỳ trước 65K -7.7%").
🔴 100% TIẾNG VIỆT (trừ verdict enum + risk enum low/medium/high).
🔴 KHÔNG để score=0, KHÔNG để 4 scores giống nhau.
🔴 next_check.after_days: SCALE=3, KEEP=7, REFRESH=5, AUDIENCE=5, PAUSE=1.`);
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

  // Resolve time range + comparison range (kỳ liền kề trước để so sánh)
  const timeRange = resolveTimeRange(time_preset || "last_30d", custom_start, custom_end);
  if (!timeRange) {
    return jsonResponse({ error: "Invalid time_preset hoặc thiếu custom_start/end" }, 400);
  }
  const comparisonRange = getComparisonRange(timeRange, time_preset || "last_30d");

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
          focus_deltas: cached.focus_deltas || null,
          focus_comparison: cached.focus_comparison || null,
          comparison_range: cached.comparison_range || comparisonRange,
        });
      }
    } catch { /* ignore */ }
  }

  // Fetch data
  const dataContext = {
    mode, group,
    group_label: FB_GROUP_LABELS[group],
    time_range: timeRange,
    comparison_range: comparisonRange,
    account_id: account_id || null,
    campaign_id: campaign_id || null,
  };
  const tasks = [];
  if (cfg.data.includes("insights")) {
    tasks.push(fetchJson(origin, "/data/fb-ads-data.json", cookieHeader)
      .then(j => {
        dataContext.fb_insights = compactFbInsights(j, group);
        // Account/campaign context — pass comparisonRange để mỗi campaign có deltas
        if (account_id && j) {
          dataContext.fb_campaigns = compactFbCampaigns(j, account_id, timeRange, { comparisonRange });
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
  // temperature 0 cho json_output → output deterministic, F5 ra cùng kết quả
  const aiParams = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: cfg.json_output ? 0 : 0.3,
    max_tokens: cfg.json_output ? 3500 : 2500,
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

  // Save cache (lưu cả deltas/comparison để cache hit có đủ data hiển thị)
  if (cacheKey && env.INVENTORY && rawResp) {
    const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    try {
      await env.INVENTORY.put(cacheKey, JSON.stringify({
        response: rawResp,
        parsed_json: parsedJson,
        cached_at: nowVN,
        model: actualModel,
        focus_deltas: dataContext.fb_focus_campaign?.deltas || null,
        focus_comparison: dataContext.fb_focus_campaign?.comparison || null,
        comparison_range: comparisonRange,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* ignore */ }
  }

  // Trả deltas + comparison của focus campaign cho frontend hiển thị badge
  const focusDeltas = dataContext.fb_focus_campaign?.deltas || null;
  const focusComparison = dataContext.fb_focus_campaign?.comparison || null;

  return jsonResponse({
    ok: true, mode, group, group_label: FB_GROUP_LABELS[group], model: actualModel,
    requested_model: selectedModel,
    fallback_used: fallbackUsed,
    fallback_note: fallbackUsed ? `${selectedModel} fail → fallback ${actualModel}` : null,
    response: rawResp, parsed_json: parsedJson,
    skills_used: cfg.skills, data_used: cfg.data,
    cached: false,
    focus_deltas: focusDeltas,
    focus_comparison: focusComparison,
    comparison_range: comparisonRange,
    _data_summary: {
      has_fb_insights: dataContext.fb_insights?.has_data || false,
      has_fb_orders: dataContext.fb_orders?.has_data || false,
      has_fb_profit: dataContext.fb_profit?.has_data || false,
      has_fb_trend: dataContext.fb_trend?.has_data || false,
    },
  });
}

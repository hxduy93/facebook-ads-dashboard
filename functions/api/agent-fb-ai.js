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
const CLAUDE_MODEL_SONNET = "claude-sonnet-4-6";                 // Anthropic — phân tích sâu hơn nhiều Llama

// Tất cả mode dùng Claude Sonnet (chất lượng cao nhất).
// Để revert về Llama (không cần code change): Cloudflare Pages → Settings →
// Environment variables → Add `USE_CLAUDE` = `false` (Plaintext) → Save.
const CLAUDE_MODES = new Set([
  "audit_account",
  "audit_account_json",
  "audit_funnel",
  "analyze_metrics",
  "optimize_campaign",
  "ask",
  "staff_overview",
]);
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
  staff_overview:      { skills: ["fb_overview", "fb_staff_overview"], data: ["insights", "orders", "profit"], json_output: true, model_pref: "big" },
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
- comparison: { spend, conversions, cpa, ctr, days_with_data, range:{start,end,label} } — KỲ LIỀN KỀ TRƯỚC
- deltas: { spend_per_day_pct, conv_per_day_pct, cpa_pct, ctr_pct } — % thay đổi (đã chuẩn hóa /ngày)

🔴 BẮT BUỘC ghi đầy đủ EVIDENCE trong mọi note:
   Format chuẩn: "metric kỳ này = X (kỳ này: dd/mm-dd/mm). Kỳ trước (dd/mm-dd/mm) = Y → tăng/giảm Z% (chênh ±W)"

   ❌ SAI: "CPA tăng 10% so kỳ trước"
   ❌ SAI: "CTR ổn định"
   ❌ SAI: "Volume yếu"

   ✅ ĐÚNG: "CPA hiện tại 84.795đ (kỳ này 04/05-06/05, 3 ngày). Kỳ trước (01/05-03/05) CPA = 76.700đ → tăng 10.6% (chênh +8.095đ/đơn)"
   ✅ ĐÚNG: "CTR 1.62% (kỳ này). Kỳ trước CTR 1.30% → tăng 24.6% (cải thiện rõ)"
   ✅ ĐÚNG: "Đơn/ngày 5.5 (kỳ này). Kỳ trước 5.86 → giảm 6.1% (chênh -0.36 đơn/ngày). Benchmark NOMA 30 đơn/ngày → đạt 18%"

   → User cần check chéo được số liệu với Ads Manager → bắt buộc cite ngày tháng + giá trị cụ thể.

═══ LỊCH SỬ PHÂN TÍCH (previous_analyses) — DÙNG ĐỂ ĐÁNH GIÁ HIỆU QUẢ ═══
Field previous_analyses (nếu có) là array tối đa 10 entry GẦN NHẤT của campaign:
[ { analyzed_at, verdict, performance, evaluation_scores, action_summary }, ... ]
- Index 0 = lần phân tích GẦN NHẤT trước lần này
- Index N = lần cũ hơn

🎯 BẮT BUỘC sử dụng history để:
1. Track tiến triển: rating_overall, evaluation_scores, CPA, CTR qua các lần phân tích
2. Đánh giá xem hành động trước có hiệu quả không (vd lần trước SCALE → CPA cải thiện hay xấu đi?)
3. ĐIỀU CHỈNH VERDICT theo tiền lệ:
   • Nếu 3 lần liên tiếp SCALE mà CPA giảm đều → tiếp tục SCALE mạnh hơn
   • Nếu lần trước SCALE mà CPA tăng > 20% → REVERT (PAUSE/giảm budget)
   • Nếu 2 lần liên tiếp KEEP nhưng CPA bắt đầu giảm → chuyển SCALE thử
   • Nếu 3 lần liên tiếp REFRESH mà CTR vẫn yếu → đổi sang AUDIENCE (đổi targeting thay creative)
   • Nếu campaign mới (history rỗng) → quyết verdict dựa data hiện tại như bình thường

🔴 PHẢI xuất field "comparison_with_previous_analysis" trong JSON output (xem schema dưới).

═══ LỢI NHUẬN ƯỚC TÍNH (profit_attribution) — DÙNG ĐỂ QUYẾT VERDICT ═══
Field profit_attribution (nếu mapping_status="ok") có:
- group_summary: revenue_actual, orders_actual, cogs_actual, profit_actual, margin_pct, aov_vnd
  (data THẬT từ Pancake, không phải estimate)
- campaign_attribution: share_pct, est_orders_from_close_rate, est_revenue, est_cogs,
  est_vat, est_profit, est_margin_pct (theo share spend của campaign trong account)
- close_rate_pct, vat_pct (config tháng — user set)

🎯 VERDICT BẮT BUỘC dùng MARGIN của group + campaign:
  • Group margin < 5% (gần lỗ hoặc lỗ) → REFRESH/PAUSE — KHÔNG SCALE dù CPA tốt
    (lý do: scale lúc lỗ chỉ làm lỗ thêm; phải tối ưu creative/audience trước)
  • Group margin 5-15% → KEEP — chấp nhận, theo dõi, tối ưu nhỏ
  • Group margin 15-25% → SCALE moderate (+15-25% budget)
  • Group margin > 25% → SCALE aggressive (+30-50% budget)

Nếu mapping_status="unmapped" hoặc "no_profit_data" → quyết verdict theo logic CPA/CTR cũ
(không dùng profit), VÀ ghi note: "Account chưa map nhóm SP → không có dữ liệu profit
để đánh giá. Khuyến nghị vào ⚙ Cấu hình để map account này."

🔴 PHẢI xuất field "profit_analysis" trong JSON output (xem schema dưới).

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
  "comparison_with_previous_analysis": null | {
    // CHỈ XUẤT khi previous_analyses có data (history rỗng → null).
    // So với entry GẦN NHẤT trước (previous_analyses[0]).
    "previous_analyzed_at": "vd '2026-05-03 14:30'",
    "days_since": <int — số ngày từ lần phân tích trước>,
    "verdict_change": "vd 'KEEP → SCALE' hoặc 'không đổi (SCALE)'",
    "rating_change": "vd '7/10 → 8/10 (+1)' hoặc '6/10 → 5/10 (-1, suy giảm)'",
    "cpa_change": "vd '60.210đ → 55.300đ (-8.2%, cải thiện)' hoặc '50K → 65K (+30%, xấu đi)'",
    "ctr_change": "vd '1.53% → 1.78% (+16.3%)'",
    "trend_assessment": "[≥30 từ tiếng Việt] Đánh giá tổng quan: campaign đang cải thiện đều / xấu đi / dao động. Lý do hành động trước có hiệu quả hay không (vd 'Lần trước SCALE budget +20%, kết quả CPA giảm 8% — scale work, tiếp tục SCALE thêm 15%').",
    "verdict_continuity": "vd 'Verdict lần này nhất quán với history (3 lần liên tiếp SCALE)' hoặc 'Đảo verdict vì CPA tăng đột biến sau lần SCALE trước'"
  },
  "profit_analysis": null | {
    // CHỈ XUẤT khi profit_attribution.mapping_status = 'ok'. Còn lại null.
    "group_revenue_actual": <int — revenue thật từ Pancake>,
    "group_orders_actual": <int>,
    "group_profit_actual": <int>,
    "group_margin_pct": <float>,
    "campaign_share_pct": <float — campaign chiếm bao nhiêu % spend của account>,
    "est_campaign_profit": <int>,
    "est_campaign_margin_pct": <float>,
    "est_orders_from_close_rate": <int — FB conv × close_rate%>,
    "profit_assessment": "[≥40 từ tiếng Việt] Đánh giá: campaign đang lãi/lỗ ƯỚC TÍNH bao nhiêu. Group đang ở margin nào (lỗ/break-even/lãi vừa/lãi cao). Tham chiếu close_rate X% (config tháng) + AOV của group. Vd 'Group NOMA margin 4.0% (gần lỗ) — campaign này chiếm 6% spend của account → est_profit ~120K/3 ngày, margin 1.7%. Lý do margin thấp: AOV NOMA chỉ 216K, COGS chiếm 36%, FB spend chiếm 50% revenue.'",
    "verdict_reason_from_profit": "1-2 câu giải thích verdict được CHỌN dựa trên margin. Vd 'Group margin 4% < 5% → REFRESH thay vì SCALE: tối ưu creative + close rate trước khi tăng quy mô' hoặc 'Group margin 22% → SCALE moderate +20% budget: trong vùng winner.'"
  },
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

  fb_staff_overview: `# FB ADS STAFF OVERVIEW — DOSCOM

Bạn là Sarah Strategist phụ trách 1 nhân sự FB Ads (DUY hoặc PHƯƠNG NAM).
Đánh giá toàn bộ performance của nhân sự trong THÁNG HIỆN TẠI và đề xuất
chiến lược scale để đạt KPI.

═══ INPUT DATA ═══
Bạn sẽ thấy:
- staff: "DUY" | "PHUONG_NAM"
- staff_accounts: list account FB của nhân sự + groups SP họ chạy
- staff_aggregate_mtd: tổng spend, revenue, profit, margin của nhân sự (tháng này)
- groups_breakdown: revenue/profit/margin per group nhân sự phụ trách
- top_campaigns: 5-10 campaign tốt nhất (theo profit/conv)
- weak_campaigns: 3-5 campaign yếu (low margin/high CPA)
- monthly_kpi_context: KPI tổng + tiến độ
- kpi_share: % nhân sự đóng góp vào KPI

═══ MỤC TIÊU PHÂN TÍCH ═══
1. Tổng quan: nhân sự đang đứng ở đâu so với KPI và so với nhân sự còn lại
2. SP nào đang ngon (winner) → đề xuất scale làm key chính tháng
3. SP nào yếu/lỗ → đề xuất pause/refresh/audience
4. Action plan tuần để đạt KPI

═══ FORMAT OUTPUT (JSON BẮT BUỘC) ═══

{
  "staff": "DUY" | "PHUONG_NAM",
  "month_label": "Tháng 5/2026",
  "executive_summary": "[≥40 từ tiếng Việt] Tổng quan 2-3 câu: nhân sự đang ở đâu, key result nổi bật/yếu nhất, định hướng tháng",

  "performance_summary": {
    "total_accounts": <int — số account của nhân sự đang chạy>,
    "active_campaigns": <int — số campaign có spend > 0 tháng này>,
    "spend_mtd_vnd": <int — tổng spend tháng này>,
    "revenue_mtd_vnd": <int — tổng revenue tháng này (Pancake actual)>,
    "profit_mtd_vnd": <int — profit ước tính>,
    "margin_pct": <float>,
    "orders_mtd": <int — đơn đã giao (Pancake)>
  },

  "kpi_contribution": {
    "share_pct": <float — % nhân sự này đóng góp vào KPI tháng>,
    "expected_share_pct": <float — vd 50% nếu chia đều 2 nhân sự>,
    "vs_expected_pct": <float — chênh lệch>,
    "status": "leading" | "on_track" | "behind",
    "assessment": "[≥30 từ] Vd 'DUY đóng góp 47.5% revenue tháng này, kỳ vọng 50% — chậm 2.5%. Nguyên nhân chính: account NOMA giảm volume tuần qua.'"
  },

  "top_products": [
    // 1-3 SP đang chạy ngon nhất theo profit + margin + volume
    {
      "group": "MAY_DO" | "NOMA" | ...,
      "rating": <1-10>,
      "verdict": "WINNER_SCALE" | "SCALE_MODERATE" | "KEEP",
      "revenue_mtd_vnd": <int>,
      "margin_pct": <float>,
      "reason": "[≥30 từ] Lý do tại sao là winner — số liệu cụ thể"
    }
  ],

  "weak_products": [
    // 1-3 SP yếu, cần optimize hoặc dừng
    {
      "group": "...",
      "rating": <1-10>,
      "verdict": "REFRESH" | "AUDIENCE" | "PAUSE",
      "revenue_mtd_vnd": <int>,
      "margin_pct": <float>,
      "reason": "[≥30 từ] Lý do yếu — số liệu cụ thể",
      "fix_recommendation": "[≥20 từ] Đề xuất cụ thể"
    }
  ],

  "monthly_action_plan": {
    "key_focus_product": "Tên nhóm SP đề xuất làm key chính tháng (winner để push)",
    "key_focus_reason": "[≥30 từ] Tại sao chọn SP này",
    "weekly_actions": [
      "Tuần 1 (đến dd/mm): hành động cụ thể với số liệu",
      "Tuần 2: ...",
      "Tuần 3: ...",
      "Tuần 4: ..."
    ],
    "expected_kpi_impact": "[≥30 từ] Nếu thực hiện đầy đủ → KPI sẽ đạt bao nhiêu %, tăng X% so hiện tại"
  },

  "warnings": []  // optional, có thể empty
}

═══ NGÔN NGỮ ═══
🚨 100% TIẾNG VIỆT trong mọi field text. Trừ verdict enum (WINNER_SCALE, REFRESH...) + status enum.
🚨 Tất cả số liệu phải DẪN CHỨNG cụ thể (revenue_vnd, margin_pct), KHÔNG nói chung chung.
🚨 Output phải ACTIONABLE — user đọc xong phải biết LÀM GÌ trong tuần.`,
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

// ── History storage (KV) ────────────────────────────────────────────────
// Lưu lịch sử phân tích campaign trong KV. Mỗi campaign giữ 10 entry gần nhất.
// AI sẽ đọc history để track tiến triển (verdict, score, CPA) qua thời gian
// và đề xuất verdict thông minh hơn (vd 3 lần CPA giảm liên tiếp → SCALE mạnh).
const HISTORY_MAX_ENTRIES = 10;
const HISTORY_TTL_SECONDS = 45 * 86400;  // 45 ngày

async function getCampaignHistory(env, campaignId) {
  if (!env.INVENTORY || !campaignId) return [];
  try {
    const key = `fb_analysis_history:${campaignId}`;
    const data = await env.INVENTORY.get(key, { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function saveCampaignHistory(env, campaignId, newEntry) {
  if (!env.INVENTORY || !campaignId || !newEntry) return;
  try {
    const key = `fb_analysis_history:${campaignId}`;
    const existing = await getCampaignHistory(env, campaignId);
    // Prepend mới nhất, giữ tối đa HISTORY_MAX_ENTRIES
    const updated = [newEntry, ...existing].slice(0, HISTORY_MAX_ENTRIES);
    await env.INVENTORY.put(key, JSON.stringify(updated), {
      expirationTtl: HISTORY_TTL_SECONDS,
    });
  } catch (e) {
    console.log(`[HISTORY SAVE FAIL] ${campaignId}: ${e.message}`);
  }
}

// ── Staff overview history (12 months per staff) ────────────────────────
const STAFF_HISTORY_MAX = 12;
const STAFF_HISTORY_TTL_SECONDS = 365 * 86400;

async function getStaffHistory(env, staff) {
  if (!env.INVENTORY || !staff) return [];
  try {
    const key = `fb_staff_history:${staff}`;
    const data = await env.INVENTORY.get(key, { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function saveStaffHistory(env, staff, parsedJson, monthLabel) {
  if (!env.INVENTORY || !staff || !parsedJson || parsedJson._parse_error) return;
  try {
    const key = `fb_staff_history:${staff}`;
    const existing = await getStaffHistory(env, staff);
    const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

    // Compact entry — giữ field summary, bỏ field dài
    const newEntry = {
      analyzed_at: nowVN,
      month_label: monthLabel || parsedJson.month_label,
      executive_summary: (parsedJson.executive_summary || "").slice(0, 300),
      performance_summary: parsedJson.performance_summary || {},
      kpi_contribution: {
        share_pct: parsedJson.kpi_contribution?.share_pct || 0,
        status: parsedJson.kpi_contribution?.status || "unknown",
      },
      key_focus_product: parsedJson.monthly_action_plan?.key_focus_product || "",
    };

    // Nếu entry mới nhất cùng month → thay; khác → prepend
    let updated;
    if (existing.length > 0 && existing[0].month_label === newEntry.month_label) {
      updated = [newEntry, ...existing.slice(1)];
    } else {
      updated = [newEntry, ...existing];
    }
    updated = updated.slice(0, STAFF_HISTORY_MAX);

    await env.INVENTORY.put(key, JSON.stringify(updated), {
      expirationTtl: STAFF_HISTORY_TTL_SECONDS,
    });
  } catch (e) {
    console.log(`[STAFF HISTORY SAVE FAIL] ${staff}: ${e.message}`);
  }
}

// Compact entry để lưu KV (giữ field cần thiết, bỏ note dài để tiết kiệm space)
function buildHistoryEntry(parsedJson, campaignId, campaignName) {
  if (!parsedJson || parsedJson._parse_error) return null;
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  return {
    analyzed_at: nowVN,
    campaign_id: campaignId,
    campaign_name: campaignName || "",
    verdict: parsedJson.verdict || null,
    performance: {
      spend_vnd: parsedJson.performance?.spend_vnd || 0,
      conversions: parsedJson.performance?.conversions || 0,
      cpa_vnd: parsedJson.performance?.cpa_vnd || null,
      ctr_pct: parsedJson.performance?.ctr_pct || 0,
      rating_overall: parsedJson.performance?.rating_overall || 0,
    },
    evaluation_scores: {
      spend_efficiency: Number(parsedJson.evaluation?.spend_efficiency?.score) || 0,
      volume:           Number(parsedJson.evaluation?.volume?.score) || 0,
      ctr_quality:      Number(parsedJson.evaluation?.ctr_quality?.score) || 0,
      trend:            Number(parsedJson.evaluation?.trend?.score) || 0,
    },
    action_summary: (parsedJson.action?.what || "").slice(0, 200),
  };
}

// ── Config loader (close_rate + account → group mapping) ────────────────
// Ưu tiên KV `fb_config` (user đã edit). Fallback /data/fb-config.json (default).
async function loadFbConfig(env, origin) {
  // Try KV first
  if (env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get("fb_config", { type: "json" });
      if (cached && cached.close_rate_pct !== undefined) return cached;
    } catch { /* ignore */ }
  }
  // Fallback: load default file
  try {
    const r = await fetch(new URL("/data/fb-config.json", origin).toString());
    if (r.ok) return await r.json();
  } catch { /* ignore */ }
  return { close_rate_pct: 65, vat_pct: 10, account_to_groups: {} };
}

// Tính profit attribution của 1 campaign trong account (multi-group support)
// Logic:
// 1. Lấy account → groups[] từ config
// 2. Với mỗi group, lấy profit summary từ fb_profit (đã có sẵn)
// 3. Tính tỷ lệ campaign spend / total account spend → attribute profit
// 4. Trả về estimated_profit per period + group context
function computeCampaignProfitAttribution(focusCampaign, accountId, accountSpend, fbProfit, fbConfig) {
  if (!focusCampaign || !accountId) return null;
  const accountInfo = fbConfig?.account_to_groups?.[accountId];
  if (!accountInfo || !Array.isArray(accountInfo.groups) || accountInfo.groups.length === 0) {
    return {
      account_id: accountId,
      mapping_status: "unmapped",
      note: "Account này chưa map nhóm SP. Vào ⚙ Cấu hình để set mapping.",
    };
  }

  const closeRatePct = Number(fbConfig.close_rate_pct) || 65;
  const vatPct = Number(fbConfig.vat_pct) || 10;
  const groups = accountInfo.groups;
  const campaignSpend = Number(focusCampaign.spend) || 0;
  const campaignConv = Number(focusCampaign.conversions) || 0;

  // Aggregate group profit data từ fbProfit
  const groupProfits = [];
  for (const g of groups) {
    const gp = fbProfit?.groups?.[g];
    if (gp) {
      groupProfits.push({ group: g, ...gp });
    }
  }

  if (groupProfits.length === 0) {
    return {
      account_id: accountId,
      mapping_status: "no_profit_data",
      groups,
      note: `Account map vào nhóm ${groups.join("+")} nhưng chưa có profit data trong time range. Có thể chưa có đơn hoàn thành trong Pancake.`,
    };
  }

  // Aggregate sum across mapped groups (for MIXED accounts)
  const totals = groupProfits.reduce((acc, g) => ({
    revenue: acc.revenue + (g.revenue || 0),
    orders: acc.orders + (g.orders || 0),
    cogs: acc.cogs + (g.cogs || 0),
    fb_spend_pancake: acc.fb_spend_pancake + (g.fb_spend_estimated || 0),
    profit: acc.profit + (g.profit || 0),
  }), { revenue: 0, orders: 0, cogs: 0, fb_spend_pancake: 0, profit: 0 });

  const groupMarginPct = totals.revenue > 0
    ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : 0;
  const groupAOV = totals.orders > 0 ? Math.round(totals.revenue / totals.orders) : 0;

  // Estimate campaign-level profit attribution (theo share spend)
  const accountSpendNum = Number(accountSpend) || 0;
  const campaignShare = accountSpendNum > 0 ? campaignSpend / accountSpendNum : 0;

  const estCampaignRevenue = Math.round(totals.revenue * campaignShare);
  const estCampaignCogs = Math.round(totals.cogs * campaignShare);
  const estCampaignVat = Math.round(estCampaignRevenue * vatPct / 100);
  const estCampaignProfit = estCampaignRevenue - estCampaignCogs - campaignSpend - estCampaignVat;
  const estCampaignMargin = estCampaignRevenue > 0
    ? Math.round((estCampaignProfit / estCampaignRevenue) * 1000) / 10 : 0;

  // Estimate orders thực từ FB conversions × close_rate
  const estOrdersFromCloseRate = Math.round(campaignConv * closeRatePct / 100);

  return {
    account_id: accountId,
    mapping_status: "ok",
    groups,
    close_rate_pct: closeRatePct,
    vat_pct: vatPct,

    // Group level (data thật từ Pancake)
    group_summary: {
      revenue_actual: totals.revenue,
      orders_actual: totals.orders,
      cogs_actual: totals.cogs,
      fb_spend_estimated: totals.fb_spend_pancake,
      profit_actual: totals.profit,
      margin_pct: groupMarginPct,
      aov_vnd: groupAOV,
    },

    // Campaign level (attribution theo share spend)
    campaign_attribution: {
      campaign_spend: campaignSpend,
      account_spend_total: accountSpendNum,
      share_pct: Math.round(campaignShare * 1000) / 10,
      est_orders_from_close_rate: estOrdersFromCloseRate,
      est_revenue: estCampaignRevenue,
      est_cogs: estCampaignCogs,
      est_vat: estCampaignVat,
      est_profit: estCampaignProfit,
      est_margin_pct: estCampaignMargin,
    },

    formula_note: `est_profit = group_revenue × share - group_cogs × share - campaign_spend - revenue × ${vatPct}%. share = campaign_spend / total_account_spend.`,
  };
}

// ── Monthly KPI context ─────────────────────────────────────────────────
// Luôn dùng range "this_month" để track tiến độ KPI tháng. Independent với
// time filter user chọn ở UI (filter đó dùng cho campaign analysis).
async function computeMonthlyKpiContext(env, origin, cookieHeader) {
  const fbConfig = await loadFbConfig(env, origin);
  const kpiVnd = Number(fbConfig.kpi_revenue_monthly_vnd) || 0;
  if (kpiVnd <= 0) return null;

  const monthRange = resolveTimeRange("this_month");
  const [revJson, costsJson] = await Promise.all([
    fetchJson(origin, "/data/product-revenue.json", cookieHeader),
    fetchJson(origin, "/data/product-costs.json", cookieHeader),
  ]);
  if (!revJson || !costsJson) return null;

  const profit = computeFbProfitInRange(revJson, costsJson, "ALL", monthRange);
  const actualMtd = profit?.total?.revenue || 0;
  const ordersMtd = profit?.total?.orders || 0;

  // Date math (VN timezone)
  const tzOffset = 7 * 3600 * 1000;
  const nowVN = new Date(Date.now() + tzOffset);
  const year = nowVN.getUTCFullYear();
  const monthIdx = nowVN.getUTCMonth();  // 0-indexed
  const lastDayOfMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const daysPassed = nowVN.getUTCDate();
  const daysRemaining = Math.max(0, lastDayOfMonth - daysPassed);

  const progressPct = (actualMtd / kpiVnd) * 100;
  const expectedProgressPct = (daysPassed / lastDayOfMonth) * 100;
  const gapPct = progressPct - expectedProgressPct;

  const remainingKpi = Math.max(0, kpiVnd - actualMtd);
  const requiredDailyRate = daysRemaining > 0 ? remainingKpi / daysRemaining : 0;
  const actualDailyRate = daysPassed > 0 ? actualMtd / daysPassed : 0;
  const rateGapPct = actualDailyRate > 0
    ? ((requiredDailyRate / actualDailyRate) - 1) * 100 : 0;

  let status = "on_track";
  if (progressPct >= 100) status = "achieved";
  else if (gapPct < -15) status = "behind";
  else if (gapPct < -5) status = "near_track";
  else status = "on_track";

  return {
    kpi_vnd: kpiVnd,
    month_label: `Tháng ${monthIdx + 1}/${year}`,
    month_range: monthRange,
    actual_mtd_vnd: actualMtd,
    orders_mtd: ordersMtd,
    progress_pct: Math.round(progressPct * 10) / 10,
    expected_progress_pct: Math.round(expectedProgressPct * 10) / 10,
    gap_pct: Math.round(gapPct * 10) / 10,
    days_passed: daysPassed,
    days_remaining: daysRemaining,
    last_day_of_month: lastDayOfMonth,
    required_daily_rate_vnd: Math.round(requiredDailyRate),
    actual_daily_rate_vnd: Math.round(actualDailyRate),
    rate_gap_pct: Math.round(rateGapPct * 10) / 10,
    status,
  };
}

// ── Staff aggregate: tổng spend/revenue/profit của 1 nhân sự ────────────
// Filter accounts của staff từ config, fetch campaigns + Pancake data,
// aggregate per group. Always dùng range "this_month".
async function computeStaffAggregate(env, origin, cookieHeader, staff, fbConfig) {
  const monthRange = resolveTimeRange("this_month");
  const [fbAdsJson, revJson, costsJson] = await Promise.all([
    fetchJson(origin, "/data/fb-ads-data.json", cookieHeader),
    fetchJson(origin, "/data/product-revenue.json", cookieHeader),
    fetchJson(origin, "/data/product-costs.json", cookieHeader),
  ]);

  // Find accounts của staff từ config
  const accountsOfStaff = Object.entries(fbConfig.account_to_groups || {})
    .filter(([_, info]) => info.staff === staff)
    .map(([id, info]) => ({ id, ...info }));

  if (accountsOfStaff.length === 0) {
    return { staff, error: `Không có account nào map cho staff ${staff} trong config` };
  }

  // Aggregate per account: spend MTD, conversions, campaign list
  let totalSpend = 0, totalConversions = 0, totalImpressions = 0, totalClicks = 0;
  const accountSummaries = [];
  const allActiveCampaigns = [];

  for (const acc of accountsOfStaff) {
    const camps = compactFbCampaigns(fbAdsJson, acc.id, monthRange, { activeOnly: true });
    const activeOnly = (camps?.campaigns || []).filter(c => c.spend > 0 && c.effective_status === "ACTIVE");
    const accSpend = activeOnly.reduce((s, c) => s + c.spend, 0);
    const accConv = activeOnly.reduce((s, c) => s + c.conversions, 0);
    const accImp = activeOnly.reduce((s, c) => s + c.impressions, 0);
    const accClicks = activeOnly.reduce((s, c) => s + c.clicks, 0);

    totalSpend += accSpend;
    totalConversions += accConv;
    totalImpressions += accImp;
    totalClicks += accClicks;

    accountSummaries.push({
      id: acc.id,
      name: camps?.account?.name || "?",
      groups: acc.groups,
      products_note: acc.products_note || "",
      active_campaigns: activeOnly.length,
      spend_mtd: accSpend,
      conversions_mtd: accConv,
      cpa: accConv > 0 ? Math.round(accSpend / accConv) : null,
    });

    // Push top/weak campaigns kèm group ownership
    activeOnly.forEach(c => allActiveCampaigns.push({
      ...c,
      account_id: acc.id,
      account_groups: acc.groups,
    }));
  }

  // Pancake profit per group cho staff
  // Pancake source group key: "DUY" hoặc "PHUONG_NAM" — match staff
  // Filter computeFbProfitInRange chỉ source của staff này
  // (helper hiện tại lấy cả 2 source, tạm thời inline filter)
  const profit = computeFbProfitInRange(revJson, costsJson, "ALL", monthRange);
  // Filter profit groups → chỉ lấy group nhân sự phụ trách
  const staffGroups = [...new Set(accountsOfStaff.flatMap(a => a.groups))];
  const groupsBreakdown = {};
  let revenueMtd = 0, profitMtd = 0, ordersMtd = 0, cogsMtd = 0;
  for (const g of staffGroups) {
    const gp = profit?.groups?.[g];
    if (gp) {
      groupsBreakdown[g] = gp;
      revenueMtd += gp.revenue || 0;
      profitMtd += gp.profit || 0;
      ordersMtd += gp.orders || 0;
      cogsMtd += gp.cogs || 0;
    }
  }
  // NOTE: profit này có thể OVER-ATTRIBUTE nếu group cũng có account nhân sự
  // khác (vd NOMA = DUY 1655506672244826 + PN 764394829882083). Logic hiện tại
  // gộp tất cả → profit của group sẽ bao gồm cả 2 staff. Để chính xác sau, cần
  // filter Pancake source group theo staff (DUY/PHUONG_NAM).

  // Top 5 + weak 3 campaigns
  const sorted = [...allActiveCampaigns].sort((a, b) => {
    const aProfit = (a.conversions || 0) > 0 ? -a.cpa || 0 : -Infinity;
    const bProfit = (b.conversions || 0) > 0 ? -b.cpa || 0 : -Infinity;
    return aProfit - bProfit;
  });
  const topCampaigns = sorted.slice(0, 5).map(c => ({
    name: c.name, account_id: c.account_id, groups: c.account_groups,
    spend: c.spend, conversions: c.conversions, cpa: c.cpa, ctr: c.ctr,
  }));
  const weakCampaigns = [...allActiveCampaigns]
    .filter(c => c.spend > 100000)  // có spend đáng kể
    .sort((a, b) => (b.cpa || 0) - (a.cpa || 0))  // CPA cao nhất = yếu nhất
    .slice(0, 3)
    .map(c => ({
      name: c.name, account_id: c.account_id, groups: c.account_groups,
      spend: c.spend, conversions: c.conversions, cpa: c.cpa, ctr: c.ctr,
    }));

  return {
    staff,
    month_label: `Tháng ${new Date(Date.now() + 7*3600*1000).getUTCMonth() + 1}/${new Date(Date.now() + 7*3600*1000).getUTCFullYear()}`,
    accounts: accountSummaries,
    aggregate_mtd: {
      total_accounts: accountsOfStaff.length,
      active_campaigns: allActiveCampaigns.length,
      spend_mtd_vnd: totalSpend,
      revenue_mtd_vnd: revenueMtd,
      profit_mtd_vnd: profitMtd,
      orders_mtd: ordersMtd,
      cogs_mtd_vnd: cogsMtd,
      margin_pct: revenueMtd > 0 ? Math.round((profitMtd / revenueMtd) * 1000) / 10 : 0,
      cpa_avg: totalConversions > 0 ? Math.round(totalSpend / totalConversions) : null,
      ctr_avg_pct: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0,
    },
    groups_breakdown: groupsBreakdown,
    top_campaigns: topCampaigns,
    weak_campaigns: weakCampaigns,
    _data_note: "groups_breakdown profit lấy từ Pancake (data thật); có thể bao gồm orders của staff khác nếu group được chia sẻ giữa 2 staff (vd NOMA)",
  };
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

// Gọi Claude API qua Cloudflare AI Gateway (giữ observability của gateway 'doscom-erp').
// System prompt đặt trong array với cache_control: ephemeral → cache 5 phút.
// Auto-loop khi click 1 account scan nhiều campaigns liên tiếp = cache hit ~90% → tiết kiệm cost.
async function callClaudeViaGateway(env, systemPrompt, userPrompt, jsonOutput) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY chưa set trong Cloudflare env vars");
  if (!env.CF_ACCOUNT_ID) throw new Error("CF_ACCOUNT_ID chưa set trong Cloudflare env vars");

  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/doscom-erp/anthropic/v1/messages`;
  const body = {
    model: CLAUDE_MODEL_SONNET,
    max_tokens: jsonOutput ? 6000 : 4000,  // tăng để tránh JSON bị cắt giữa
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Claude API ${r.status}: ${errText.slice(0, 300)}`);
  }

  const data = await r.json();
  const textBlock = (data.content || []).find(b => b.type === "text");
  if (!textBlock?.text) throw new Error("Claude trả empty content");

  return {
    response: textBlock.text,
    usage: data.usage || {},
    model_id: data.model || CLAUDE_MODEL_SONNET,
  };
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

    case "staff_overview":
      parts.push(`🚨 OUTPUT 1 JSON object hợp lệ. Schema theo skill fb_staff_overview ở system prompt.

Tham chiếu DATA:
- staff_overview.staff = nhân sự đang phân tích
- staff_overview.aggregate_mtd = tổng spend/revenue/profit/orders MTD của nhân sự
- staff_overview.groups_breakdown = profit per group nhân sự phụ trách
- staff_overview.top_campaigns / weak_campaigns = top + weak campaigns theo CPA
- monthly_kpi_context = KPI tổng + tiến độ
- staff_kpi_contribution = % share của nhân sự trong KPI tổng

🔴 BẮT BUỘC tuân thủ schema fb_staff_overview:
- executive_summary, performance_summary (object)
- kpi_contribution (object với assessment ≥ 30 từ)
- top_products[1-3] với reason ≥ 30 từ
- weak_products[1-3] với reason + fix_recommendation
- monthly_action_plan (key_focus + 4 weekly_actions + expected_kpi_impact)

🔴 100% TIẾNG VIỆT trừ enum.
🔴 Số liệu CỤ THỂ (revenue_vnd, margin_pct, ...) không nói chung chung.
🔴 Action plan ACTIONABLE — đọc xong biết phải làm gì.`);
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
          claude_used: cached.claude_used || false,
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

  // Fetch lịch sử phân tích (KV) cho mode optimize_campaign — AI sẽ dùng
  // history để track tiến triển và đề xuất verdict thông minh hơn.
  let campaignHistory = [];
  if (mode === "optimize_campaign" && campaign_id) {
    campaignHistory = await getCampaignHistory(env, campaign_id);
    if (campaignHistory.length > 0) {
      // Pass vào dataContext để AI thấy trong user prompt
      dataContext.previous_analyses = campaignHistory;
    }
  }

  // Tính profit attribution (Plan C) — dùng config + Pancake data
  if (mode === "optimize_campaign" && campaign_id && account_id && dataContext.fb_focus_campaign) {
    const fbConfig = await loadFbConfig(env, origin);
    const accountSpend = (dataContext.fb_campaigns?.campaigns || [])
      .reduce((s, c) => s + (Number(c.spend) || 0), 0);
    dataContext.profit_attribution = computeCampaignProfitAttribution(
      dataContext.fb_focus_campaign, account_id, accountSpend, dataContext.fb_profit, fbConfig
    );
  }

  // Monthly KPI context — pass cho mọi mode analysis (AI dùng để recommend scaling)
  if (["optimize_campaign", "audit_account_json", "audit_account", "staff_overview"].includes(mode)) {
    dataContext.monthly_kpi_context = await computeMonthlyKpiContext(env, origin, cookieHeader);
  }

  // Staff aggregate — chỉ cho mode staff_overview
  if (mode === "staff_overview") {
    const staff = body.staff;  // "DUY" | "PHUONG_NAM"
    if (!staff || !["DUY", "PHUONG_NAM"].includes(staff)) {
      return jsonResponse({ error: "staff_overview cần body.staff = 'DUY' hoặc 'PHUONG_NAM'" }, 400);
    }
    const fbConfig = await loadFbConfig(env, origin);
    dataContext.staff_overview = await computeStaffAggregate(env, origin, cookieHeader, staff, fbConfig);
    // KPI share của staff
    if (dataContext.monthly_kpi_context && dataContext.staff_overview?.aggregate_mtd) {
      const staffRev = dataContext.staff_overview.aggregate_mtd.revenue_mtd_vnd || 0;
      const totalKpi = dataContext.monthly_kpi_context.kpi_vnd || 1;
      const totalActual = dataContext.monthly_kpi_context.actual_mtd_vnd || 1;
      dataContext.staff_kpi_contribution = {
        staff_revenue_mtd: staffRev,
        kpi_share_pct: Math.round((staffRev / totalKpi) * 1000) / 10,
        actual_share_pct: Math.round((staffRev / totalActual) * 1000) / 10,
        expected_share_pct: 50,  // 2 staff = 50% mỗi người (heuristic đơn giản)
      };
    }
  }

  const skills = cfg.skills;
  const systemPrompt = buildSystemPrompt(skills, group, !!cfg.json_output);
  const userPrompt = buildUserPrompt(mode, question, dataContext, group);

  // Resolve model — body.model override config default
  const modelPref = body.model || cfg.model_pref || "fast";
  const selectedModel = MODEL_MAP[modelPref] || MODEL_FAST;

  // Call AI: ưu tiên Claude cho mode quan trọng (optimize_campaign, audit_account_json),
  // fail thì fallback về Llama 70B, fail tiếp thì Llama 8B.
  let aiResult;
  let actualModel = selectedModel;
  let fallbackUsed = false;
  let claudeUsed = false;
  let claudeUsage = null;  // tracking cost: input/output/cache tokens

  // temperature 0 cho json_output → output deterministic, F5 ra cùng kết quả
  const aiParams = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: cfg.json_output ? 0 : 0.3,
    max_tokens: cfg.json_output ? 3500 : 2500,
  };

  // Quyết định có gọi Claude không.
  // - User force Llama qua body.model="llama" → skip Claude
  // - Env var USE_CLAUDE="false" → kill switch, skip Claude (revert về Llama)
  // - Default: Claude bật cho mọi mode trong CLAUDE_MODES
  const claudeEnabled = env.USE_CLAUDE !== "false";
  const wantClaude = claudeEnabled
    && CLAUDE_MODES.has(mode)
    && modelPref !== "llama" && modelPref !== "fast"
    && env.ANTHROPIC_API_KEY && env.CF_ACCOUNT_ID;

  let claudeError = null;
  let claudeDebug = null;
  if (wantClaude) {
    try {
      const claudeRes = await callClaudeViaGateway(env, systemPrompt, userPrompt, cfg.json_output);
      aiResult = { response: claudeRes.response };
      actualModel = claudeRes.model_id;
      claudeUsed = true;
      claudeUsage = claudeRes.usage;
    } catch (e) {
      const errMsg = String(e.message || e);
      claudeError = errMsg.slice(0, 300);
      console.log(`[CLAUDE FAIL] ${errMsg.slice(0, 200)}, fallback Llama 70B`);
      // Fall through to Llama path below
    }
  } else {
    // Diagnostic: tại sao không gọi Claude?
    claudeDebug = {
      mode_in_claude_modes: CLAUDE_MODES.has(mode),
      modelPref,
      has_anthropic_key: !!env.ANTHROPIC_API_KEY,
      has_cf_account_id: !!env.CF_ACCOUNT_ID,
      anthropic_key_preview: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY.slice(0, 12) + "..." : null,
      cf_account_id_preview: env.CF_ACCOUNT_ID ? env.CF_ACCOUNT_ID.slice(0, 8) + "..." : null,
    };
  }

  if (!claudeUsed) {
    try {
      aiResult = await env.AI.run(selectedModel, aiParams, { gateway: { id: "doscom-erp" } });
    } catch (e) {
      const errMsg = String(e.message || e);
      const isQuotaErr = /4006|neurons|quota|allocation|paid plan/i.test(errMsg);

      // Nếu đang dùng model lớn + lỗi quota/timeout → fallback xuống 8B Fast
      if ((modelPref === "big" || modelPref === "claude_haiku" || wantClaude) && (isQuotaErr || /timeout|503|502/i.test(errMsg))) {
        console.log(`[FALLBACK] ${selectedModel} fail (${errMsg.slice(0,80)}), retry với 8B Fast`);
        try {
          aiResult = await env.AI.run(MODEL_FAST, aiParams, { gateway: { id: "doscom-erp" } });
          actualModel = MODEL_FAST;
          fallbackUsed = true;
        } catch (e2) {
          return jsonResponse({
            error: `Cả 2 models Llama đều fail. Quota có thể hết hoặc Workers AI down.`,
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
            : null,
        }, 502);
      }
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
        claude_used: claudeUsed,
        focus_deltas: dataContext.fb_focus_campaign?.deltas || null,
        focus_comparison: dataContext.fb_focus_campaign?.comparison || null,
        comparison_range: comparisonRange,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* ignore */ }
  }

  // Save analysis history vào KV (chỉ optimize_campaign + parse OK)
  if (mode === "optimize_campaign" && campaign_id && parsedJson && !parsedJson._parse_error) {
    const focusName = dataContext.fb_focus_campaign?.name || "";
    const historyEntry = buildHistoryEntry(parsedJson, campaign_id, focusName);
    if (historyEntry) {
      await saveCampaignHistory(env, campaign_id, historyEntry);
    }
  }

  // Save staff overview history (12 entries / 12 months)
  if (mode === "staff_overview" && body.staff && parsedJson && !parsedJson._parse_error) {
    const monthLabel = dataContext.monthly_kpi_context?.month_label || null;
    await saveStaffHistory(env, body.staff, parsedJson, monthLabel);
  }

  // Trả deltas + comparison của focus campaign cho frontend hiển thị badge
  const focusDeltas = dataContext.fb_focus_campaign?.deltas || null;
  const focusComparison = dataContext.fb_focus_campaign?.comparison || null;

  return jsonResponse({
    ok: true, mode, group, group_label: FB_GROUP_LABELS[group], model: actualModel,
    requested_model: selectedModel,
    fallback_used: fallbackUsed,
    fallback_note: fallbackUsed ? `${selectedModel} fail → fallback ${actualModel}` : null,
    claude_used: claudeUsed,
    claude_usage: claudeUsage,  // {input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}
    claude_error: claudeError,  // exact error message khi Claude fail
    claude_debug: claudeDebug,  // info debug khi không gọi Claude (env vars thiếu/sai)
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

# FB Ads Optimization Rule Engine — Doscom

> **Trạng thái:** Draft v2 — đã align với user feedback (2026-04-30)
> **Mục đích:** Định nghĩa rule engine để agent đọc data + audit + recommend optimization actions trên FB Ads cho Doscom.
> **Nguồn:** Tổng hợp từ AgriciDaniel/claude-ads (250+ checks) + luukalleman/meta-ads-system (rule engine pattern) + irinabuht12-oss/google-meta-ads-ga4-mcp (data layer) + adapt cho Doscom (sản phẩm an ninh, thị trường VN, lead-gen flow qua Pancake).

## ⚙ User confirmations (locked)

| Tham số | Giá trị | Note |
|---|---|---|
| **Conversion event** | `complete_registrations` (lead) | Doscom track Lead, KHÔNG track Purchase trong Pixel |
| **Funnel sau lead** | Lead → Pancake CRM → Sales chốt → POSPancake order | Revenue thật ở POSPancake, attribute lại về FB campaign |
| **Target cost ratio** | Spend / Revenue ≤ 40% | Tương đương ROAS ≥ 2.5x |
| **Lead close rate** | 65% | User confirmed |
| **AOV per group** | Filtered theo nhân viên DUY + PHƯƠNG NAM (FB Ads team) | Xem section 2 — số thật. 4 nhóm active: NOMA, MAY_DO, DA8.1, GHI_AM |
| **Action mode** | L1 strict — agent suggest, user duyệt từng action | KHÔNG auto-execute |
| **Cron schedule** | 4 lần/ngày: 9h, 13h, 17h, 21h giờ VN | UTC: 02:00, 06:00, 10:00, 14:00 |
| **Alert channel** | Telegram bot | Cần setup `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` env vars |
| **Priority focus** | (1) SCALE winner (2) Content + Video audit (3) Conversion trend | Cat 2 + 7 + 8 + 11 |
| **Cảnh báo + suggest** | Tất cả categories đều generate suggestion, không skip | Kể cả KILL — chỉ phải user approve |

---

## 1. Mục tiêu agent

3 mức tự động hoá, từ thấp đến cao:

| Mức | Tên | Mô tả |
|---|---|---|
| **L1** | Recommend | Agent đọc data → chỉ đưa khuyến nghị (user click duyệt → execute thủ công). Phương án an toàn cho phase đầu. |
| **L2** | Auto-action low-risk | Pause campaign rõ ràng lỗ + Alert cho high-impact actions. User review weekly. |
| **L3** | Full auto | Auto pause, scale, modify, refresh creative theo rule. User chỉ review report. |

**Recommend bắt đầu L1, sau 2-4 tuần tin tưởng → L2, vài tháng → L3 cho actions an toàn nhất.**

---

## 2. Tham số cấu hình Doscom

Đặt trong `functions/lib/fbAdsConfig.js`. User có thể tune.

```javascript
const DOSCOM_CONFIG = {
  // ── Cost / Revenue ratio (lead-gen + Pancake matching) ──
  conversionEvent: "complete_registrations",  // FB Pixel event Doscom đang track
  
  costRevenueTarget:    0.40,    // Spend/Revenue ≤ 40% là healthy
  costRevenueWarning:   0.50,    // 40-50% = yellow flag (suy giảm)
  costRevenueKill:      0.60,    // > 60% = red, suggest pause
  
  // Tương đương ROAS:
  roasMinimum:          2.5,     // 1 / 0.40 = 2.5x — minimum healthy ROAS
  roasGoodScale:        4.0,     // > 4x là winner đáng scale
  roasExcellent:        6.0,     // > 6x scale aggressive

  // ── Pancake attribution (xem Section 11) ──
  pancakeAttributionWindow: 30,  // ngày — match lead → order trong 30 ngày
  pancakeMinAttribution:    0.5, // confidence threshold để attribute (0-1)

  // ── CPL (Cost Per Lead) per product group — FB ADS ONLY ──
  // ✅ TÍNH TỪ DATA THẬT (90 ngày 2026-01-29 → 2026-04-28)
  //    LỌC: chỉ orders qua nhân viên DUY + PHƯƠNG NAM (FB ads team)
  //    KHÔNG INCLUDE: Google Ads, Hotline, Zalo OA, walk-in
  // Formula: maxCPL = AOV × leadCloseRate(0.65) × costRatioTarget(0.40) = AOV × 0.26
  leadCloseRate: 0.65,
  
  // Active FB groups (đang có order trong 90d):
  cplTargets: {
    MAY_DO:            655000,    // AOV 2,520,000 × 0.26 (152 đơn) — chủ yếu D1 standard
    CAMERA_VIDEO_CALL: 279000,    // AOV 1,072,000 × 0.26 (222 đơn) — DA8.1 winner
    GHI_AM:            328000,    // AOV 1,260,000 × 0.26 (108 đơn) — DR1 only
    NOMA:              56000,     // AOV  216,000 × 0.26 (2,971 đơn) — volume play, 911+922
  },
  
  // Inactive FB groups — SKIP optimization (không bán qua FB Ads):
  inactiveGroups: ["CAMERA_4G", "CAMERA_WIFI", "DINH_VI", "CHONG_GHI_AM"],
  
  // Average:
  // Total revenue 90d: 1,400,159,000 VND, total orders: 3,453
  // Avg AOV: 405,491 VND, Avg Max CPL: 105,428 VND
  
  // ⚠ Strategic notes:
  // - NOMA = volume play (31 đơn/ngày), Max CPL chỉ 56K → cần broad audience, cheap ad
  // - MAY_DO = premium (D1 = 97% revenue), Max CPL 655K → có thể bid mạnh
  // - DA8.1 = main camera SKU, 222 đơn 90d → moderate volume
  // - DR1 = chỉ 1 SKU bán được, các DR khác (DR4, DR8) chưa có conversion qua FB

  // ── Cron schedule ──
  // 4 lần/ngày: 9h, 13h, 17h, 21h giờ VN
  cronSchedule: "0 2,6,10,14 * * *",   // UTC = VN-7h: 02=9VN, 06=13VN, 10=17VN, 14=21VN

  // ── Alert channel ──
  alertChannel: "telegram",       // Telegram bot (cần TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars)
  alertOnSeverity: ["critical","high"],  // chỉ ping critical + high, medium chỉ trên dashboard

  // ── Decision windows ──
  evaluationWindow:        7,        // ngày
  minSpendBeforeJudge:     500000,   // VND
  minLeadsBeforeJudge:     5,        // tối thiểu 5 lead mới đánh giá CPL
  minImpressionsBeforeJudge: 5000,

  // ── Frequency thresholds ──
  frequencyHighWarning: 3.5,
  frequencyKill:        5.0,

  // ── CTR / CPC thresholds ──
  ctrCriticalLow:  0.005,           // 0.5%
  ctrPoor:         0.015,           // 1.5%
  ctrAcceptable:   0.025,           // 2.5%+

  cpcCriticalHigh: 8000,
  cpcAcceptable:   5000,

  // ── Scale rules ──
  scaleStepPct:    20,              // +20% mỗi lần
  scaleCooldown:   72,              // 72h
  scaleMaxStepsPerWeek: 3,          // tránh scale quá đà

  // ── Lookback for trends ──
  trendDays:       7,
  declineThreshold: 0.20,
  
  // ── Approval flow (L1 mode) ──
  approvalRequired:        true,    // BẮT BUỘC user duyệt từng action
  pendingExpireHours:      72,      // pending suggest > 72h tự expire
  parallelApprovalLimit:   10,      // max 10 pending tại 1 thời điểm
};
```

---

## 3. Categories of rules (10 nhóm, ~40 rules)

### 🔴 Category 1: KILL — Pause underperformers (luôn cần user approve)

| ID | Rule | Trigger | Suggested Action |
|---|---|---|---|
| K01 | High spend + 0 lead | spend > 2× cplTarget AND complete_registrations == 0 AND impressions > 5K | "Suggest pause: spend X, 0 lead, max ngân sách" |
| K02 | CPL > 1.5× target | CPL > 1.5 × cplTarget AND leads ≥ 5 | "Suggest: CPL X (target Y), pause hoặc giảm bid 30%" |
| K03 | CTR critical low | CTR < 0.5% AND spend > 200K AND impressions > 5K | "Suggest pause: CTR X% rất thấp, ad nội dung sai target" |
| K04 | Frequency kill | frequency > 5.0 AND spend > 300K | "Suggest pause: frequency 5+, audience đã saturate" |
| K05 | Cost ratio quá cao | spend / pancake_revenue > 0.60 AND pancake_revenue > 0 AND running_days ≥ 7 | "Suggest pause: chi phí 60%+ doanh thu, lỗ ròng sau VAT + COGS" |
| K06 | Disapproved | ad_review_feedback contains rejection | "Alert: ad disapproved, lý do X — cần sửa creative" |
| K07 | No revenue 7d | leads > 10 AND pancake_revenue == 0 AND running_days ≥ 7 | "Lead chất lượng kém: 10+ lead nhưng 0 đơn — review angle hoặc audience" |

### 🟢 Category 2: SCALE — Tăng budget winners ⭐ PRIORITY 1

| ID | Rule | Trigger | Suggested Action |
|---|---|---|---|
| S01 | Strong performer | ROAS > 4.0 AND CPL < 0.7× cplTarget AND spend > 200K AND running_days ≥ 3 | "Scale: tăng budget +20%" |
| S02 | Excellent ROAS | pancake ROAS > 6.0 AND running_days ≥ 5 | "Scale aggressive: +30-50%, winner ổn định" |
| S03 | High CTR + low CPL | CTR > 3% AND CPL < cplTarget AND last_3_days_avg stable | "Scale +30%, đây là winner ổn định" |
| S04 | Cost ratio xuất sắc | spend / pancake_revenue < 0.25 AND pancake_revenue > 1M | "Cost ratio 25% chỉ — scale aggressive" |
| S05 | Impression share opportunity | reach growing 20%+ daily AND CPL stable | "Tăng budget để tận dụng momentum" |
| S06 | Replicate winner | adset top 10% performance | "Duplicate sang audience tương tự / new geo" |
| S07 | Lead → Order rate cao | leads → pancake order rate > 40% AND volume ≥ 10 | "Audience chất lượng cao — scale + ưu tiên LAL từ buyer" |

### 🟡 Category 3: CREATIVE FATIGUE — Refresh hình ảnh/copy

| ID | Rule | Trigger | Action |
|---|---|---|---|
| F01 | Frequency rising | frequency > 3.5 AND running > 7 days | "Cần creative mới, audience đã thấy nhiều lần" |
| F02 | CTR declining trend | CTR_this_week < CTR_last_week × 0.8 | "CTR giảm 20% — refresh creative" |
| F03 | Engagement drop | engagement_rate dropping 25%+ | "Audience mất hứng — A/B test angle mới" |
| F04 | Old creative | running > 14 days | "Refresh: chạy quá lâu, không phụ thuộc metric" |

### 🎯 Category 4: AUDIENCE — Refine targeting

| ID | Rule | Trigger | Action |
|---|---|---|---|
| A01 | Demographic underperformer | gender/age segment có CPA > 2× target | "Exclude segment này khỏi targeting" |
| A02 | Geo underperformer | tỉnh/thành có CPA > 1.5× target AND conv > 0 | "Loại trừ tỉnh, focus HCM/HN/lớn" |
| A03 | Audience overlap | 2+ adset có >30% overlap (Audience Insights) | "Merge adset, tránh tự cạnh tranh" |
| A04 | Lookalike refresh | LAL audience > 90 ngày | "Tạo LAL mới từ buyer 30 ngày gần đây" |
| A05 | Retargeting too narrow | retargeting audience < 1000 | "Mở rộng window 7→14→30 ngày" |

### 💰 Category 5: BUDGET — Phân bổ ngân sách

| ID | Rule | Trigger | Action |
|---|---|---|---|
| B01 | Concentration risk | 1 campaign > 70% total spend | "Phân bổ đều hơn, risk single point of failure" |
| B02 | Underfunded test | testing campaign < 10% total spend | "Tăng budget testing để có data nhanh hơn" |
| B03 | Budget pacing alert | daily spend > 1.3× target AND còn nhiều ngày trong tháng | "Slow down: giảm bid 20% tránh hết budget" |
| B04 | Daily budget cap hit | hit cap > 80% lần / ngày | "Budget quá thấp, loss volume — tăng budget" |
| B05 | 70/20/10 framework | violation of 70% winners / 20% scaling / 10% testing | "Re-balance budget allocation" |

### 📊 Category 6: AD STRUCTURE — Cấu trúc

| ID | Rule | Trigger | Action |
|---|---|---|---|
| ST01 | Too many ads in adset | adset có > 6 ads active | "Pause low performer, FB ko optimize được nhiều ads" |
| ST02 | Single ad in adset | adset chỉ 1 ad | "Thêm 2-3 variants để test creative" |
| ST03 | Adset budget too low | adset budget < 50K/day | "Quá ít data, không học được audience" |
| ST04 | Stale ad in winner adset | ad chạy > 21 ngày trong adset top | "Refresh để duy trì momentum" |
| ST05 | Mixed objectives | adset có ad CONVERSION + ad ENGAGEMENT | "Tách thành 2 adset riêng cho mỗi objective" |

### ✏️ Category 7: CONTENT QUALITY (Audit creative)

| ID | Rule | Trigger | Action |
|---|---|---|---|
| C01 | Headline missing USP | AI scan: hook không có tính năng cụ thể | "Sửa hook theo template Doscom 8 bước" |
| C02 | No price in description | description không nhắc giá/KM | "Thêm anchor giá để qualify lead" |
| C03 | Generic CTA | CTA = "Tìm hiểu thêm" thay vì "Đặt mua ngay" | "Đổi CTA theo intent (purchase/lead-gen)" |
| C04 | No bảo hành | content thiếu dòng "Bảo hành 12 tháng..." | "Add Bước 6a của template Doscom" |
| C05 | URL không tracking | URL thiếu UTM hoặc fbclid | "Thêm UTM để track GA4" |
| C06 | Image text > 20% | OCR detect text > 20% diện tích | "Giảm text trên ảnh để tránh penalty" |
| C07 | Brand voice không nhất quán | LLM eval vs SYSTEM_PROMPT Doscom | "Sửa theo brand voice" |

### 🎬 Category 8: VIDEO METRICS (nếu là video ad)

| ID | Rule | Trigger | Action |
|---|---|---|---|
| V01 | 25% drop-off cao | video_p25_watched_actions / impressions < 30% | "Hook 3s đầu yếu, sửa lại" |
| V02 | 75% completion thấp | video_p75 / video_p25 < 0.4 | "Video dài quá hoặc giữa video chán" |
| V03 | Average view < 5s | average_video_play_time < 5s | "Hook fail hoàn toàn" |
| V04 | No CTA in video | LLM phân tích: video không có CTA | "Add overlay CTA + voiceover" |

### ⚖️ Category 9: COMPLIANCE & SAFETY

| ID | Rule | Trigger | Action |
|---|---|---|---|
| CO1 | Account quality drop | account_quality_indicator < BELOW_AVERAGE | "Account at risk, pause aggressive ads" |
| CO2 | Multiple disapprovals | > 3 disapproved ads in 7 days | "Review Meta policy, audit content" |
| CO3 | Pixel firing issue | pixel events drop 50% suddenly | "Tracking broken, investigate ngay" |
| CO4 | URL mismatch | LP URL khác URL trong ad / 404 | "Fix URL trước khi tăng spend" |
| CO5 | Sensitive content | content có "phát hiện ngoại tình", "theo dõi vợ chồng" | "Risk policy violation, dùng angle khác" |

### 🔄 Category 10: FUNNEL & ATTRIBUTION

| ID | Rule | Trigger | Action |
|---|---|---|---|
| FU1 | Top funnel stale | TOFU campaign không có refresh creative > 14 ngày | "Refresh để feed funnel" |
| FU2 | Retargeting > prospecting | retargeting spend > 40% total | "Cân lại để có new lead" |
| FU3 | LP → CTA gap lớn | landing_page_views/link_clicks < 0.7 | "Tracking sai hoặc LP load chậm" |
| FU4 | Lead → Order rate thấp | Pancake order / FB lead < 30% AND volume ≥ 10 | "Sales team chưa close lead tốt, hoặc lead xấu" |
| FU5 | Phone capture rate | leads với phone valid / total leads < 80% | "Form chất lượng kém: thiếu validation hoặc fake lead" |

### 📈 Category 11: CONVERSION TREND ⭐ PRIORITY 4 (MỚI)

Track conversion qua các ngày — phát hiện bất thường + xu hướng:

| ID | Rule | Trigger | Action |
|---|---|---|---|
| T01 | Conversion drop tuần này | leads_this_week < leads_last_week × 0.7 | "Lead giảm 30%+ vs tuần trước — kiểm tra ad bị disapproved / bid / audience" |
| T02 | Conversion drop ngày | leads_today < avg_leads_7d × 0.5 | "Hôm nay lead giảm 50% — có sự cố? (account quality, pixel, holiday)" |
| T03 | Conversion spike (positive) | leads_today > avg_leads_7d × 1.8 | "Lead tăng 80%+ — phát hiện trigger gì? (creative mới, sự kiện) — ghi nhận để nhân rộng" |
| T04 | Cost trend up | CPL_this_week > CPL_last_week × 1.25 | "CPL tăng 25%+ — audience saturate hoặc creative fatigue" |
| T05 | Cost ratio xấu dần | spend/revenue ratio tăng 3 tuần liên tiếp | "Trend xấu, audit toàn bộ campaign trước khi out of control" |
| T06 | Day-of-week pattern | leads thứ 7-CN < weekday × 0.4 | "Cuối tuần yếu — tăng bid weekday, giảm bid weekend" |
| T07 | Hour pattern | conversion rate theo giờ — peak 19-22h | "Concentrate budget 19-22h (peak conversion VN)" |
| T08 | Lead → POSPancake order trend | conversion rate giảm 25%+ vs 30 ngày trước | "Sales close rate xấu dần — sales team training hoặc lead chất lượng giảm" |
| T09 | Time-to-order tăng | median_days_lead_to_order > 14 days | "Lead chậm convert — có thể do giá, sản phẩm phức tạp, follow-up kém" |
| T10 | Revenue per lead giảm | (Pancake order revenue / FB leads) trend giảm | "AOV giảm — lead có thể rẻ hơn nhưng chất lượng thấp hơn" |

---

## 4. Priority + Execution Order

Mỗi rule có **severity** + **execution priority**:

| Severity | Khi nào trigger | Action timing |
|---|---|---|
| 🔴 CRITICAL | violations dạng K01, K05, K06, CO1, CO3 | Execute ngay (alert + pause) |
| 🟠 HIGH | K02-K04, F01, A01, B03, ST01 | Execute trong cron run kế tiếp |
| 🟡 MEDIUM | S01-S04, F02-F04, A02-A05, B01-B05, ST02-ST05, V01-V04, CO2, CO4-CO5, FU1-FU5 | Recommend vào weekly report |
| 🟢 LOW | C01-C07 (content audit) | Recommend khi user request audit |

**Execution loop (cron hourly):**

```
1. Pull insights (last 7 days, all active campaigns/adsets/ads)
2. Pull ad creatives + targeting
3. For each entity (campaign/adset/ad):
   a. Run all applicable rules (skip if minSpend chưa đạt)
   b. Collect violations
   c. Sort by severity
4. For CRITICAL violations:
   - L3: auto execute (pause/scale)
   - L1/L2: queue for user review + send Slack/Telegram alert
5. For HIGH/MEDIUM:
   - L2/L3 evaluate auto-action eligibility
   - Else: append to weekly report
6. Save state in KV (cooldown tracking)
7. Log decisions to D1 (audit trail)
```

**Cooldown logic:** mỗi rule có cooldown để tránh oscillation (vd scale → metric drop → pause → metric back up → scale → ...). Default 72h cooldown sau action.

---

## 5. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE PAGES FUNCTIONS                                     │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ functions/api/fb-optimize.js                            │    │
│  │ - GET /api/fb-optimize?level=1&dry_run=true             │    │
│  │ - Triggered by: GitHub Actions cron OR manual button    │    │
│  └────────────────────────────────────────────────────────┘    │
│                              │                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ functions/lib/fbAdsRules.js                             │    │
│  │ - 40+ rule definitions (object array)                   │    │
│  │ - evaluate(entity, ruleSet) → violations                │    │
│  │ - Cooldown check via KV                                 │    │
│  └────────────────────────────────────────────────────────┘    │
│                              │                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ functions/lib/fbAdsAPI.js                               │    │
│  │ - Wrap Meta Marketing API calls                         │    │
│  │ - getInsights, pauseAd, scaleBudget, etc.               │    │
│  └────────────────────────────────────────────────────────┘    │
│                              │                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ functions/lib/fbAdsAudit.js (LLM-powered)               │    │
│  │ - Content quality checks (Cat 7) qua Llama 3.3 70B      │    │
│  │ - Brief từ output JSON → recommendations Vietnamese     │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┼─────────────────────┐
       ▼                      ▼                     ▼
┌─────────────┐      ┌─────────────┐       ┌─────────────┐
│  KV cache   │      │  D1 audit   │       │  Telegram/  │
│  (state +   │      │  log (full  │       │  Slack      │
│  cooldown)  │      │  history)   │       │  alerts     │
└─────────────┘      └─────────────┘       └─────────────┘

EXECUTION TRIGGER:
  - GitHub Actions cron mỗi 1h: gọi /api/fb-optimize?level=1 (recommend mode)
  - Dashboard nút "🛡 Optimize ngay": gọi manual với dry_run=true xem trước
```

---

## 6. Dashboard UI plan (L1 approval flow)

Tab mới **"🛡 Optimization Agent"** — 4 widget chính:

### 6.1 Header summary
```
┌─────────────────────────────────────────────────────┐
│ 🛡 FB Ads Optimization Agent                        │
│ Mode: L1 Recommend (manual approve required)        │
│ Last scan: 14:23 · 47 active campaigns checked      │
│ [🔄 Scan Now]  [📜 History]  [⚙ Config]            │
└─────────────────────────────────────────────────────┘
```

### 6.2 Pending recommendations (cần user duyệt)
```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 PENDING APPROVAL (12 actions chờ duyệt)                      │
│                                                                 │
│ 🟢 SCALE — DA8.1 "HCM 30-45" Adset                              │
│ ─ Reason: ROAS 5.2x, CPL 60K (target 80K), 7 ngày stable        │
│ ─ Action: Tăng budget 200K → 240K (+20%)                        │
│ ─ Expected: +8 lead/ngày, +1.5M revenue/ngày                    │
│ ─ Risk: Low (đã chạy stable)                                    │
│ [✅ Chấp nhận]  [⚠ Chấp nhận giảm xuống +10%]  [❌ Bỏ qua]      │
│ [📌 Snooze 24h]                                                 │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ 🔴 KILL — Camera 4G "Tỉnh ABC" Adset                            │
│ ─ Reason: spend 800K trong 7 ngày, 0 lead, CTR 0.3%             │
│ ─ Action: Pause adset                                           │
│ ─ Risk: Mất 1 audience nhưng rõ ràng không hiệu quả             │
│ [✅ Chấp nhận pause]  [💡 Thay vì pause, giảm bid 50%]          │
│ [❌ Bỏ qua]  [📌 Snooze 48h]                                    │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ 🟡 CONTENT — Máy dò D1 Ad "Hook B"                              │
│ ─ Reason: AI audit phát hiện hook không có USP                  │
│ ─ Suggested headline: "🔎 Phát hiện camera ẩn..." (xem full)    │
│ ─ Action: Replace ad copy                                       │
│ [📝 Xem full preview]  [✅ Apply]  [✏ Edit thêm]  [❌ Bỏ qua]   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Conversion trend (Cat 11)
```
┌─────────────────────────────────────────────────────┐
│ 📈 CONVERSION TREND (30 ngày)                       │
│                                                     │
│ Lead/day:  ▁▂▄▅▇▆▆▇▇▆▅▄▃▄▅▆▇█▇▆▅▄▄▃▂▂▁▂▂▃          │
│ CPL/day:   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 65K avg│
│ Cost ratio:36% ✅ (target ≤40%)                     │
│                                                     │
│ This week vs last week:                             │
│   • Leads:        +12% ✅                           │
│   • CPL:          -8% ✅ (cheaper)                  │
│   • Pancake order:+5%  ✅                           │
│   • Cost ratio:   38% → 36% ✅                      │
│                                                     │
│ ⚠ Pattern detected: Saturday-Sunday yếu (-40%)      │
│   → Suggest giảm bid weekend xuống -30%             │
│   [✅ Apply Mon-Fri schedule]  [Skip]              │
└─────────────────────────────────────────────────────┘
```

### 6.4 History + audit log
```
┌─────────────────────────────────────────────────────┐
│ 📜 RECENT ACTIONS (last 7 days)                     │
│ • 2026-04-29 14:30  ✅ User approved scale +20% ... │
│ • 2026-04-29 09:15  ❌ User rejected pause ad XYZ   │
│ • 2026-04-28 16:00  ✅ User approved content edit   │
│ • ...                                               │
│ [Export CSV]  [Compare before/after]                │
└─────────────────────────────────────────────────────┘
```

---

## 7. Edge cases & safety guards

| Edge case | Mitigation |
|---|---|
| API rate limit Meta | Exponential backoff, cache insights 30 min |
| Wrong action gây mất tiền | Dry-run mode mặc định, user approve action lớn |
| Race condition (2 rules conflict) | Severity priority + cooldown |
| Currency mismatch (USD vs VND) | Normalize tất cả về VND ở data layer |
| Account suspension | Detect early, fallback notify only |
| New ad không đủ data | minSpend + minImpressions check trước khi judge |
| User override | Manual "Snooze rule for X hours" trên dashboard |
| Doscom-specific terms | Whitelist từ trong content (vd "máy dò nghe lén" KHÔNG flag) |

---

## 8. Phase rollout (sắp xếp theo priority user)

| Phase | Scope | Effort | Outcome |
|---|---|---|---|
| **Phase 0 — Foundation** (~1 tuần) | (a) Pancake attribution layer (Module 10.5) (b) Data fetcher FB insights (c) Tab UI shell | 3 ngày | Có data thật để rule engine làm việc |
| **Phase 1 — SCALE detection** ⭐ priority 1 | Cat 2 (SCALE 7 rules) + Cat 11 (TREND 10 rules) + UI approval flow | 2 ngày | Detect winner + alert user duyệt scale |
| **Phase 2 — CONTENT + VIDEO audit** ⭐ priority 2-3 | Cat 7 (CONTENT 7 rules) + Cat 8 (VIDEO 4 rules) qua Llama 70B | 2 ngày | AI audit creative chuyên sâu, Vietnamese |
| **Phase 3 — KILL + ALERT** | Cat 1 (KILL 7 rules) + Cat 6 (Compliance) + alerts | 1.5 ngày | Phát hiện ad lỗ + suggest pause |
| **Phase 4 — STRUCTURE + AUDIENCE** | Cat 3 (FATIGUE) + Cat 4 (AUDIENCE) + Cat 5 (BUDGET) + Cat 6 (STRUCTURE) | 2 ngày | Cover full optimization toolkit |
| **Phase 5 — Refinement** | Edge cases, weekly reports, snooze logic, learning rate | ongoing | Production hardened |

**Tổng effort phase 0-4: ~10-11 ngày code.** Có thể chạy bản preview Phase 1 sau ~1 tuần.

---

## 9. Câu hỏi CÒN LẠI cần user trả lời

✅ **Đã confirm** (locked ở section 0 đầu file):
- Conversion event: `complete_registrations`
- Pancake attribution: lead → POSPancake order
- Cost ratio target: 40%
- Action mode: L1 strict, manual approve
- Priority: SCALE → CONTENT → VIDEO → TREND

❓ **Còn cần confirm**:

1. **AOV (giá trung bình mỗi đơn) cho 8 nhóm SP** — để tính CPL ceiling chính xác:
   ```
   CAMERA_VIDEO_CALL: ___ VND  (DA8.1)
   CAMERA_4G:         ___ VND
   CAMERA_WIFI:       ___ VND
   MAY_DO:            ___ VND
   GHI_AM:            ___ VND
   DINH_VI:           ___ VND
   CHONG_GHI_AM:      ___ VND
   NOMA:              ___ VND
   ```
   Hoặc: tôi tự pull data Pancake 90 ngày qua → tính AOV trung bình cho từng nhóm tự động. Bạn ưu tiên cách nào?

2. **Lead close rate trung bình của Doscom** — % lead chốt thành đơn:
   ```
   Trung bình toàn shop: ___% (vd 25%)
   Hoặc per-product nếu khác biệt rõ
   ```

3. **Channel alert** — bạn muốn nhận thông báo qua đâu khi có suggest mới?
   - [ ] Telegram bot (recommend, có sẵn webhook đơn giản)
   - [ ] Slack workspace
   - [ ] Email
   - [ ] Chỉ trên dashboard, không cần notification ngoài

4. **Cron tần suất** — agent chạy scan mỗi:
   - [ ] 1 giờ (real-time, hơi nhiều)
   - [ ] 4 giờ (vừa đủ — 6 lần/ngày)
   - [ ] 12 giờ (sáng + chiều)
   - [ ] Chỉ 1 lần/ngày 8h sáng

5. **Whitelist từ ngữ Doscom** — list từ ngữ Cat 7 (content audit) KHÔNG flag dù có thể nhạy cảm:
   - "máy dò nghe lén" ✅ (USP core, không penalty)
   - "phát hiện camera ẩn" ✅
   - "định vị xe" ✅
   - "bắt vợ ngoại tình" ❌ (nên flag — Meta cấm)
   - Bạn add thêm gì?

6. **Có nhóm SP nào bạn muốn skip optimization** không? (vd NOMA volume thấp, không quan tâm)
   ```
   Skip nhóm: ___
   ```

7. **Approval expire** — nếu user không click chấp nhận trong bao lâu thì auto-cancel suggest đó?
   - [ ] 24h
   - [ ] 72h (recommend — đủ thời gian review weekend)
   - [ ] 7 ngày
   - [ ] Không expire (manual clear)

8. **Bạn muốn agent này có "Auto mode" cho 1 vài rule cụ thể** không?
   Vd "Refresh creative khi frequency > 5" — auto refresh không cần duyệt vì rủi ro thấp.
   - [ ] Không, mọi action manual
   - [ ] Có, nhưng chỉ 1-2 rule rủi ro thấp (tôi list ra)

9. **History audit log lưu bao lâu**?
   - [ ] 30 ngày (đủ debug + tránh KV phình)
   - [ ] 90 ngày (full quarter review)
   - [ ] Mãi mãi (sẽ chuyển sang D1 SQL)

10. **Báo cáo định kỳ** — bạn muốn nhận summary email/Telegram:
    - [ ] Daily 8h sáng
    - [ ] Weekly Monday
    - [ ] Cả 2
    - [ ] Không cần

---

## 10.5 Pancake Attribution Layer (mới)

Doscom KHÔNG track Purchase trên FB Pixel → cần map ngược từ Pancake/POSPancake về FB campaign để tính ROAS.

### Cách matching:

**Phương án A: Phone number matching**
```
FB lead form → captures phone → FB Marketing API trả phone trong leads
                                          │
                                          ▼
                                 Match với Pancake order phone
                                          │
                                          ▼
                                  Order revenue → attribute back
                                  to campaign/adset/ad ID
```

**Phương án B: Lead form ID + Pancake conversation ID**
- FB lead form có `lead_id` → Pancake nhận lead có `conversation_id`
- Map qua phone hoặc Zalo/email
- Sau khi order → POSPancake có order_id liên kết với conversation

**Phương án C: UTM params trên LP**
- Nếu user click ad → LP → form (không phải FB lead form) → Pancake
- LP capture UTM `utm_source=fb&utm_campaign=XYZ` vào hidden field
- Order Pancake có UTM string → attribute lại

### Module mới: `functions/lib/pancakeAttribution.js`

```javascript
// Cron: hằng ngày (3h sáng VN) job
export async function rebuildAttribution(env) {
  // 1. Pull FB leads từ Marketing API (last 30 days)
  //    GET /act_<id>/insights?fields=actions[complete_registrations],
  //                                  ad_id,adset_id,campaign_id&time_range=30d
  
  // 2. Pull lead detail to get phone
  //    GET /<lead_id>?fields=field_data,created_time
  
  // 3. Pull Pancake orders (last 30 days) — qua existing Pancake API
  //    Match by phone (normalize: strip +84, leading 0)
  
  // 4. Build attribution table:
  //    { lead_id, ad_id, adset_id, campaign_id, phone, lead_time,
  //      pancake_order_id, order_total, order_time, days_to_order,
  //      attributed: true/false, confidence }
  
  // 5. Save to D1 (or KV if small):
  //    table fb_attribution { lead_id PK, ...all fields above }
  
  // 6. For each campaign, aggregate:
  //    - total_leads, total_orders, total_revenue
  //    - cost_revenue_ratio = spend / total_revenue
  //    - lead_close_rate = orders / leads
  //    - avg_days_to_order
}
```

### Confidence scoring:
| Match method | Confidence |
|---|---|
| Phone exact + same lead_time + 30 days window | 1.0 (high) |
| Phone exact + within 60 days | 0.7 (medium) |
| Phone partial + name similar | 0.5 (low) |
| No match | 0 (uncategorized order) |

### Edge cases:
- **Lead 1 phone, 2 orders**: attribute cả 2 orders (revenue stack)
- **Order phone không match lead nào**: organic / direct → exclude khỏi FB ROAS
- **Lead → order > 60 ngày**: counted nhưng confidence thấp
- **1 phone, 2 leads từ 2 campaign**: attribute order cho campaign **gần ngày order nhất** (last-touch model)
- **Privacy GDPR**: nếu user opt-out của FB lead, dùng phone hash matching

---

## 11. References

- [AgriciDaniel/claude-ads](https://github.com/AgriciDaniel/claude-ads) — 250+ audit checks
- [luukalleman/meta-ads-system](https://github.com/luukalleman/meta-ads-system) — rule engine pattern
- [irinabuht12-oss/google-meta-ads-ga4-mcp](https://github.com/irinabuht12-oss/google-meta-ads-ga4-mcp) — MCP data layer
- [Meta Marketing API docs](https://developers.facebook.com/docs/marketing-api)
- Existing Doscom code: `functions/api/create-campaign.js`, `functions/lib/ad-prompts.js`

---

**Bạn review xong → confirm các tham số ở mục 9 → tôi implement Phase 1 (~2-3 ngày).**

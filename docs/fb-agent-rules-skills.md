# Agent FB Ads — Rules & Skills

> Tài liệu mô tả logic chấm điểm + ra verdict của AI Agent FB Ads ("Sarah Strategist").
> Reflect implementation hiện tại trong [`functions/api/agent-fb-ai.js`](../functions/api/agent-fb-ai.js) + [`functions/lib/fbAdsHelpers.js`](../functions/lib/fbAdsHelpers.js).
>
> **Last updated:** 2026-05-08 (commit `17055d9` — thêm CTR all + CTR link + Link click + benchmark per SP)

---

## 🎯 Tổng quan

Agent FB Ads là **AI assistant** dùng Claude Sonnet 4.6 (qua Cloudflare AI Gateway) để phân tích campaign và đưa hành động cụ thể. User truy cập qua tab **"Agent FB Ads"** trên dashboard.

- **6 mode**: tương ứng 6 nút/use-case khác nhau.
- **4 skill prompt**: mỗi skill là 1 system prompt chuyên biệt, ghép theo mode.
- **5 dimension scoring** (cho `optimize_campaign`) + **8 nhóm scoring 100%** (cho `audit_account`).
- **Verdict tree** 5 nhãn: `SCALE` / `KEEP` / `REFRESH` / `AUDIENCE` / `PAUSE`.
- **Cache 24h** (key gồm date) → F5 cùng ngày = no cost. Force refresh khi user click lại.

---

## 📊 CTR Benchmark per nhóm SP

Extract từ `data/fb-ads-data.json` 90 ngày × 7 ad accounts (2026-05-08).

| Nhóm SP | CTR all | CTR link | Link/Click | CPL benchmark |
|---|--:|--:|--:|--:|
| **MAY_DO** | 1.69% | 1.03% | 61.2% | 359,600đ |
| **CAMERA_VIDEO_CALL** (DA8.1) | 2.59% | 1.63% | 63.0% | 269,547đ |
| **GHI_AM** (DR1) | 3.30% | 1.98% | 60.0% | 227,341đ |
| **NOMA** | 1.91% | 1.16% | 61.0% | 105,640đ |

> **Lưu ý**: Agent **bắt buộc dùng benchmark NHÓM** thay vì "chuẩn FB chung 2-3%". VD campaign NOMA có CTR 1.5% là `0.79× benchmark NOMA 1.91%` — không phải "yếu so chuẩn FB 2%". Benchmark stored trong [`fbAdsHelpers.js` `CTR_BENCHMARKS`](../functions/lib/fbAdsHelpers.js).

---

## 🛠️ Skills (4 system prompts)

### Skill 1 — `fb_overview` (audit account 8 nhóm 100%)

Dùng cho mode `audit_account`, `audit_account_json`, `optimize_campaign`, `staff_overview`, `ask`.

| # | Nhóm | Trọng số | Tiêu chí |
|--:|---|--:|---|
| 1 | Tracking | 15% | Pixel + lead form working, leads count khớp Pancake |
| 2 | Creative | 20% | CTR all + CTR link + Link/Click ratio so benchmark nhóm SP |
| 3 | Audience | 15% | Demographics targeting hiệu quả |
| 4 | Cost ratio | 20% | Spend/Revenue ≤ 40% (= ROAS ≥ 2.5x) |
| 5 | Profit/SP | 15% | Margin theo từng nhóm SP |
| 6 | Funnel | 10% | Lead → Pancake order rate (target 65%) |
| 7 | Frequency | 5% | Frequency < 4 |
| 8 | Compliance | 5% | Disapprovals, account quality |

### Skill 2 — `fb_optimize` (campaign optimization 5 dimensions)

Dùng cho mode `optimize_campaign`. Mỗi dimension chấm 1-10.

| # | Dimension | 9-10 (Tốt nhất) | 5-6 (Đạt) | 1-2 (Yếu) |
|--:|---|---|---|---|
| 1 | **SPEND_EFFICIENCY** | CPL ≤ 50% benchmark | CPL 80-120% | CPL > 200% |
| 2 | **VOLUME** | link_clicks/ngày > 100 + tăng > 30% | 10-30/ngày | < 3/ngày |
| 3 | **CTR_QUALITY** | CTR all > 1.5× benchmark + Link/Click ≥ 60% | CTR 0.8-1.0× bm | CTR < 0.5× bm hoặc Link/Click < 30% |
| 4 | **CLICK_QUALITY** ⭐ | Link/Click > 75% | 45-60% | < 30% (click rác) |
| 5 | **TREND** | Link clicks/ngày tăng > 20% + CPL giảm | Ổn định ±5% | Giảm > 30% hoặc CPL tăng > 30% |

### Skill 3 — `fb_funnel` (funnel diagnosis)

Dùng cho mode `audit_funnel`, `ask`. Funnel 6 step:

```
Impression → Click → Link Click → Landing Page View → Lead → Pancake Order
```

Check drop rate per step. Sales DUY + PHƯƠNG NAM convert lead → đơn ~65%.

### Skill 4 — `fb_staff_overview` (đánh giá nhân sự)

Dùng cho mode `staff_overview`. Output:
- `aggregate_mtd`: tổng spend/revenue/profit MTD của staff (filter chỉ source_groups[STAFF_KEY]).
- `groups_breakdown`: revenue/orders per nhóm SP của staff (NOMA, MAY_DO, ...).
- `top_campaigns` (5) + `weak_campaigns` (3).
- `kpi_share`: % staff đóng góp vào KPI tháng tổng.
- `monthly_action_plan`: 4 weekly actions cho staff.

---

## 📐 Diagnostic Rules

### Rule 1 — Link/Click ratio (chất lượng click)

| Link/Click | Diagnosis | Action gợi ý |
|---|---|---|
| **< 30%** | 🔴 Click rác dominant (like/share/profile) | REFRESH CTA + audit landing page |
| **30-50%** | 🟡 Mixed quality | REFRESH creative |
| **50-70%** | ✅ Healthy (chuẩn FB ~60%) | Focus CTR all để SCALE |
| **> 70%** | ⚠️ Audience chất, hook yếu | REFRESH hook (giữ CTA) |

### Rule 2 — CTR all so benchmark nhóm

| CTR all vs benchmark | Action |
|---|---|
| > 1.5× benchmark **AND** link/click ≥ 50% | **SCALE** |
| 0.8-1.5× benchmark | KEEP (tune nhỏ) |
| 0.5-0.8× benchmark **AND** link/click ≥ 60% | AUDIENCE expand (hook yếu) |
| < 0.5× benchmark **OR** link/click < 30% | REFRESH/PAUSE |

### Rule 3 — Volume gate cho SCALE

| Link clicks/ngày | Note |
|--:|---|
| < 30 | KHÔNG SCALE — phải AUDIENCE expand trước (top funnel hẹp) |
| 30-100 | SCALE moderate (+15-20%) |
| > 100 | SCALE aggressive (+30-50%) nếu CPL ≤ 80% benchmark |

### Rule 4 — Verdict dựa Margin (Profit attribution)

Khi `profit_attribution.mapping_status="ok"`:

| Group margin | Verdict bắt buộc |
|---|---|
| < 5% (gần lỗ) | **REFRESH/PAUSE** — KHÔNG SCALE dù CPA tốt |
| 5-15% | KEEP — chấp nhận, theo dõi |
| 15-25% | SCALE moderate (+15-25% budget) |
| > 25% | SCALE aggressive (+30-50% budget) |

---

## 🩺 Creative Diagnostic — 4 trạng thái

Ma trận **CTR all × Link/Click**:

| Trạng thái | Triệu chứng | Fix |
|---|---|---|
| **HEALTHY** ⭐ | CTR all ≥ benchmark + Link/Click 50-70% | SCALE / KEEP |
| **CLICK_RAC** 🔴 | CTR cao + Link/Click < 40% | REFRESH CTA + audit landing |
| **HOOK_YEU** ⚠️ | CTR < 0.7× bm + Link/Click > 70% | REFRESH creative (giữ CTA) |
| **YEU_TOAN_DIEN** 🔴 | CTR < 0.5× bm + Link/Click < 40% | PAUSE / AUDIENCE / REFRESH all |

---

## 🚦 Verdict Decision Tree

### **SCALE** (verdict_color: "green")
- `AVG score ≥ 7.5` AND
- `CPL < 80% benchmark nhóm` AND
- `CTR all ≥ 1.0× benchmark` AND
- `link_click_ratio ≥ 50%` AND
- `link_clicks/ngày ≥ 30` AND
- `deltas.cpa_pct ≤ 10`
- → BẮT BUỘC xuất `scale_plan` 3 cách (budget / nhân ad set / creative).

### **KEEP** (verdict_color: "green" hoặc "yellow")
- `AVG score 5-7.5`, CPL gần benchmark (80-120%), không biến động xấu so kỳ trước.
- WHY phải nêu rõ TẠI SAO KHÔNG SCALE — trích số cụ thể (vd "CTR all 1.4% < 1.5× benchmark NOMA 1.91%").

### **REFRESH** (verdict_color: "yellow") — chia 2 sub-mode
- **REFRESH_HOOK**: `Link/Click ≥ 60%` (audience chất, hook yếu) → đổi 2-3 creative, hook mới. Giữ CTA + landing.
- **REFRESH_CTA**: `Link/Click < 40%` (click rác) → đổi CTA button + audit landing. KHÔNG đổi creative chính.

### **AUDIENCE** (verdict_color: "yellow")
- `CTR all < 0.5× benchmark` AND `link_clicks/ngày < 10`
- HOẶC `link_click_ratio ≥ 70%` nhưng `link_clicks/ngày < 30` (audience chất nhưng quá hẹp)
- Action: đổi audience (LAL buyer 30d hoặc interest mới)

### **PAUSE** (verdict_color: "red")
- `CPL > 2× benchmark` AND `spend > 200K` AND `conversions ≤ 1`
- HOẶC `deltas.cpa_pct > 50` AND `delta.conv_per_day_pct < -30`
- HOẶC `link_click_ratio < 25%` kéo dài (click rác cực đoan)

---

## 📤 Output Schema (mode `optimize_campaign`)

```json
{
  "verdict": "SCALE | KEEP | REFRESH | AUDIENCE | PAUSE",
  "verdict_color": "green | yellow | red",
  "summary": "...",
  "comparison_summary": "...",
  "comparison_with_previous_analysis": null | { ... },
  "profit_analysis": null | { ... },
  "performance": {
    "spend_vnd": 1500000,
    "conversions": 18,
    "cpa_vnd": 83333,
    "ctr_pct": 1.4,
    "ctr_link_pct": 0.6,
    "link_clicks": 22,
    "link_click_ratio_pct": 42.9,
    "rating_overall": 6
  },
  "creative_diagnostic": {
    "state": "CLICK_RAC | HOOK_YEU | HEALTHY | YEU_TOAN_DIEN",
    "evidence": "[≥40 từ] CTR all 3.2% > 1.7× benchmark NOMA. Link/Click 28% < 40%...",
    "recommended_fix": "Đổi CTA + audit landing"
  },
  "evaluation": {
    "spend_efficiency": { "score": 1-10, "note": "..." },
    "volume":           { "score": 1-10, "note": "..." },
    "ctr_quality":      { "score": 1-10, "note": "..." },
    "click_quality":    { "score": 1-10, "note": "..." },
    "trend":            { "score": 1-10, "note": "..." }
  },
  "action": {
    "what": "Tăng daily budget từ 500K → 600K (+20%) trong 3 ngày...",
    "why": "[≥40 từ] Lý do dựa scores + so kỳ trước + tại sao không chọn các action khác",
    "impact_expected": "+5-8 đơn/ngày, +250K LN/ngày",
    "risk": "low | medium | high",
    "risk_note": "..."
  },
  "scale_plan": null | {
    "method_1_budget": "Tăng dần 20%/24h...",
    "method_2_duplicate": "Copy ad set + đổi audience...",
    "method_3_creative": "Thêm 2-3 creative mới...",
    "recommended": "1 | 2 | 3 + giải thích",
    "budget_target_vnd": 600000,
    "increase_pct": 20
  },
  "next_check": {
    "after_days": 3,
    "metric_to_watch": "CPA + đơn/ngày + frequency",
    "threshold_revert": "..."
  }
}
```

---

## 💡 Ví dụ ứng dụng — 6 scenarios

| # | CTR all | CTR link | Link/Click | Diagnosis (state) | Verdict |
|---|--:|--:|--:|---|---|
| A | 3.0% | 2.0% | 67% | HEALTHY ⭐ | **SCALE** |
| B | 3.0% | 0.5% | 17% | CLICK_RAC 🔴 | **REFRESH** (sub: CTA) |
| C | 1.0% | 0.9% | 90% | HOOK_YEU ⚠️ | **REFRESH** (sub: HOOK) |
| D | 0.8% | 0.3% | 38% | YEU_TOAN_DIEN 🔴 | **PAUSE** / AUDIENCE |
| E | 1.0% | 0.6% | 60% | OK ratio nhưng CTR yếu | **AUDIENCE** |
| F | 5.0% | 3.0% | 60% | HEALTHY 🔥 (CTR > 2× bm) | **SCALE aggressive** |

---

## 🧠 History tracking

Mỗi lần phân tích campaign, agent lưu vào KV (max 10 entries/campaign):

```json
{
  "analyzed_at": "2026-05-08 14:30",
  "verdict": "SCALE",
  "performance": { ... },
  "evaluation_scores": { spend_efficiency, volume, ctr_quality, click_quality, trend },
  "action_summary": "..."
}
```

Lần phân tích kế, agent đọc history → đánh giá xem hành động trước có hiệu quả không:
- Nếu 3 lần liên tiếp SCALE mà CPA giảm đều → tiếp tục SCALE mạnh hơn.
- Nếu lần trước SCALE mà CPA tăng > 20% → REVERT (PAUSE/giảm budget).
- Nếu 2 lần KEEP nhưng CPA bắt đầu giảm → chuyển SCALE thử.
- Nếu 3 lần REFRESH mà CTR vẫn yếu → đổi sang AUDIENCE.

---

## 🔧 Update benchmark khi nào

Benchmark trong [`fbAdsHelpers.js` `CTR_BENCHMARKS`](../functions/lib/fbAdsHelpers.js) là **constant** — phải update thủ công khi:
- Có ad account mới hoặc nhóm SP mới.
- Sau 3 tháng (data drift).
- User feedback agent đánh giá sai vì benchmark cũ.

Cách regenerate (trên local, có file `data/fb-ads-data.json` mới nhất):

```powershell
$j = Get-Content -Raw -Path "data/fb-ads-data.json" -Encoding UTF8 | ConvertFrom-Json
# (Script tính per nhóm SP — tương tự PowerShell trong chat 2026-05-08)
```

Hoặc trigger workflow GitHub Actions tạm dạng `compute-ctr-benchmarks.yml`.

---

## 📚 File liên quan

- [`functions/api/agent-fb-ai.js`](../functions/api/agent-fb-ai.js) — Cloudflare Pages Function chính.
- [`functions/lib/fbAdsHelpers.js`](../functions/lib/fbAdsHelpers.js) — Helper compact data + benchmark.
- [`agent-facebook-doscom.html`](../agent-facebook-doscom.html) — UI agent.
- [`data/fb-config.json`](../data/fb-config.json) — Mapping account → staff/nhóm SP + KPI tháng.
- [`docs/fb-ads-rule-engine.md`](./fb-ads-rule-engine.md) — Rule engine offline (Draft v2, 2026-04-30) — reference.

---

**End of doc.** Khi update agent rule (commit code) → cập nhật file này (`Last updated` + section thay đổi).

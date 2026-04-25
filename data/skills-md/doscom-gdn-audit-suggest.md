---
name: doscom-gdn-audit-suggest
description: Hệ thống audit chuyên sâu Google Display Network (GDN) và Performance Max của Doscom Holdings — gộp 2 tính năng (1) chấm điểm 6 nhóm tiêu chí (100 điểm A-F) gồm chất lượng banner/asset, PMax asset rating, placement quality, targeting, đo lường, cấu trúc; (2) đề xuất tạo mới/thay thế banner qua 5 cơ chế (Top Performer Replication, Replace Losing Banner brief, Fill Aspect Ratio Gap, A/B Test Challenger, Seasonal Refresh). Áp dụng skill này khi Duy yêu cầu "audit GDN", "chấm điểm Display Network", "đánh giá banner Google", "phân tích Performance Max", "PMax audit", "kiểm tra placement YouTube", "tìm placement lãng phí", "tối ưu banner Doscom", "đề xuất banner mới", "thay banner GDN", "creative brief cho banner", "A/B test banner", "banner Tết/hè", "thiếu kích thước banner nào", "PMax cần thêm asset gì". KHÔNG dùng cho audit từ khoá Search (dùng doscom-keyword-audit-suggest), audit account tổng (doscom-google-ads-audit), Facebook Ads (doscom-fb-ads), generate ảnh thực (image-create), hoặc viết content/copy thuần (cong-thuc-viet-content-by-noti).
---

# Doscom GDN & Performance Max — Audit + Banner Suggest

> Skill toàn diện cho mảng **Display Network & Performance Max** của Doscom. Gộp 2 tính năng:
> - **Phần A — Audit**: chấm điểm 6 nhóm × 100 điểm cho banner/asset/placement
> - **Phần B — Suggest**: 5 cơ chế đề xuất tạo mới/thay thế banner với brief chi tiết
> 
> Workflow chuẩn: Audit phát hiện vấn đề → Suggest sinh brief banner thay thế → Designer/AI dựng tiếp.

---

## 1. Bối cảnh người dùng

- **Người dùng**: Duy (FB Ads + Google Ads lead, Doscom Holdings)
- **Hệ sinh thái**: 9 nhóm SP (Camera wifi/4G/Video call, Máy dò, Ghi âm, Chống ghi âm, Định vị, NOMA, Khác)
- **Định vị Doscom**: An ninh + Bảo mật cá nhân, ngách an toàn riêng tư
- **Định vị NOMA**: DIY Auto Care chuẩn Mỹ, nam tính, premium đại chúng
- **Mô hình QC**: Performance Max là kênh chính, Display tách riêng
- **Ngân sách Google Ads**: ~272M VND/3 tháng gần nhất
- **Ngôn ngữ**: 100% tiếng Việt
- **Output**: brief banner đầy đủ thông số (designer/AI dựng được)

---

## 2. Triết lý đánh giá GDN

### 2.1 Khác biệt với Search

| Tiêu chí | Search Ads | Display/PMax |
|----------|-----------|--------------|
| Intent người xem | Cao (đang tìm SP) | Thấp (lướt YouTube/báo) |
| CTR baseline | 2-8% | 0,1-0,5% |
| CVR | 3-15% | 0,5-3% |
| View-through conv | Hiếm | Quan trọng |
| Quality signal | Quality Score | Asset Strength + Placement quality |
| Wastage chính | Search term sai | Placement xấu + asset yếu |

### 2.2 Nguyên tắc cốt lõi

- **Banner KHÔNG để bán hàng trực tiếp** — chủ yếu build awareness + retargeting
- **YouTube ≠ Display website ≠ In-app** — phải tách bóc khi chấm
- **PMax che dấu placement** — xin "Asset details + insights" report mới biết
- **View-through window** chỉ tính 1-7 ngày, không quá 30 ngày
- **Brand safety > cost** — banner ở web bậy bạ làm hỏng thương hiệu
- **Mobile-first** — 70%+ traffic GDN từ mobile

### 2.3 Trần CPA Display (Margin-aware)

```
Trần CPA Display = 0.5 × (Giá bán − Giá vốn − VAT 10%)
                 (chặt hơn Search vì conv Display chất lượng thấp hơn)
```

Ví dụ DA8.1 (1.250.000 / vốn 526.759):
- Lãi ròng/đơn = 1.250.000 − 125.000 − 526.759 = 598.241
- Trần CPA Display = 0.5 × 598.241 = **299.120 VND**
- CPA Display > 299K → cảnh báo, > 600K → tạm dừng campaign

### 2.4 Đặc thù brief banner Doscom

- **An ninh / bảo mật**: tone tin cậy, tránh ảnh máu/tội phạm
- **NOMA chăm sóc xe**: tone nam tính, kết quả before/after rõ
- **Mobile-first**: ưu tiên 9:16 + 1:1 + 4:5
- **Color**: Đỏ Doscom (#E63946) urgency / Xanh navy tin cậy
- **Tránh**: ảnh stock generic, chữ overlay nhỏ, background rối, không CTA

---

# PHẦN A — AUDIT (Chấm điểm 6 nhóm × 100 điểm)

## 3. Cấu trúc 6 nhóm chấm điểm

| # | Nhóm | Trọng số | Lý do |
|---|------|---------|-------|
| 1 | **Chất lượng Banner/Asset** | **25%** | Asset là gốc Display |
| 2 | **PMax Asset Rating & Insights** | **20%** | Asset rating quyết định serve |
| 3 | **Placement Quality** | **20%** | Placement xấu = phí + hỏng brand |
| 4 | **Targeting & Audience** | **15%** | Custom Audience, Topic, Demo |
| 5 | **Measurement & Attribution** | **10%** | View-through, conv lag, cross-device |
| 6 | **Cấu trúc Campaign Display** | **10%** | Tách Display khỏi Search |

## 4. Chi tiết các check

### Nhóm 1 — Chất lượng Banner/Asset (25%)

#### 1.1 Image Banner (10 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Tỷ lệ banner có **logo Doscom rõ** | Cao (×3) | ≥90% | 60-90% | <60% |
| Tỷ lệ banner có **text CTA** | Cao (×3) | ≥80% | 50-80% | <50% |
| Aspect ratio coverage (1:1, 1.91:1, 4:5, 9:16) | Cao (×3) | Đủ 4 | 2-3 | ≤1 |
| Tỷ lệ asset **disapproved** | Rất nghiêm trọng (×5) | 0% | <5% | ≥5% |
| Tỷ lệ ảnh có **giá hoặc khuyến mãi** | Trung bình (×1.5) | ≥50% | 20-50% | <20% |
| Tỷ lệ ảnh có **USP nổi bật** | Trung bình (×1.5) | ≥60% | 30-60% | <30% |
| Resolution tối thiểu 1200×628 | Trung bình (×1.5) | 100% | 80-100% | <80% |
| Số biến thể banner / nhóm SP | Cao (×3) | ≥6 | 3-5 | <3 |
| Tỷ lệ ảnh background trắng/đơn giản | Thấp (×1) | 30-70% | <30% hoặc >70% | - |
| Đa dạng **2D pack-shot + lifestyle** | Trung bình (×1.5) | Cả 2 | Chỉ 1 loại | - |

#### 1.2 Video Asset (6 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Video < 30s | Cao (×3) | ≥70% | 40-70% | <40% |
| Hook 5s đầu rõ ràng | Rất cao (×4) | Có | Mơ hồ | Không |
| Subtitle/caption | Cao (×3) | 100% | 50-100% | <50% |
| Logo trong 5s đầu | Trung bình (×1.5) | 100% | 50-100% | <50% |
| Aspect ratio 9:16 cho mobile | Cao (×3) | Có | - | Không |
| CTA cuối video | Cao (×3) | 100% | 50-100% | <50% |

#### 1.3 Text Asset — Headline + Description (4 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Số headline asset (15 max PMax) | Cao (×3) | ≥12 | 8-11 | <8 |
| Số description asset (5 max) | Trung bình (×1.5) | =5 | 3-4 | <3 |
| Tỷ lệ headline có từ khoá SP/USP | Cao (×3) | ≥70% | 40-70% | <40% |
| Headline ngắn ≤30 ký tự | Trung bình (×1.5) | ≥50% | 20-50% | <20% |

### Nhóm 2 — PMax Asset Rating & Insights (20%)

#### 2.1 Asset Strength rating (6 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Asset Group rating **Excellent** | Rất cao (×4) | ≥50% | 25-50% | <25% |
| Asset Group rating **Poor** | Rất nghiêm trọng (×5) | 0% | 1-15% | >15% |
| Tỷ lệ image asset rating "Best" | Cao (×3) | ≥30% | 10-30% | <10% |
| Tỷ lệ image asset rating "Low" | Cao (×3) | <10% | 10-30% | >30% |
| Tỷ lệ video asset rating "Best" | Cao (×3) | ≥30% | 10-30% | <10% |
| Asset bị "Disapproved" 7 ngày qua | Rất nghiêm trọng (×5) | 0 | 1-2 | >2 |

#### 2.2 Audience Signal & Insights (4 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Asset Group có Audience Signal | Cao (×3) | 100% | 50-100% | <50% |
| Tỷ lệ Audience từ **First-party data** | Cao (×3) | ≥40% | 20-40% | <20% |
| Có Search Theme cho mỗi Asset Group | Cao (×3) | 100% | 50-100% | <50% |
| Audience exploration được Google đề xuất review | Trung bình (×1.5) | Có | Không | - |

#### 2.3 PMax Insights — Use cases (3 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Top performing search categories có liên quan SP | Cao (×3) | ≥80% | 50-80% | <50% |
| Tận dụng "Audience Insights" sang campaign khác | Trung bình (×1.5) | Có | - | Không |
| Conversion source mix Search/Display/YouTube | Trung bình (×1.5) | Đa dạng | Lệch 1 kênh | Lệch nặng |

### Nhóm 3 — Placement Quality (20%)

#### 3.1 Lãng phí Placement (5 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Placement >100 click & 0 conv | Rất nghiêm trọng (×5) | 0 | 1-5 | >5 |
| Placement >50 click & CPA > Trần | Cao (×3) | <5 | 5-15 | >15 |
| % chi vào placement có ≥1 conv | Rất cao (×4) | ≥70% | 40-70% | <40% |
| % chi vào **mobile app** in-app | Cao (×3) | <15% | 15-40% | >40% |
| Placement có brand safety risk | Rất nghiêm trọng (×5) | 0 | 1-3 | >3 |

#### 3.2 YouTube Channel Quality (4 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Channel >100K chi/tháng có ≥1 conv | Cao (×3) | 100% | 50-100% | <50% |
| Channel có CTR <0.05% | Cao (×3) | <10 | 10-30 | >30 |
| Channel kid-targeted (COPPA risk) | Rất nghiêm trọng (×5) | 0 | 1-2 | >2 |
| Average view rate (VR) | Trung bình (×1.5) | >15% | 5-15% | <5% |

#### 3.3 Site Quality — Display websites (4 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Website MFA (Made for Ads) | Rất nghiêm trọng (×5) | 0 | 1-5 | >5 |
| Site forum/comment chất lượng | Cao (×3) | ≥70% | 40-70% | <40% |
| Có dùng Topic exclusion (game/betting/adult) | Cao (×3) | Có | Một phần | Không |
| Có dùng Content keyword exclusion | Trung bình (×1.5) | Có | - | Không |

### Nhóm 4 — Targeting & Audience (15%)

#### 4.1 Audience setup (8 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| **Customer Match** từ CRM/POS | Cao (×3) | Có upload | Cũ >90 ngày | Không |
| **Website Visitors** (Google Tag) | Rất cao (×4) | ≥3 list | 1-2 | Không |
| **Lookalike (Similar Audiences)** | Trung bình (×1.5) | Có | - | Không |
| **Custom Intent Audience** dùng từ khoá SP | Cao (×3) | Có | Một phần | Không |
| **Demographic exclusion** | Trung bình (×1.5) | Có | - | Không |
| Geo target VN + city-level | Cao (×3) | City-level | Country | Sai |
| Language target VN + EN | Trung bình (×1.5) | Có | - | Không |
| Tỷ lệ chi vào **untargeted "All visitors"** | Cao (×3) | <30% | 30-60% | >60% |

#### 4.2 Retargeting (4 check)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Có campaign retargeting riêng | Rất cao (×4) | Có | - | Không |
| RT segmentation (cart/viewers/purchasers) | Cao (×3) | ≥3 segment | 1-2 | Gộp |
| Frequency capping ≤5 lần/tuần | Cao (×3) | Có | - | Không |
| RT exclude purchaser 30 ngày | Cao (×3) | Có | - | Không |

### Nhóm 5 — Measurement & Attribution (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Conversion lag <14 ngày từ click đến mua | Cao (×3) | ≥80% | 60-80% | <60% |
| **View-through conversion** window 1-7 ngày | Cao (×3) | ≤7 | 8-14 | >14 |
| Cross-device conversion tracking ON | Cao (×3) | Có | - | Không |
| Enhanced Conversion (hash email/phone) | Trung bình (×1.5) | Có | - | Không |
| Server-side GA4 / GTM | Trung bình (×1.5) | Có | - | Không |
| Attribution model: **Data-driven** | Cao (×3) | DDA | Last-click | Khác |
| Offline conversion upload (Pancake → Google) | Cao (×3) | Có | Thủ công | Không |

### Nhóm 6 — Cấu trúc Campaign Display (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Campaign Display **TÁCH RIÊNG** khỏi Search | Rất cao (×4) | Có | Lai | Trộn |
| **Naming convention** rõ (vd "GDN_DA8.1_Retarget") | Trung bình (×1.5) | Đầy đủ | Một phần | Lộn xộn |
| Mỗi Asset Group **1 mục tiêu rõ** | Cao (×3) | ≥80% | 50-80% | <50% |
| Số Asset Group/PMax campaign | Trung bình (×1.5) | 3-7 | 1-2 hoặc >7 | - |
| Bidding **Maximize Conversions** với target CPA | Cao (×3) | Có target | Không target | Sai |
| Daily budget không bị Limited | Trung bình (×1.5) | Không limit | <50% limit | >50% limit |
| Final URL Expansion review | Trung bình (×1.5) | Có review | Mặc định | Không |

## 5. Công thức tính tổng điểm

### 5.1 Per-check scoring

```
Đạt          = 100 điểm
Cảnh báo     = 50 điểm
Thất bại     = 0 điểm
```

### 5.2 Weighted score per nhóm

```
Score nhóm = Σ (điểm_check × mức_độ) / Σ (mức_độ) × 100
```

Mức độ scale: Rất nghiêm trọng ×5, Rất cao ×4, Cao ×3, Trung bình ×1.5, Thấp ×1

### 5.3 Tổng điểm

```
Tổng = N1×0.25 + N2×0.20 + N3×0.20 + N4×0.15 + N5×0.10 + N6×0.10
```

### 5.4 Xếp loại

| Range | Loại | Ý nghĩa |
|-------|------|---------|
| 85-100 | A | Xuất sắc — duy trì + scale |
| 70-84 | B | Tốt — fine-tune |
| 55-69 | C | Trung bình — action sớm |
| 40-54 | D | Yếu — risk lớn |
| <40 | F | Báo động — pause + reset |

### 5.5 Statistical Significance Gate (BẮT BUỘC)

| Đối tượng | Ngưỡng tối thiểu |
|-----------|------------------|
| Asset/banner | ≥7 ngày live + ≥1.000 impression |
| Placement | ≥30 ngày + ≥500 impression |
| Audience | ≥1.000 user trong segment + 14 ngày data |
| Campaign | ≥30 ngày + ≥10.000 impression |

Dưới ngưỡng → ghi note "Insufficient data" và bỏ qua check.

---

# PHẦN B — SUGGEST (5 cơ chế đề xuất banner)

## 6. Triết lý đề xuất

1. **Replicate trước khi sáng tạo** — copy "công thức thắng" trước, đổi creative sau
2. **Hypothesis-driven A/B** — mỗi challenger có 1 giả thuyết rõ
3. **Brand-safe always** — logo + color Doscom luôn xuất hiện
4. **Output là brief chi tiết** — designer/AI dựng được mà không cần hỏi lại

## 7. 5 cơ chế đề xuất banner

### 7.1 Cơ chế 1 — TOP PERFORMER REPLICATION

**Mục đích:** Banner thắng nhất → nhân bản 5-7 biến thể giữ "công thức thắng".

```
Trigger:
  ✓ Banner Asset rating "Best" hoặc "Excellent"
  ✓ CTR >0.8% (gấp 2.5× ngưỡng đạt 0.35%)
  ✓ Conversion ≥3 / 30 ngày
  ✓ Đã chạy ≥14 ngày (vượt Statistical Gate)

Phân tích "công thức thắng":
  - Style: pack-shot góc 30°? Lifestyle? Dual?
  - Color dominant: đỏ / xanh / cam / trắng?
  - Headline word count + structure
  - CTA color + position
  - Logo placement
  - Có giá hay không?

→ Sinh 5-7 biến thể GIỮ công thức, ĐỔI 1 yếu tố:
  Variant 1: đổi background (giữ object)
  Variant 2: đổi headline copy (giữ format)
  Variant 3: đổi CTA color
  Variant 4: đổi pack-shot angle
  Variant 5: đổi USP highlight
```

### 7.2 Cơ chế 2 — REPLACE LOSING BANNER với Brief

**Mục đích:** Banner kém → thay bằng brief tạo banner mới với hypothesis cụ thể.

```
Trigger:
  ✓ Banner CTR <0.1% / 14 ngày
  ✓ Asset rating "Poor"/"Low"
  ✓ Hoặc bị Google disapproved

Tìm CAUSE (chẩn đoán):
  □ Logo bị che bởi headline → fix layout
  □ Headline >12 từ → rút ≤8
  □ Background loè loẹt che SP → đơn giản
  □ Không có CTA → thêm
  □ Pack-shot SP <30% diện tích → phóng to
  □ Aspect ratio sai → đổi
  □ USP không rõ → highlight 1 USP
  □ Color quá nhiều (>3 màu) → giảm 2

→ Output Brief đầy đủ cho banner thay thế (template ở Section 9).
```

### 7.3 Cơ chế 3 — FILL ASPECT RATIO GAP

**Mục đích:** PMax thiếu aspect ratio → đề xuất bổ sung mobile-first.

```
Audit aspect ratio trong PMax Asset Group:
  □ 1:1 (square)        — Display chính
  □ 1.91:1 (landscape)  — header GDN
  □ 4:5 (portrait)      — feed Discover
  □ 9:16 (vertical)     — story / Shorts

Trigger: Asset Group thiếu ≥1 ratio
Ưu tiên: 9:16 (70% mobile traffic) > 1:1 > 4:5 > 1.91:1
```

### 7.4 Cơ chế 4 — A/B TEST CHALLENGER (Hypothesis-driven)

**Mục đích:** Asset Group có spread CTR lớn → đề xuất 3 challenger test giả thuyết cụ thể.

```
Trigger:
  ✓ Asset Group có max/min CTR ratio >5×
  ✓ Banner top thắng đã ổn định ≥30 ngày
  ✓ Cần variety cho PMax đa dạng

Sinh 3 challenger với hypothesis:
```

| # | Hypothesis | Action |
|---|-----------|--------|
| 1 | Hook khác | Thay headline → "Phát hiện camera giấu trong 30s" |
| 2 | Target khác | Đổi pain point business → gia đình |
| 3 | Color khác | Đổi đỏ → xanh navy (test trust) |
| 4 | Format khác | 2 SP cùng banner |
| 5 | Social proof | Thêm "10.000+ khách đã dùng" |
| 6 | Urgency | Thêm timer "Còn 12h sale" |
| 7 | Before/After | NOMA, show kết quả rửa xe |

### 7.5 Cơ chế 5 — SEASONAL BANNER REFRESH

**Calendar VN:**

| Event | Window | Banner concept |
|-------|--------|---------------|
| Tết Nguyên Đán | T1-T2 (trước 30d) | Lì xì đỏ + "Quà công nghệ Tết — DA8.1 Camera tặng sếp" |
| 8/3, 20/10 | Trước 14d | Pink/coral + "Quà tặng phụ nữ — Định vị an toàn" |
| 14/2 Valentine | Trước 7d | Tone hồng + "Quà cho người yêu xa — DA8.1 gọi 2 chiều" |
| Mùa hè (T6-T8) | | Background biển/bể bơi + "An toàn cho con tự ở nhà — DA1 Mini" |
| Du lịch Tết | T12-T2 | Sân bay/vali + "Định vị hành lý — Tag DT5 IP67" |
| Khai giảng | T7-T9 | Background lớp học + "Máy ghi âm bài giảng DR4 Pro" |
| Black Friday | T11 | Tone đen-vàng + "Sale 50% — Camera Doscom" |
| 30/4-1/5 | Trước 14d | Quốc khánh tone đỏ-vàng + sale Tier 1 |
| 2/9 Quốc khánh | Trước 14d | Tone đỏ-vàng + sale chiến dịch |

**Logic:**
```
Trong 30 ngày tới có event X
Asset Group SP phù hợp với event chưa có banner event đó
→ Đề xuất 2-3 banner brief theo event
   Aspect ratio: ưu tiên 9:16 + 1:1 + 4:5
   Budget: 70% từ ngân sách + 30% incremental
```

## 8. Logic ghép & rank 5 cơ chế

```
1. Chạy 5 cơ chế song song
2. Tổng hợp suggestions
3. Dedup: cùng concept → giữ source Impact cao nhất
4. Compute Impact:
   Impact = (CTR cải thiện × Impressions × CVR × Margin) − Cost dựng
5. Sort Impact giảm dần
6. Output Top 10 banner brief
```

**Cost dựng tham khảo:**
- Designer freelance: 200-500K/banner
- AI generate (Midjourney/DALL-E): 50-100K/banner
- Tự dựng Canva: ~30K/banner (chỉ time)

## 9. Mẫu brief banner chi tiết

```
=== BRIEF BANNER #1 ===
Tên file: DA1-mobile-square-v2
Aspect ratio: 1:1 (1200×1200px)
Mục đích: thay banner cũ "DA1-mobile-v1" có CTR 0.06%

Layout:
  - Top-left: Logo Doscom 120×40px (đỏ + chữ trắng)
  - Center: Pack-shot DA1 góc 30°, 50% diện tích, nền trắng
  - Top-right: Badge "Pin 6 tháng" (xanh navy, chữ trắng)
  - Bottom: Headline 2 dòng, đỏ Doscom #E63946
    Dòng 1: "Camera Mini Không Wifi"
    Dòng 2: "Pin 6 tháng — 2.500.000đ"
  - Bottom-right: CTA "Mua ngay →" (nút đỏ, chữ trắng, bo góc 8px)

Hypothesis: USP "không cần wifi" + "pin 6 tháng" sẽ tăng CTR
Mục tiêu test: 14 ngày, target CTR ≥0.4% (gấp 6× banner cũ)
Tools dựng: Canva / Figma / Photoshop / image-create skill
Cost dựng: ~80K (AI) hoặc ~300K (designer)
```

---

# PHẦN C — Workflow chung

## 10. Quy trình Claude áp dụng skill

1. **Verify scope**: User hỏi GDN/PMax/banner/placement → dùng skill này
2. **Lấy data**:
   - `data/google-ads-placement.json` — placement-level
   - `data/google-ads-ads.json` — banner asset detail + RSA
   - `data/google-ads-context.json` — campaign overview
   - `/api/inventory` — giá vốn để tính trần CPA Display
3. **Lọc data**: Chỉ campaign có channel_type DISPLAY hoặc PERFORMANCE_MAX
4. **Apply Statistical Gate** (5.5)
5. **PHẦN A — Audit**:
   - Score 6 nhóm (Section 4 → công thức 5.2)
   - Xếp loại (5.4)
6. **PHẦN B — Suggest**:
   - Phân loại banner theo Cơ chế phù hợp
   - Sinh brief đầy đủ
   - Compute Impact + sort
7. **Top 5 Quick Win**:
   - Loại trừ placement >100 click 0 conv → tiết kiệm $X
   - Tăng asset count nhóm còn <8 headline
   - Tách campaign Display khỏi Search
   - Bật offline conversion upload
   - Set frequency cap nếu RT spam
8. **Cảnh báo nguy hiểm**:
   - Asset disapproved → fix/thay
   - Placement brand safety risk → exclude lập tức
   - Customer Match expired → upload mới
   - PMax audience signal trống → setup ngay
9. **Format báo cáo** theo template (Section 11)

## 11. Template báo cáo

```
# Báo cáo GDN/PMax Audit + Suggest — DD/MM/YYYY

## Tổng điểm: XX/100 — Xếp loại: A/B/C/D/F

## Tóm tắt 1 dòng
[vd: "PMax đang gánh hầu hết doanh thu, banner cần làm mới gấp"]

## ──── PHẦN A — AUDIT ────

### Điểm 6 nhóm
- Banner/Asset:        XX/100
- PMax Asset Rating:   XX/100
- Placement Quality:   XX/100
- Targeting/Audience:  XX/100
- Measurement:         XX/100
- Cấu trúc Display:    XX/100

### Top 5 Quick Win
1. [Action]: [Impact ₫] — [Effort: Thấp/Trung/Cao]
2. ...

### Cảnh báo nguy hiểm
🚨 [vấn đề + impact]

### Asset disapproved cần xử lý ngay
| Tên asset | Lý do | Action |
|-----------|-------|--------|

### Placement đề xuất loại trừ
| Placement | Type | Spend | Conv | Action |
|-----------|------|-------|------|--------|

## ──── PHẦN B — SUGGEST BANNER ────

### Tóm tắt banner suggest
- Tổng banner brief: X
- Phân bổ cơ chế: Replicate Y / Replace Z / Aspect W / Challenger V / Seasonal U
- Tăng CTR dự kiến: +X% Asset Group
- Cost dựng ước tính: ₫X

### Top 10 Banner Brief (theo Impact)

#### Brief #1 — [Tên]
**Cơ chế**: Replicate / Replace / Aspect Gap / Challenger / Seasonal
**Asset Group**: ...
**Aspect ratio**: 1:1 (1200×1200)
**Layout chi tiết**: [theo mẫu Section 9]
**Color palette**: ...
**Copy**:
- Headline: "..."
- Sub: "..."
- CTA: "..."
**Hypothesis**: ...
**Test plan**: ...
**Cost dựng**: ₫...
**Tăng đơn dự kiến**: ...

#### Brief #2 ...

### Aspect Ratio Coverage Matrix
| Asset Group | 1:1 | 1.91:1 | 4:5 | 9:16 | Action |

### Calendar event sắp tới (30 ngày)
- Event: ... — Banner concept: ...

## Dữ liệu nguồn & kỳ
- Khoảng thời gian: DD/MM - DD/MM
- Số campaign Display/PMax: X
- Tổng chi tiêu: ₫
- Tổng conversion:
```

## 12. Source data — Nơi đọc

| File | Trường quan trọng |
|------|-------------------|
| `data/google-ads-placement.json` | placement_url, type (YouTube/site/app), clicks, conversions, cost |
| `data/google-ads-ads.json` | asset_type, headline_text, image_url, performance_label |
| `data/google-ads-context.json` | campaign_type, asset_strength, audience_signal |
| `/api/inventory` (KV) | gia_nhap_vnd, gia_ban_vnd để tính trần CPA |
| `data/google-ads-spend.json` | breakdown chi theo campaign + ngày |

## 13. Cross-link với skill khác

| Output cần | Gọi skill |
|------------|-----------|
| Headline + body copy theo công thức (FAB, AIDA, BAB, Hook-Value-CTA) | `cong-thuc-viet-content-by-noti` |
| Brand color, typography, logo | `doscom-brand-guidelines` |
| Generate ảnh thực tế từ brief | `image-create` (Anthropic) |
| Visual layout design | `canvas-design` |
| Audit từ khoá Search | `doscom-keyword-audit-suggest` |
| Audit account tổng | `doscom-google-ads-audit` |

→ Skill này CHỈ output **audit score + brief**. Designer/AI image tool dựng tiếp.

## 14. Phong cách trình bày

- **Tiếng Việt 100%** — không jargon. Sau thuật ngữ EN có giải thích VN:
  - "Asset Strength (độ mạnh asset)"
  - "Placement (vị trí hiển thị)"
  - "View-through (xem nhưng không click)"
- Số tiền: dấu phẩy ngàn (vd 526,759 VND)
- Số đo banner: pixel/% rõ ràng
- Layout vùng cụ thể — không nói chung chung "đẹp"
- Hypothesis: rõ ràng, đo được
- Action Quick Win: cụ thể, kèm $ tác động
- Cảnh báo: 🚨 nghiêm trọng, ⚠️ cảnh báo

## 15. Trường hợp đặc biệt

| Tình huống | Hướng xử lý |
|------------|-------------|
| Account chỉ chạy PMax, không có Display thuần | Bỏ Nhóm 6 (cấu trúc Display), focus 5 nhóm còn lại |
| Account mới <30 ngày | Skip Statistical Gate, ghi rõ "data sơ khai" |
| Asset disapproved hàng loạt | Cảnh báo cao nhất, ưu tiên đầu báo cáo + Cơ chế 2 trước |
| Placement >50% chi vào game/kid app | F luôn cho Nhóm 3, không check tiếp |
| PMax không có insights vì <90 ngày | Skip Nhóm 2.3, ghi note |
| Customer Match list 0 user | F cho check 4.1, đề xuất upload từ Pancake |
| Asset Group <30 ngày | Skip Cơ chế 1 (chưa có top performer rõ) |
| Account toàn banner CTR thấp | Tập trung Cơ chế 2 + 5 (replace + seasonal) |
| User chưa có designer | Khuyến nghị: Canva (free), Figma, Photoshop, image-create |
| NOMA banner | Tone nam tính, before/after thật, không lifestyle generic |
| Event xa hơn 60 ngày | Skip Cơ chế 5, đợi window 30 ngày |

## 16. Checklist trước khi gửi báo cáo

### Audit (Phần A)
- [ ] Đã apply Statistical Significance Gate
- [ ] Đối chiếu giá vốn từ KV `/api/inventory` (không Misa)
- [ ] Trần CPA Display tính theo `0.5 × (Bán − Vốn − VAT)`
- [ ] Asset disapproved liệt kê đầu báo cáo
- [ ] Top 5 Quick Win mỗi action có $ impact

### Suggest (Phần B)
- [ ] Mỗi brief đủ: size, layout, color hex, copy, CTA, hypothesis, cost
- [ ] Logo Doscom luôn top-left, đủ rõ mobile
- [ ] Aspect Ratio Coverage Matrix có trong báo cáo
- [ ] Cost dựng tổng ≤10% incremental budget tháng
- [ ] Calendar event 30 ngày đã check
- [ ] Cross-link đến content + brand-guidelines + image-create

### Chung
- [ ] Tất cả số liệu có dấu phẩy ngàn
- [ ] Đã nhắc placement YouTube channel kid-targeted (COPPA risk)
- [ ] Báo cáo dưới 2.500 từ tổng — không lan man

## 17. Tham chiếu chéo

- **Audit từ khoá Search**: `doscom-keyword-audit-suggest`
- **Audit account tổng**: `doscom-google-ads-audit` (parent overview)
- **Brand identity**: `doscom-brand-guidelines`
- **Content/copy**: `cong-thuc-viet-content-by-noti`
- **Generate ảnh thật**: `image-create` (Anthropic)
- **Visual design**: `canvas-design`
- **Thông tin SP** (USP, target, code): `doscom-products` + KV `/api/inventory`

---

*Phiên bản 1.0 (gộp từ 2 skill cũ doscom-gdn-audit + doscom-banner-suggest) · Tạo ngày 25/04/2026 · Tác giả: Claude × Duy · Skill này dành cho hệ thống Display + Performance Max của Doscom Holdings*


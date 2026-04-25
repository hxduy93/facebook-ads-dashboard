---
name: doscom-keyword-audit-suggest
description: Hệ thống chấm điểm chuyên sâu từ khoá Search Google Ads của Doscom Holdings (7 nhóm tiêu chí, 100 điểm, A-F) kết hợp với cơ chế gợi ý từ khoá thay thế từ Search Terms Report — bao gồm 5 cơ chế (Harvest, Replace dying keyword, Long-tail expansion, Competitor pressure flag, Seasonal/event-driven). Áp dụng skill này khi Duy yêu cầu "audit từ khoá", "chấm điểm keyword", "đánh giá từ khoá Google Ads", "tìm từ khoá thay thế", "harvest search term", "đề xuất từ khoá mới", "loại từ khoá lỗ", "phân bậc Tier từ khoá", "tối ưu match type", "kiểm tra cannibalization keyword", "brand vs non-brand", "long-tail keyword Doscom", "thêm negative keyword", hoặc bất kỳ yêu cầu phân tích/tối ưu/sinh từ khoá Search. KHÔNG dùng cho audit GDN/Display/PMax (dùng doscom-gdn-audit), audit tổng quan tài khoản (dùng doscom-google-ads-audit), Facebook Ads (doscom-fb-ads), hoặc viết content quảng cáo (cong-thuc-viet-content-by-noti).
---

# Doscom Keyword Audit & Suggest

> Skill chuyên sâu cho mảng **từ khoá Search** của Doscom Holdings. Kết hợp 2 chức năng: (1) **chấm điểm chất lượng keyword hiện có** theo 7 nhóm tiêu chí, và (2) **gợi ý từ khoá thay thế** dựa trên Search Terms Report. Dùng skill này khi user hỏi cụ thể về keyword. Khi user hỏi tổng quan tài khoản → ưu tiên `doscom-google-ads-audit`, gọi skill này khi đến phần keyword cần đào sâu.

---

## 1. Bối cảnh người dùng

- **Người dùng**: Duy (FB Ads + Google Ads lead, Doscom Holdings)
- **Hệ sinh thái**: 9 nhóm SP (Camera wifi/4G/Video call, Máy dò, Ghi âm, Chống ghi âm, Định vị, NOMA, Khác)
- **Ngân sách Google Ads**: ~272M VND/3 tháng gần nhất
- **Mô hình bid**: KHÔNG đặt ROAS làm KPI → mục tiêu **Lợi nhuận ≥30% Doanh thu**
- **Số liệu data hiện có**:
  - 18,631 unique search terms / 30 ngày
  - 71,858 rows raw search-term × ad-group × ngày
  - File: `data/google-ads-search-terms.json` (Windsor.ai sync)
  - File: `data/google-ads-context.json` (keyword + campaign)
- **Ngôn ngữ báo cáo**: 100% tiếng Việt
- **Tính cách user**: muốn nói thẳng, không jargon, có ngưỡng vàng/đỏ rõ ràng, ưu tiên action thực thi được

---

## 2. Triết lý đánh giá từ khoá

### 2.1 Khác biệt với chuẩn quốc tế

| Tiêu chí | Chuẩn quốc tế | Doscom |
|----------|---------------|--------|
| KPI chính | ROAS ≥3-5x | **Lợi nhuận ≥30% Doanh thu** |
| Tạm dừng kw | CPA > target | CPA > **trần margin-aware** + đã vượt cổng số liệu |
| Bid optimization | Theo ROAS | Theo trần CPA + Tier |
| Pause Tier 1 | Có thể | **TUYỆT ĐỐI KHÔNG** |
| QS check | Yes | Yes, nhưng phụ |

### 2.2 Trần CPA per SP (Margin-aware)

```
Trần CPA Search = 0.6 × Giá bán − Giá vốn − VAT 10%
```

Ví dụ cho từng SP (lấy giá vốn từ KV `/api/inventory`):
- **DA8.1**: 0.6×1.250.000 − 526.759 − 125.000 = **98.241 VND**
- **D1**: 0.6×2.500.000 − 438.663 − 250.000 = **811.337 VND**
- **DR8**: tuỳ giá thực tế trong KV
- **NOMA 911**: tuỳ giá thực tế

### 2.3 4 Nguyên tắc cốt lõi

1. **Phân bậc TRƯỚC mọi quyết định** — không bao giờ áp rule chung lên Tier 1 cốt lõi
2. **Cổng kiểm định số liệu** — ≥30 click trong window 30-90 ngày mới được kết luận
3. **Trần CPA chia theo SP** — không một số ngưỡng cứng cho cả tài khoản
4. **Suggest TRƯỚC khi pause** — đề xuất keyword thay thế trước, đợi 7 ngày, mới pause cũ

---

## 3. Phân bậc 3-Tier (Foundation — làm trước mọi đánh giá)

| Tier | Định nghĩa | Ví dụ | Hành động |
|------|------------|-------|-----------|
| **Tier 1 — Cốt lõi** | Mô tả SP chính Doscom | máy dò nghe lén, camera giấu, thiết bị ghi âm, định vị GPS, NOMA chăm sóc xe | **TUYỆT ĐỐI KHÔNG pause**. Chỉ tối ưu (bid/match/long-tail) |
| **Tier 2 — Kế cận** | Liên quan nhưng không phải chính | camera nhà thông minh, ghi âm cuộc họp, định vị xe đạp | Áp rule chuẩn SAU khi vượt cổng số liệu |
| **Tier 3 — Không liên quan** | Sai ý định / sai dòng SP | camera quay phim, máy ghi âm studio, định vị thú cưng (Doscom không có SP này) | **Pause mạnh tay** ngay khi đủ click ngưỡng |

### Phương pháp phân bậc tự động

```
1. Lấy các từ root cốt lõi của Doscom: ['dò nghe lén', 'camera giấu', 'camera ngụy trang',
   'thiết bị ghi âm', 'định vị', 'máy ghi âm', 'noma', 'chăm sóc ô tô']
2. So với keyword text:
   - Match exact 1 root → Tier 1
   - Match phần root nhưng có modifier xa (vd "camera quay phim") → Tier 3
   - Match adjacent (vd "camera mini gia đình") → Tier 2
3. Override thủ công: nếu user đã gắn label "Tier 1/2/3" trong Google Ads → ưu tiên label
```

---

## 4. Cấu trúc 7 nhóm chấm điểm (100%)

| # | Nhóm | Trọng số | Lý do |
|---|------|---------|-------|
| 1 | **Quality Score & Performance** | **20%** | QS quyết định CPC + impression share |
| 2 | **Match Type & CTR Analysis** | **15%** | Match đúng = giảm phí, CTR ánh xạ ý định người dùng |
| 3 | **CVR & CPA per Tier** | **20%** | KPI lợi nhuận thực tế của từng Tier |
| 4 | **Cấu trúc & Negative** | **15%** | Tránh search term lệch + cấu trúc lộn xộn |
| 5 | **Brand vs Non-brand split** | **10%** | Brand lệch chỉ số chung — phải tách |
| 6 | **Cannibalization (đua giá nội bộ)** | **10%** | Cùng search term match nhiều ad group |
| 7 | **Search Term Health** | **10%** | Tỷ lệ search term có conv vs spend lệch |

---

## 5. Chi tiết các check theo từng nhóm

### Nhóm 1 — Quality Score & Performance (20%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Phân bố QS 8-10 | Cao (×3) | ≥30% từ khoá | 15-30% | <15% |
| Phân bố QS 1-4 | Cao (×3) | <10% | 10-25% | >25% |
| QS trung bình toàn account | Trung bình (×1.5) | ≥7 | 5-7 | <5 |
| Expected CTR (component) "Above Avg" | Trung bình (×1.5) | ≥40% kw | 20-40% | <20% |
| Ad Relevance "Above Avg" | Trung bình (×1.5) | ≥50% kw | 30-50% | <30% |
| Landing Page Exp "Above Avg" | Trung bình (×1.5) | ≥50% kw | 30-50% | <30% |
| Tỷ lệ keyword có status "Eligible" | Cao (×3) | 100% | 95-99% | <95% |
| Số keyword bị disapproved/limited | Rất nghiêm trọng (×5) | 0 | 1-3 | >3 |

### Nhóm 2 — Match Type & CTR Analysis (15%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Tỷ lệ chi vào Exact + Phrase | Cao (×3) | ≥60% | 40-60% | <40% |
| Còn dùng Modified Broad (đã bị Google bỏ) | Trung bình (×1.5) | 0 | 1-5 | >5 |
| CTR Exact match | Cao (×3) | >5% | 3-5% | <3% |
| CTR Phrase match | Cao (×3) | >2.5% | 1.5-2.5% | <1.5% |
| CTR Broad match | Trung bình (×1.5) | >1.5% | 0.8-1.5% | <0.8% |
| Số keyword Broad có CTR <0.5% | Cao (×3) | <5 | 5-15 | >15 |

### Nhóm 3 — CVR & CPA per Tier (20%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| **CPA Tier 1** | Cao (×3) | ≤80% trần | 80-100% trần | >100% trần |
| **CPA Tier 2** | Cao (×3) | ≤90% trần | 90-110% trần | >110% trần |
| **CPA Tier 3** | Rất nghiêm trọng (×5) | Pause sạch | 1-3 còn sống | >3 còn sống |
| **CVR Tier 1** | Cao (×3) | ≥4% | 2-4% | <2% |
| **CVR Tier 2** | Trung bình (×1.5) | ≥2.5% | 1.5-2.5% | <1.5% |
| Số kw lỗ liên tục >2 tuần | Cao (×3) | <5 | 5-15 | >15 |
| Tỷ lệ kw 0 conv với spend > 1× trần CPA | Rất nghiêm trọng (×5) | <5% | 5-15% | >15% |

### Nhóm 4 — Cấu trúc & Negative (15%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Số kw / ad group | Cao (×3) | 5-20 | 21-30 | >30 |
| Mỗi ad group có ≥2 RSA | Cao (×3) | 100% | 50-99% | <50% |
| Mỗi chiến dịch 1 mục tiêu rõ | Cao (×3) | Có | 1-2 lai | Trộn nhiều |
| Có ≥3 negative keyword list shared | Trung bình (×1.5) | ≥3 | 1-2 | 0 |
| Negative chứa từ phổ biến (tuyển dụng, miễn phí, tự làm, lỗi, hỏng, sửa) | Cao (×3) | Đủ | Một phần | Không |
| Tỷ lệ search term có negative match | Trung bình (×1.5) | ≥10% | 5-10% | <5% |

### Nhóm 5 — Brand vs Non-brand Split (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Brand kw (chứa "doscom"/"noma") tách campaign riêng | Cao (×3) | Có | Lai | Không |
| Defensive brand exact ["doscom"] đã có | Cao (×3) | Có | - | Không |
| Tỷ lệ chi cho brand search | Trung bình (×1.5) | 5-15% | <5% hoặc >25% | - |
| CTR brand vs non-brand được tách báo cáo | Trung bình (×1.5) | Có | - | Không |

### Nhóm 6 — Cannibalization — đua giá nội bộ (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Số search term match >1 ad group | Cao (×3) | <5% | 5-15% | >15% |
| Cùng kw xuất hiện trong nhiều campaign | Cao (×3) | <3 cặp | 3-10 | >10 |
| Auction-time bidding adjustments tránh đè nhau | Trung bình (×1.5) | Có | - | Không |
| Top-of-Page (Search Lost IS - rank) | Cao (×3) | <30% | 30-50% | >50% |

### Nhóm 7 — Search Term Health (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Tỷ lệ search term có conversion / total | Cao (×3) | ≥10% | 5-10% | <5% |
| Tỷ lệ chi vào ST có conversion | Rất cao (×4) | ≥70% | 50-70% | <50% |
| Search term lệch ý định >5% chi | Cao (×3) | <10% | 10-25% | >25% |
| Số ST mới chưa khai thác (long-tail) | Trung bình (×1.5) | ≥30 cluster | 10-30 | <10 |

---

## 6. Công thức tính tổng điểm

### 6.1 Per-check scoring

```
Đạt          = 100 điểm
Cảnh báo     = 50 điểm
Thất bại     = 0 điểm
```

### 6.2 Weighted score per nhóm

```
Score nhóm = Σ (điểm_check × mức_độ) / Σ (mức_độ) × 100
```

Mức độ scale:
- Rất nghiêm trọng = ×5
- Rất cao         = ×4
- Cao             = ×3
- Trung bình      = ×1.5
- Thấp            = ×1

### 6.3 Tổng điểm

```
Tổng = N1×0.20 + N2×0.15 + N3×0.20 + N4×0.15 + N5×0.10 + N6×0.10 + N7×0.10
```

### 6.4 Xếp loại

| Range | Loại | Ý nghĩa |
|-------|------|---------|
| 85-100 | A | Xuất sắc — duy trì + scale |
| 70-84 | B | Tốt — fine-tune |
| 55-69 | C | Trung bình — action sớm |
| 40-54 | D | Yếu — risk lớn |
| <40 | F | Báo động — pause + reset |

### 6.5 Statistical Significance Gate (BẮT BUỘC)

Một check chỉ tính nếu:
- **Per keyword**: ≥30 click, ≥1.000 impression, window ≥30 ngày
- **Per match type**: ≥100 click trong group
- **Per Tier**: ≥10 keyword trong Tier
- **Per search term**: ≥15 click với window ≥30 ngày

Dưới ngưỡng → ghi note "Insufficient data — chờ thêm" trong báo cáo.

### 6.6 Cổng kiểm định số liệu (cho quyết định pause)

```
Số đơn dự kiến = Lượt nhấp × Tỷ lệ chuyển đổi TB tài khoản
Nếu < 3 → "Dữ liệu chưa đủ" → KHÔNG pause kể cả khi 0 conv
```

---

## 7. 5 Cơ chế gợi ý từ khoá

### 7.1 Cơ chế 1 — SEARCH TERM HARVEST

**Mục đích:** Phát hiện search term có conv nhưng chưa là keyword chính thức → biến thành Exact để giảm CPC + tăng QS.

```
Điều kiện đề xuất (TẤT CẢ):
  ✓ Search term KHÔNG trùng keyword nào (sau normalize)
  ✓ Conversions ≥ 2 / 90 ngày
  ✓ Clicks ≥ 15
  ✓ CTR ≥ 4%
  ✓ CVR ≥ 3% (hoặc cao hơn TB tài khoản)
  ✓ CPA ≤ Trần SP
  ✓ Intent match SP Doscom (chứa root: dò/camera/ghi âm/định vị/noma + code SP)

→ Output: Tạo Exact Match keyword [search_term] vào ad group SP tương ứng
   Bid khởi điểm = 80% × CPC trung bình ad group
```

### 7.2 Cơ chế 2 — REPLACE DYING KEYWORD

**Mục đích:** Khi Tier 2/3 sắp pause → đề xuất keyword tốt hơn để không mất impression chung của ad group.

```
Trigger:
  ✓ Keyword Tier 2 hoặc 3 (KHÔNG Tier 1)
  ✓ Vượt cổng kiểm định (impressions ≥ 1.000)
  ✓ CPA > trần 1 tuần (sắp pause)

Tìm 2-3 search term replacement:
  ✓ Chia sẻ ≥60% từ với keyword cũ
  ✓ CVR cao hơn keyword cũ ≥1.5×
  ✓ Conversions ≥ 1
  ✓ Đã đủ Statistical Gate

Workflow:
  1. Tạo keyword mới Phrase Match TRƯỚC
  2. Đợi 7 ngày keyword mới chạy ổn định
  3. Sau đó pause keyword cũ
```

### 7.3 Cơ chế 3 — LONG-TAIL EXPANSION từ Tier 1

**Mục đích:** Tier 1 cốt lõi đang chạy tốt → mở rộng long-tail (CPC thấp hơn, ít cạnh tranh).

```
Trigger:
  ✓ Keyword Tier 1
  ✓ Conversions ≥ 5 / 30 ngày
  ✓ Quality Score ≥ 7
  ✓ Search Impression Share ≥ 50%

→ Sinh 5-10 long-tail variations theo 3 mẫu:
```

**Mẫu A — Tier1 + USE CASE:**
- Camera giấu: + ô tô, văn phòng, khách sạn, gia đình, cửa hàng
- Máy dò: + phòng họp, khách sạn VIP, ô tô
- Ghi âm: + cuộc họp, lớp học, phỏng vấn, ngoại tình
- Định vị: + xe máy, ô tô, trẻ em, người già, hành lý
- NOMA: + tự rửa xe tại nhà, DIY, chăm sóc ô tô gia đình

**Mẫu B — Tier1 + SP_CODE:**
- "camera giấu" + "trong bút" / "nút áo" / "đồng hồ"
- "máy dò" + "D1" / "D8 Pro" / "DA8.1"

**Mẫu C — Tier1 + INTENT/BUYER:**
- + "cho doanh nghiệp" / "giá rẻ" / "pin lâu" / "không cần wifi" / "siêu nhỏ"

### 7.4 Cơ chế 4 — COMPETITOR PRESSURE FLAG

**Lưu ý:** Google KHÔNG cho ai đọc keyword đối thủ. Skill chỉ:

```
INPUT: Auction Insights
LẤY:
  - 5 đối thủ overlap impression ≥30%
  - Position Above Rate ≥40%
  - Top of Page Rate ≥60%

OUTPUT (KHÔNG suggest keyword cụ thể):
  - Bảng đối thủ + mức cảnh báo
  - Đề xuất action:
    a) Tăng bid 10-15% nếu Position Below Rate >40%
    b) Defensive brand: Exact ["doscom"] chặn đối thủ chiếm top
    c) Yêu cầu user dùng SpyFu/Semrush/SimilarWeb để cào keyword đối thủ thủ công
    d) Search thủ công 10 kw Tier 1 → screenshot → user paste lại cho skill phân tích
  - Nếu user paste keyword đối thủ:
    → Filter intent match Doscom
    → Suggest Tier 2 với bid trung bình + budget cap test 14 ngày
```

### 7.5 Cơ chế 5 — SEASONAL / EVENT-DRIVEN

Calendar VN hardcoded:

| Event | Window | Sample keyword |
|-------|--------|----------------|
| Tết Nguyên Đán | T1-T2 | "quà tặng công nghệ tết", "máy ghi âm tặng bố", "camera tặng sếp" |
| 8/3, 20/10, 14/2 | Trước 1 tháng | "quà tặng phụ nữ công nghệ", "thiết bị an toàn cho mẹ" |
| Mùa hè (T6-T8) | | "camera giám sát con tự ở nhà", "định vị trẻ em đi chơi", "noma rửa xe nắng" |
| Du lịch Tết | T12-T2 | "định vị hành lý sân bay", "camera giấu khách sạn", "máy dò khách sạn" |
| Khai giảng | T7-T9 | "máy ghi âm bài giảng", "định vị cặp sách trẻ em" |
| Black Friday | T11 | "deal camera giảm giá", "noma giảm 50%" |

**Logic:**
```
Trong vòng 30 ngày tới có event X
Keyword event tương ứng CHƯA tồn tại trong account
→ Đề xuất Phrase Match với budget cap riêng
   Bid = 80% × bid trung bình ad group cùng SP
```

---

## 8. Logic ghép & rank 5 cơ chế

```
1. Chạy 5 cơ chế song song
2. Tổng hợp suggestions
3. Dedup: cùng keyword → giữ source có Impact cao nhất
4. Filter overlap: nếu kw mới đã match Phrase/Broad cũ → skip (tránh cannibalization)
5. Compute Impact:
   Impact = (Conv dự kiến × Margin) − (Click dự kiến × CPC dự kiến)
6. Sort theo Impact giảm dần
7. Output Top 20 (giới hạn để user dễ action)
```

---

## 9. Quy trình Claude áp dụng skill

1. **Verify scope**: User hỏi keyword/search term → dùng skill này. Hỏi tổng quan account → ưu tiên `doscom-google-ads-audit`, gọi skill này khi cần đào sâu keyword.

2. **Lấy data**:
   - `data/google-ads-search-terms.json` (term_aggregates: ~18K cụm)
   - `data/google-ads-context.json` (keyword + campaign + Auction Insights)
   - `/api/inventory` để lấy giá vốn → tính trần CPA

3. **Phân bậc 3-Tier** (Section 3) — bắt buộc làm trước

4. **Apply Statistical Gate** (Section 6.5)

5. **Score 7 nhóm** (Section 5 → công thức 6.2)

6. **Xếp loại** (Section 6.4)

7. **Chạy 5 cơ chế suggest** (Section 7) → ghép + rank (Section 8)

8. **Top 5 Quick Win**:
   - Loại trừ negative chung (5 phút) — impact cao
   - Pause Tier 3 lỗ (10 phút)
   - Harvest 5 search term sinh đơn cao nhất (15 phút)
   - Long-tail từ Tier 1 top performer (15 phút)
   - Defensive brand Exact (5 phút)

9. **Cảnh báo nguy hiểm**:
   - Keyword disapproved → fix ngay
   - CPA Tier 1 vượt trần >50% → khẩn cấp
   - Cannibalization >15% → cần tách campaign
   - Tier 3 đốt >20% chi → pause sạch ngay

10. **Format báo cáo** theo template (Section 10)

---

## 10. Template báo cáo

```
# Báo cáo Audit & Suggest Từ khoá Doscom — DD/MM/YYYY

## Tổng điểm: XX/100 — Xếp loại: A/B/C/D/F

## Tóm tắt 1 dòng
[Vd: "Keyword Tier 1 chạy ổn, Tier 3 đang đốt 23% chi cần pause sạch"]

## Điểm 7 nhóm
- Quality Score:           XX/100
- Match Type & CTR:        XX/100
- CVR & CPA per Tier:      XX/100
- Cấu trúc & Negative:     XX/100
- Brand vs Non-brand:      XX/100
- Cannibalization:         XX/100
- Search Term Health:      XX/100

## Phân bậc 3-Tier
- Tier 1 (Cốt lõi):  X kw, X conv, CPA TB Y, % chi Z
- Tier 2 (Kế cận):   X kw, X conv, CPA TB Y, % chi Z
- Tier 3 (Sai):      X kw, X conv, CPA TB Y, % chi Z

## Top 10 đề xuất từ khoá MỚI (theo Impact)
| # | Cơ chế | Action | Ad Group | Keyword mới | Match | Bid | Lý do | Tăng đơn dự kiến |
|---|--------|--------|----------|-------------|-------|-----|-------|------------------|
| 1 | HARVEST | Tạo mới | ... | [kw mới] | Exact | XK | conv ẩn | +X/tháng |
| ... |

## Top 5 từ khoá đề xuất PAUSE
| # | Keyword cũ | Tier | Chi 30d | Conv | CPA / Trần | Replacement đã đề xuất |
|---|------------|------|---------|------|-----------|----------------------|

## Negative keyword đề xuất thêm
- "tuyển dụng", "miễn phí", "tự làm", "DIY", "lỗi", "sửa", "rách", ...

## Cảnh báo nguy hiểm
🚨 [vấn đề + impact]

## Đối thủ áp lực (Cơ chế 4)
| Đối thủ | Overlap % | Position Above % | Action đề xuất |
|---------|-----------|------------------|----------------|

## Dữ liệu nguồn & kỳ
- Search Terms: 30 ngày (DD/MM - DD/MM) — 71,858 rows raw, 18,631 unique
- Tổng chi tiêu: ₫
- Tổng conversion:
```

---

## 11. Source data — Nơi đọc

| File | Trường quan trọng |
|------|-------------------|
| `data/google-ads-search-terms.json` | term_aggregates: {term: {spend_30d, clicks_30d, impressions_30d, conversions_30d, ctr_30d, cpc_30d}} |
| `data/google-ads-context.json` | keywords, ad groups, campaigns, quality_score, match_type, auction_insights |
| `/api/inventory` (KV) | gia_nhap_vnd, gia_ban_vnd để tính trần CPA |
| `data/google-ads-spend.json` | breakdown chi theo campaign + ngày |

Statistical Gate: Nếu data ít hơn ngưỡng → ghi rõ trong báo cáo, không bịa số liệu.

---

## 12. Phong cách trình bày

- **Tiếng Việt 100%** — không jargon. Sau thuật ngữ EN có giải thích VN trong ngoặc:
  - "Exact Match (khớp chính xác)"
  - "Cannibalization (đua giá nội bộ)"
  - "Statistical Significance Gate (cổng kiểm định số liệu)"
  - "Long-tail (cụm từ dài, chi tiết)"
- Số tiền: dấu phẩy ngàn (vd 526,759 VND)
- Bảng so sánh: ưu tiên thay vì văn xuôi
- Action trong Quick Win: cụ thể, đo được, kèm $ tác động
- Cảnh báo: 🚨 nghiêm trọng, ⚠️ cảnh báo

---

## 13. Trường hợp đặc biệt

| Tình huống | Hướng xử lý |
|------------|-------------|
| Account <30 ngày | Skip Statistical Gate, ghi rõ "data sơ khai" |
| Có 1 Tier 3 nhưng chi tiêu thấp <100K | Cảnh báo nhẹ, không action gấp |
| Search term có dấu/không dấu cùng intent | Merge khi compare (vd "định vị" và "dinh vi") |
| Search term tiếng Anh ("camera spy") | Chỉ keep nếu CVR ≥2% (intent người Việt biết EN) |
| Brand keyword "doscom" có CTR >40% | Note đây là brand — không ngạc nhiên, đừng kéo trung bình lên |
| Search term chứa tên đối thủ ("hikvision") | Cảnh báo nguy cơ Google strict policy. Nên Phrase, không Exact |
| Defensive brand chưa có | Quick Win đầu tiên, tạo ngay [doscom] Exact |
| Tier 1 có CPA cao nhưng SIS <50% | Không cảnh báo, tăng bid để chiếm thêm impression |

---

## 14. Checklist trước khi gửi báo cáo cho Duy

- [ ] Đã phân bậc 3-Tier
- [ ] Đã apply Statistical Significance Gate
- [ ] Trần CPA tính theo `0.6 × Bán − Vốn − VAT` từ KV (KHÔNG Misa)
- [ ] Đã liệt kê keyword disapproved (nếu có) ở đầu báo cáo
- [ ] Top đề xuất MỚI có Impact ước lượng (đơn dự kiến + $ tác động)
- [ ] Top đề xuất PAUSE đều có replacement (Cơ chế 2) hoặc đủ rule cứng
- [ ] Tất cả số liệu có dấu phẩy ngàn
- [ ] Negative keyword chung đã có ≥10 cụm
- [ ] Brand vs non-brand đã tách báo cáo
- [ ] Báo cáo dưới 2.000 từ — không lan man

---

## 15. Tham chiếu chéo

- **Parent skill**: `doscom-google-ads-audit` — audit tổng quan account, gọi skill này khi đến phần keyword
- **GDN/Display**: `doscom-gdn-audit` — banner, placement, PMax (KHÔNG keyword Search)
- **Brand identity** (cho headline + asset): `doscom-brand-guidelines`
- **Viết content quảng cáo**: `cong-thuc-viet-content-by-noti`
- **Thông tin SP** (lookup giá vốn, code, group): tham chiếu KV `/api/inventory`

---

*Phiên bản 1.0 · Tạo ngày 25/04/2026 · Tác giả: Claude × Duy · Skill này dành riêng cho tài khoản Google Ads MHDI 477-705-2298 của Doscom Holdings*


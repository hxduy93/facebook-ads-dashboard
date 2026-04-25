---
name: doscom-google-ads-audit
description: Hệ thống chấm điểm và phân tích chuyên sâu tài khoản Google Ads của Doscom Holdings theo 8 nhóm tiêu chí (tổng 100 điểm, xếp loại A-F), dựa trên công thức Lợi nhuận thực = Doanh thu − VAT 10% − Giá vốn − Chi phí quảng cáo, mục tiêu ≥30% Doanh thu. Áp dụng skill này khi Duy yêu cầu "chấm điểm tài khoản Google Ads", "kiểm toán Google Ads", "đánh giá hiệu quả quảng cáo Google", "phân tích Google Ads Doscom", "tìm cơ hội cải thiện nhanh", "audit Google Ads", "tài khoản Google Ads có vấn đề gì", hoặc bất kỳ yêu cầu phân tích chất lượng quảng cáo Google. KHÔNG dùng cho phân tích Facebook Ads (đã có doscom-fb-ads), TikTok Shop Ads, hoặc các nền tảng khác.
---

# Doscom Google Ads Audit — Hệ thống chấm điểm & phân tích

> Skill này đóng gói triết lý, công thức, các tiêu chí chấm điểm, và quy trình phân tích chuyên sâu tài khoản Google Ads của Doscom Holdings. Đọc kỹ trước khi nhận bất kỳ task nào liên quan đến đánh giá Google Ads cho Doscom.

---

## 1. Bối cảnh người dùng

- **Người dùng**: Duy — phụ trách quảng cáo Google Ads cho Doscom Holdings (tên pháp lý: Công ty TNHH Doscom Holdings, KHÔNG phải "Cổ phần")
- **Tài khoản Google Ads chính**: MHDI mã `477-705-2298`
- **Tổng số chiến dịch hiện chạy**: 22 chiến dịch (Search + Remarketing + Shopping)
- **Cách đặt giá thầu Doscom đang dùng**: KHÔNG dùng tROAS (target ROAS). Có thể là Manual CPC, Maximize Clicks, hoặc Maximize Conversions tuỳ chiến dịch
- **Ngôn ngữ làm việc**: tiếng Việt 100%, không pha tiếng Anh trừ khi là tên kỹ thuật bắt buộc
- **Đơn vị tiền tệ**: VNĐ. Timezone: Asia/Ho_Chi_Minh
- **Phong cách trả lời Duy thích**: rõ ràng, có bảng khi so sánh, có bước hành động cụ thể, không lan man

---

## 2. Triết lý chấm điểm — KHÁC biệt với chuẩn quốc tế

Vì Doscom KHÔNG đặt mục tiêu ROAS trên Google Ads, mọi tiêu chí phụ thuộc vào ROAS đều bị bỏ. Thay vào đó, hệ thống chấm điểm dựa trên **2 thước đo tuyệt đối**:

### Công thức Lợi nhuận cốt lõi

```
Lợi nhuận = Doanh thu − VAT 10% − Giá vốn − Chi phí quảng cáo
Mục tiêu: Lợi nhuận / Doanh thu ≥ 30%
```

### Công thức Trần Chi phí Quảng cáo

```
Trần QC tối đa = 0.6 × Giá bán − Giá vốn
```

Vượt trần này → lợi nhuận xuống dưới 30%. Đây là ngưỡng cảnh báo cứng.

### Cách tính ngưỡng đạt cho từng SP Doscom

| Sản phẩm | Giá bán | Giá vốn | Trần QC tối đa |
|----------|---------|---------|---------------|
| D1 Pro | 3.500.000đ | 413.272đ | **1.686.728đ** |
| D2 | 2.800.000đ | 341.134đ | **1.338.866đ** |
| D1 | 2.500.000đ | 404.917đ | **1.095.083đ** |
| DA8.1 Pro | 1.300.000đ | 408.686đ | **371.314đ** |
| DA8.1 | 980.000đ | 338.679đ | **249.321đ** |
| DR8 | 1.800.000đ | 476.282đ | **603.718đ** |
| DR1 New | 1.200.000đ | 322.409đ | **397.591đ** |
| DV1 mini | 1.290.000đ | 335.676đ | **438.324đ** |
| DT2 | 599.000đ | 211.457đ | **147.943đ** |
| Noma 911 | 199.000đ | 40.854đ | **78.546đ** |

Khi Claude phân tích chiến dịch nào đó, phải xác định nhóm SP tương ứng → tra trần QC → so sánh chi phí thực để chấm.

---

## 3. Cấu trúc 8 nhóm chấm điểm (tổng 100%)

| # | Nhóm | Trọng số | Lý do trọng số |
|---|------|----------|---------------|
| 1 | Theo dõi chuyển đổi & Tracking | **25%** | Tracking sai thì mọi chỉ số khác vô nghĩa |
| 2 | Hiệu quả lợi nhuận theo nhóm SP | **22%** | Đo trực tiếp khả năng đạt mục tiêu 30% |
| 3 | Lãng phí ngân sách | **13%** | Không có ROAS để cảnh báo sớm → cần phát hiện qua tín hiệu khác |
| 4 | Quảng cáo sáng tạo Search (RSA) | **12%** | Chất lượng RSA ảnh hưởng trực tiếp CTR + conversion. **GDN/PMax tách riêng → skill `doscom-gdn-audit`** |
| 5 | Cấu trúc & Loại khớp từ khoá | **10%** | Cấu trúc sai làm ngân sách phân bổ kém |
| 6 | Trang đích | **8%** | Trang đích chậm/lệch hướng đốt tiền click |
| 7 | Ngân sách & Thị phần hiển thị | **5%** | Cảnh báo bị giới hạn budget hoặc rank |
| 8 | Tuân thủ chính sách & Đồng bộ Analytics | **5%** | Đảm bảo chiến dịch không bị disapprove |

---

## 4. Chi tiết các check theo từng nhóm

### Nhóm 1 — Theo dõi chuyển đổi & Tracking (25%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Pixel chuyển đổi cài đặt và đang nhận sự kiện | Rất nghiêm trọng (×5) | Có sự kiện trong 24h qua | Không có 24-72h | Không có >72h hoặc chưa cài |
| Bật Enhanced Conversions (Chuyển đổi nâng cao) | Cao (×3) | Bật | - | Tắt |
| Có khai báo chuyển đổi chính (Primary) | Rất nghiêm trọng (×5) | ≥1 | - | 0 |
| Loại trừ IP nội bộ Doscom (38B Triệu Việt Vương HN, kho HCM) | Trung bình (×1.5) | Có lọc | - | Không lọc |
| Khoảng thời gian quy đổi (conversion window) | Thấp (×0.5) | 30-90 ngày | <30 hoặc >180 | Không cài |

### Nhóm 2 — Hiệu quả lợi nhuận theo nhóm SP (22%)

Đây là nhóm quan trọng thứ 2, đo trực tiếp khả năng đạt mục tiêu 30% lợi nhuận.

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| **% Lợi nhuận tổng tài khoản** | Rất nghiêm trọng (×5) | ≥30% | 15-30% | <15% |
| **Số nhóm SP đạt 30% LN** | Cao (×3) | ≥6/9 nhóm | 3-5/9 | <3/9 |
| **Tỷ lệ đơn lãi (LN ≥0%)** | Cao (×3) | ≥80% đơn | 50-80% | <50% |
| **Lợi nhuận tuyệt đối kỳ này** | Cao (×3) | Dương ≥10tr/30 ngày | 0-10tr | Âm |
| **Tỷ lệ chuyển đổi tổng** | Trung bình (×1.5) | ≥3% | 1.5-3% | <1.5% |
| **Phân bố điểm chất lượng (QS 8-10)** | Trung bình (×1.5) | ≥30% từ khoá | 15-30% | <15% |
| **Phân bố QS thấp (1-4)** | Trung bình (×1.5) | <10% từ khoá | 10-25% | >25% |

### Nhóm 3 — Lãng phí ngân sách (13%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| **Tỷ lệ chi phí QC vượt trần lãng phí** | Rất nghiêm trọng (×5) | <10% chi | 10-25% | >25% |
| Số từ khoá lỗ liên tục >2 tuần (CPA > Trần) | Cao (×3) | <5 từ | 5-15 | >15 |
| Search term không liên quan tích luỹ chi >5% | Cao (×3) | <10% | 10-25% | >25% |
| Từ khoá xác chết (0 impression 30 ngày) | Trung bình (×1.5) | <5 từ | 5-20 | >20 |

**Cách tính lãng phí (Search-only)**:
```
Lãng phí tổng =
  Lãng phí từ khoá Bậc 2/3 (CPA > trần, 0 conv)
  + Lãng phí search term không liên quan
  + Lãng phí từ khoá xác chết
```

> Lãng phí Display placement / PMax không tính ở đây — nằm trong skill `doscom-gdn-audit` Nhóm 3.

**Lưu ý**: KHÔNG tính từ khoá Bậc 1 (Cốt lõi) vào lãng phí — đó là cơ hội tối ưu, không phải lãng phí. Phân bậc từ khoá xem mục 6.

### Nhóm 4 — Quảng cáo sáng tạo Search (RSA) (12%)

> **GHI CHÚ**: Phần Display banner / GDN / Performance Max đã được tách thành skill chuyên sâu riêng `doscom-gdn-audit` (6 nhóm × 100 điểm). Khi user hỏi về banner, placement, PMax → chuyển sang skill đó. Skill này (`doscom-google-ads-audit`) chỉ chấm RSA của Search.

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Số tiêu đề trong RSA | Cao (×3) | ≥12/15 | 8-11 | <8 |
| Số mô tả trong RSA | Trung bình (×1.5) | ≥4 | 2-3 | <2 |
| Độ mạnh quảng cáo (Ad Strength) | Cao (×3) | ≥75% "Tốt"+ | 50-75% | <50% |
| Tuổi quảng cáo trung bình | Cao (×3) | <90 ngày | 90-180 | >180 |
| Tỷ lệ tiêu đề "Thấp" theo Google | Trung bình (×1.5) | <20% | 20-40% | >40% |

### Nhóm 5 — Cấu trúc & Loại khớp từ khoá (10%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Số từ khoá/nhóm quảng cáo | Cao (×3) | 5-20 | 21-30 | >30 |
| Tỷ lệ kiểu khớp Exact + Phrase | Trung bình (×1.5) | >60% | 40-60% | <40% |
| Mỗi ad group có ≥2 RSA | Cao (×3) | 100% | 50-99% | <50% |
| Mỗi chiến dịch 1 mục tiêu rõ ràng | Cao (×3) | Có | 1-2 lai | Trộn nhiều |
| Có dùng từ khoá loại trừ chung | Trung bình (×1.5) | ≥3 list | 1-2 | Không |

### Nhóm 6 — Trang đích (8%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Tốc độ tải mobile (LCP) | Rất nghiêm trọng (×5) | <2.5s | 2.5-4s | >4s |
| Tiêu đề H1 chứa từ khoá quảng cáo | Cao (×3) | Có | Một phần | Không |
| Có nút CTA rõ ràng | Cao (×3) | ≥1 | Có nhưng mờ | Không |
| Form ngắn (≤4 trường) | Trung bình (×1.5) | ≤4 | 5-7 | >7 |

### Nhóm 7 — Ngân sách & Thị phần hiển thị (5%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Search Impression Share | Trung bình (×1.5) | >70% | 50-70% | <50% |
| % Mất do ngân sách | Cao (×3) | <15% | 15-40% | >40% |
| % Mất do xếp hạng | Cao (×3) | <30% | 30-50% | >50% |

### Nhóm 8 — Tuân thủ chính sách & Đồng bộ Analytics (5%)

| Check | Mức độ | Đạt | Cảnh báo | Thất bại |
|-------|--------|-----|----------|----------|
| Quảng cáo bị disapprove | Rất nghiêm trọng (×5) | 0% | 1-5% | >5% |
| Auto-tagging GCLID bật | Trung bình (×1.5) | Bật | - | Tắt |
| Liên kết Google Analytics 4 | Trung bình (×1.5) | Đã liên kết | - | Chưa |

---

## 5. Công thức tính tổng điểm — 5 bước

### Bước 1 — Mỗi check có điểm thô

```
Đạt (PASS)       = 100 điểm
Cảnh báo (WARN)  = 50 điểm
Thất bại (FAIL)  = 0 điểm
Không áp dụng    = bỏ qua khỏi tử số và mẫu số
```

### Bước 2 — Nhân hệ số mức độ

```
Điểm có trọng số = Điểm thô × Hệ số mức độ
Hệ số: Rất nghiêm trọng ×5.0 / Cao ×3.0 / Trung bình ×1.5 / Thấp ×0.5
```

### Bước 3 — Tính điểm từng nhóm (quy về 0-100)

```
Điểm nhóm = (Σ điểm có trọng số đạt được) ÷ (Σ điểm có trọng số tối đa) × 100
```

### Bước 4 — Tính tổng

```
Tổng điểm = Σ (Điểm nhóm × Trọng số nhóm)
          = (Nhóm 1 × 25%) + (Nhóm 2 × 22%) + ... + (Nhóm 8 × 5%)
```

### Bước 5 — Xếp loại

| Điểm | Loại | Ý nghĩa |
|------|------|---------|
| 90-100 | A | Tốt — chỉ tinh chỉnh nhỏ |
| 75-89 | B | Khoẻ — vài điểm tối ưu |
| 60-74 | C | Cần sửa nhiều |
| 40-59 | D | Có lỗi lớn, đang lỗ tiền |
| <40 | F | Sai từ gốc, nên tái thiết |

---

## 6. Phân bậc từ khoá (bắt buộc làm trước khi áp quy tắc tạm dừng)

Trước khi quyết định tạm dừng từ khoá nào, phân loại theo 3 bậc (lấy từ kho `nowork-studio/toprank`):

| Bậc | Định nghĩa | Hành động |
|-----|------------|-----------|
| **Bậc 1 - Cốt lõi** | Từ khoá mô tả sản phẩm chính Doscom (máy dò nghe lén, camera giấu, thiết bị ghi âm, định vị GPS, NOMA chăm sóc xe) | **TUYỆT ĐỐI KHÔNG TẠM DỪNG.** Chỉ chẩn đoán và tối ưu |
| **Bậc 2 - Kế cận** | Liên quan nhưng không phải chính (camera nhà thông minh, ghi âm cuộc họp, định vị xe đạp...) | Áp quy tắc chuẩn sau khi vượt cổng kiểm định số liệu |
| **Bậc 3 - Không liên quan** | Sai ý định/sai dòng sản phẩm (camera quay phim, máy ghi âm chuyên nghiệp studio...) | Tạm dừng mạnh tay |

### Cổng kiểm định số liệu (chống quyết định trên mẫu nhỏ)

```
Số đơn dự kiến = Lượt nhấp × Tỷ lệ chuyển đổi trung bình tài khoản
Nếu số đơn dự kiến < 3:
    → Gắn nhãn "Dữ liệu chưa đủ"
    → KHÔNG áp quy tắc "0 đơn = tạm dừng"
```

---

## 7. Quick Win — Cơ hội cải thiện nhanh

Sau khi chấm điểm, lọc các check **thất bại** thoả 2 điều kiện:

1. Mức độ ≥ Cao (×3.0 trở lên)
2. Thời gian sửa ước tính dưới 15 phút

Sắp xếp theo **mức độ tác động** giảm dần:

```
Tác động = Hệ số mức độ × Trọng số nhóm × Cải thiện điểm dự kiến
```

### 5 Quick Win phổ biến nhất cho Google Ads

| Check thất bại | Hành động | Thời gian | Tác động dự kiến |
|----------------|-----------|-----------|------------------|
| Bật Enhanced Conversions | Tools → Conversions → Enable | 5 phút | +5-7 điểm tổng |
| Tạm dừng từ khoá Bậc 3 lỗ trên 2 tuần | Tab Keywords → Pause | 5-10 phút | +3-4 điểm |
| Loại trừ search term không liên quan | Add negative keyword | 10 phút | +2-3 điểm |
| Tạo từ khoá loại trừ chung (jobs, free, DIY...) | Negative keyword list | 10 phút | +1-2 điểm |
| Tăng số tiêu đề RSA lên ≥12 | Edit ad → thêm headline | 15 phút | +2-3 điểm |

---

## 8. Quy trình Claude áp dụng skill này

Khi user (Duy) yêu cầu phân tích Google Ads, làm theo 7 bước:

### Bước 1 — Lấy data từ pipeline có sẵn

Đọc 4 file JSON trong repo `facebook-ads-dashboard`:
- `data/google-ads-spend.json` — chi phí, click, impression theo chiến dịch và ngày
- `data/google-ads-search-terms.json` — search term thực
- `data/google-ads-placement.json` — vị trí đặt Display
- `data/google-ads-ads.json` — banner và RSA chi tiết
- `data/product-revenue.json` — doanh thu POS Pancake (3 nguồn Web + Zalo OA + Hotline)
- `data/product-costs.json` hoặc Inventory KV — giá vốn, giá bán

### Bước 2 — Phân loại từ khoá thành 3 bậc

Match keyword/campaign name với danh sách Bậc 1 (sản phẩm cốt lõi Doscom), còn lại Bậc 2 hoặc 3.

### Bước 3 — Chạy 8 nhóm check theo thứ tự

Với mỗi nhóm:
- Kiểm tra từng check theo ngưỡng đã định
- Gắn nhãn Pass/Warning/Fail
- Tính điểm nhóm theo công thức Bước 3

### Bước 4 — Tính tổng điểm + xếp loại

Áp công thức ở mục 5.

### Bước 5 — Lọc Quick Win

Theo công thức ở mục 7.

### Bước 6 — Xuất báo cáo theo format chuẩn

```markdown
# Báo cáo Google Ads Doscom — DD/MM/YYYY

## Tổng điểm: XX/100 — Xếp loại: A/B/C/D/F

[Bar chart 0-100]

## Tóm tắt
- 9 nhóm SP: [đếm 🟢 đạt 30%], [🟡 cảnh báo], [🔴 lỗ]
- Lợi nhuận tổng kỳ: XX triệu (XX% Doanh thu)
- [Nếu chưa đạt 30%]: cần thêm XX triệu lợi nhuận / cắt XX chi phí QC

## Điểm từng nhóm (8 nhóm)
| Nhóm | Điểm | Trọng số | Đóng góp |
|------|------|----------|----------|

## Top 5 Quick Win
1. [Action] — [Time] — [Tác động dự kiến]
...

## Phân tích chi tiết
### 1. Theo dõi chuyển đổi (XX/100)
...
### 2. Hiệu quả lợi nhuận (XX/100)
...
[và các nhóm khác]

## Cảnh báo nguy hiểm
- [Các check Rất nghiêm trọng đang FAIL]
```

### Bước 7 — Đề xuất bước tiếp

Hỏi Duy có muốn:
- Triển khai 1-2 Quick Win cụ thể không
- Đào sâu nhóm nào (ví dụ phân tích từ khoá lãng phí)
- So sánh với kỳ trước (7d / 30d / tháng trước)

---

## 9. Nguyên tắc thực chiến lấy từ 3 kho GitHub tham khảo

Skill này tổng hợp từ 3 kho mã nguồn mở chuyên về phân tích Google Ads:

1. **Mathias Chu — google-ads-analyzer**: Quy tắc loại bỏ 7 ngày gần nhất khỏi phân tích chuyển đổi (do conversion lag), ma trận thị phần hiển thị 2×2, công thức Smart Bidding
2. **Daniel Agrici — claude-ads**: Hệ thống chấm điểm trọng số 0-100, 250+ điểm kiểm tra cho 7 nền tảng quảng cáo
3. **Nowork Studio — toprank**: Phân bậc từ khoá Tier 1/2/3, cổng kiểm định số liệu, tư duy biên lợi nhuận

Các quy tắc cụ thể đã được áp vào 8 nhóm check ở trên, có ngưỡng cụ thể phù hợp Doscom.

---

## 10. Các trường hợp đặc biệt cần lưu ý

### Trường hợp 1 — Báo cáo trong giai đoạn ramp-up chiến dịch mới

Nếu chiến dịch mới chạy <14 ngày → ghi nhận đang ở giai đoạn học (Learning), không áp ngưỡng cảnh báo. Đợi đủ 14 ngày + 30 conversion mới chấm điểm thực.

### Trường hợp 2 — Chiến dịch Performance Max (PMax)

PMax là blackbox. Khi chấm:
- Không áp Quality Score (PMax không có)
- Quan tâm: Asset Group performance, Ad Strength, Brand Cannibalization (PMax có ăn cắp đơn từ Search Brand không)
- Cảnh báo nếu >30% conversion từ Brand keyword (cannibalization fail)

### Trường hợp 3 — Chiến dịch chưa có conversion tracking đầy đủ

Nếu Nhóm 1 (Tracking) bị FAIL > 50% checks → **không chấm điểm các nhóm khác**. Báo Duy fix tracking trước. Vì:
- Không có chuyển đổi đáng tin → không tính được lợi nhuận
- Mọi quyết định tối ưu đều dựa data sai

### Trường hợp 4 — Sản phẩm có Trần QC âm

Sản phẩm như **DT1 Pro** có giá vốn quá cao so với giá bán → Trần QC âm. Với SP này:
- Không thể chạy Google Ads có lãi 30%
- Khuyến nghị: tăng giá bán, giảm giá vốn, hoặc chấp nhận biên thấp hơn 30% riêng cho SP này
- Khi chấm điểm: bỏ SP này khỏi tính trung bình nhóm

---

## 11. Phong cách trình bày báo cáo

- **Ngôn ngữ**: Tiếng Việt 100%, tránh từ Anh-Việt lẫn lộn (trừ tên kỹ thuật như "Quality Score", "RSA")
- **Bảng**: dùng nhiều bảng so sánh, tránh đoạn văn dài
- **Con số**: dùng đơn vị "triệu", "ngàn" cho dễ đọc (vd: "1.5 triệu" thay vì "1,500,000")
- **Màu**: dùng emoji 🟢 (đạt), 🟡 (cảnh báo), 🔴 (thất bại), ❗ (rất nghiêm trọng)
- **Kết luận**: luôn kết bằng "đề xuất hành động cụ thể" có deadline ngắn (làm hôm nay / tuần này / 2 tuần)

---

## 12. Checklist trước khi gửi báo cáo cho Duy

- [ ] Đã loại bỏ data 7 ngày gần nhất khi phân tích chuyển đổi
- [ ] Đã phân bậc từ khoá Tier 1/2/3 trước khi quyết định pause
- [ ] Đã áp Cổng kiểm định số liệu (sample ≥3 conversion dự kiến)
- [ ] Đã tính lợi nhuận theo công thức 4 trừ: Doanh thu − VAT − Giá vốn − QC
- [ ] Đã đối chiếu chi phí QC nhóm vs Trần 60% giá bán − giá vốn
- [ ] Đã tính tổng điểm 8 nhóm theo trọng số chuẩn
- [ ] Đã liệt kê Top 5 Quick Win với thời gian sửa và tác động ước tính
- [ ] Có cảnh báo nếu phát hiện check Rất nghiêm trọng (×5) đang FAIL
- [ ] Báo cáo viết 100% tiếng Việt, có bảng, không lan man

---

*Phiên bản 1.0 · Tạo ngày 25/04/2026 · Skill này dành riêng cho tài khoản Google Ads MHDI 477-705-2298 của Doscom Holdings*

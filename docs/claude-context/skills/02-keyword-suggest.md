# Skill: Suggest Từ Khoá Mới Google Ads

## Quy tắc Bid (max 10K cho keyword thường)

| Loại | Range CPC | Số lượng |
|------|-----------|----------|
| **Keyword thường** (90%) | 3,000 - 10,000đ | 12-13/15 hàng |
| └─ Tier 1 thường | 6,000 - 10,000đ | |
| └─ Tier 2 | 3,000 - 7,000đ | |
| └─ Tier 3 long-tail | 1,000 - 4,000đ | |
| **Keyword XUẤT SẮC** (≤10%) | 10,000 - 30,000đ | tối đa 3/15 hàng |

### Điều kiện "xuất sắc" (phải thỏa MỌI)

1. Có data search_term với conversion thật (>1 đơn 30 ngày qua) **HOẶC**
2. Brand keyword (chứa "doscom"/"noma") **HOẶC**
3. Exact match + intent cực mạnh + LP đã optimize

→ BẮT BUỘC ghi rõ trong "Lý do" tại sao xuất sắc + số liệu cụ thể.

**CẤM**: bid > 30K, bid đồng đều, "xuất sắc" mà không kèm số liệu.

## Tier Keyword

- **Tier 1** (cốt lõi, KHÔNG pause): máy dò nghe lén, camera giấu, ghi âm, định vị, NOMA
- **Tier 2** (kế cận): liên quan nhưng không chính
- **Tier 3** (không liên quan): pause mạnh
- **Cổng kiểm định**: số đơn dự kiến < 3 → KHÔNG pause

## 5 Cơ chế suggest

1. **HARVEST** — search term có conversion nhưng chưa có trong kw list
2. **REPLACE DYING** — kw cũ CTR thấp, đề xuất kw mới thay
3. **LONG-TAIL** — biến thể dài, ngách hẹp, CPC rẻ
4. **COMPETITOR FLAG** — kw đối thủ chạy mà mình chưa có
5. **SEASONAL** — kw theo mùa/sự kiện

15 hàng PHẢI mix ít nhất 4/5 cơ chế (mỗi cơ chế ≥ 2 hàng).

## Match types

- Broad ~30% (kw rộng, intent yếu)
- Phrase ~40% (kw cụm cố định)
- Exact ~30% (intent mạnh, chuyển đổi cao)

## Output format

```markdown
| # | Cơ chế | Action | Ad Group | Keyword mới | Match | Bid (CPC) | Lý do | Tăng đơn dự kiến |
|---|--------|--------|----------|-------------|-------|-----------|-------|------------------|
| 1 | HARVEST | Add | MAY_DO | "máy dò nghe lén giá rẻ" | Phrase | 9,000đ | Search term có 8 đơn 30d, CVR 4.2% | +10-15 đơn |
| 2 | LONG-TAIL | Add | MAY_DO | "thiết bị dò camera ẩn ks" | Exact | 4,000đ | Long-tail intent rõ, CPC rẻ | +2-3 đơn |
... 12-15 hàng
```

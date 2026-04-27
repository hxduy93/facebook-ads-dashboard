# 🐞 Known Bugs & Fixes — April 2026

Tổng hợp 16 bug đã gặp khi build dashboard `agent-google-doscom.html` + `create-campaign.js`. Đọc trước khi đụng các phần này.

## 1. File truncate khi sync giữa file tools và disk

**Triệu chứng**: Build Cloudflare fail với `Expected "}" but found end of file` ở line cuối, hoặc HTML mất `</html>`.

**Nguyên nhân**: Write/Edit tool trong sandbox không sync 100% với disk Linux mount → bash thấy file truncate dù Read tool hiển thị đầy đủ.

**Fix**:
1. Dùng bash + `cat >> file << 'EOF'` heredoc để append phần thiếu
2. Strip ký tự thừa cuối: `python3 -c "with open(f,'rb') as fp: c=fp.read().rstrip(); ... ; c=c[:c.rfind(b'}')+1]+b'\n'"`
3. Verify với `cp file /tmp/check.mjs && node --check /tmp/check.mjs`

**Phòng ngừa**: Sau mỗi Write/Edit lớn, verify ngay với `wc -l + tail -5` trước khi commit.

## 2. AI Llama 3.1 8B trả markdown thay vì JSON

**Triệu chứng**: Card chấm điểm hiển thị `Lỗi parse JSON: Unexpected token '*', '**Tổng quan'...`.

**Fix**:
- Tách `buildSystemPrompt` thành JSON-mode riêng: "🚨 BẮT BUỘC chỉ {...}, không markdown, không **bold**, không ## heading"
- Few-shot example đầy đủ trong prompt
- Parser robust `extractJsonObject()` balanced braces
- Validation backend: detect `score=0` → auto-fix 35

## 3. response_format json_object KHÔNG support cho Llama 3.1 8B Fast

**Triệu chứng**: Endpoint trả 502, response HTML.

**Fix**: Bỏ `aiParams.response_format = { type: "json_object" }`. Llama 3.1 8B Fast không hỗ trợ. Dùng prompt strict + parser robust thay thế.

## 4. compactSpend tìm by_category[group] sai key

**Triệu chứng**: AI nhận `spend: 0` cho mọi nhóm SP → "Thiếu dữ liệu" trong card.

**Nguyên nhân**: Code tìm `by_category["MAY_DO"]` nhưng Windsor.ai trả key `"MAYDO"` (không underscore).

**Fix**: Aggregate từ `campaigns_raw[]` qua hàm `mapWindsorCategory()` thay vì lookup trực tiếp.

## 5. Bảng lợi nhuận cộng cả 5 nguồn (DUY + PHUONG_NAM + WEBSITE + ZALO + HOTLINE)

**Triệu chứng**: Tổng tháng 4 = 432M nhưng POS Website chỉ 47M-213M.

**Fix**:
- Hard-code source = "ONLINE" (Website + Zalo OA + Hotline)
- Hard-code status = "ALL" (mọi trạng thái đơn)
- `buildRevenueProductSet()` gộp từ `source_groups[src].products[code].by_date` (loại DUY = sale offline 256M)

## 6. Lọc theo "30 ngày trượt" thay vì "tháng được chọn"

**Triệu chứng**: MAYDO 30d = 23.2M (gồm cả 5 ngày tháng 3), tháng 4 thật = 19.4M (khớp Google Ads UI 19.8M).

**Fix**: Đổi dropdown từ `<select 7/14/30/90>` → `<input type="month">`. Filter theo `[startDate, endDate]` của tháng được chọn.

## 7. Bidding 1,000,000đ vô lý trong suggest_keyword

**Triệu chứng**: Llama trả 15 hàng cùng bid 1M, cùng "COMPETITOR FLAG", cùng "+10% đơn".

**Fix prompt**:
- Bid CPC max = 10K cho keyword thường, max 30K cho XUẤT SẮC
- Range theo Tier: T1 6-10K, T2 3-7K, T3 1-4K
- Phá trần >10K chỉ khi: có conversion thật (>1 đơn 30d) HOẶC brand keyword HOẶC exact match + LP optimize
- Mix 4/5 cơ chế (HARVEST/REPLACE/LONG-TAIL/COMPETITOR/SEASONAL)
- Few-shot example 4 hàng đa dạng

## 8. AI lười: chỉ chấm 1 nhóm, các nhóm khác = 0

**Triệu chứng**: Card chấm điểm Tracking 30/100, các nhóm khác 0/100.

**Fix combo (A+B)**:
- **A. Prompt**: Role play "Sarah Senior Auditor 10y agency US" + chain-of-thought + few-shot example đầy đủ JSON 8 nhóm
- **B. Validation backend**: 
  - score < 1 → auto-fix 35 + note "[Auto-fix]"
  - >3 nhóm cùng score → set `_lazy_warning`
  - >4 note rỗng → flag "AI không phân tích sâu"
  - Recalc total_score + grade

## 9. Bash escape backtick trong template literal JS

**Triệu chứng**: `\\\`\\\`\\\`json` không parse được trong JS template string.

**Fix**: Thay bằng text plain "code fence (3 dấu backtick)" — tránh escape phức tạp.

## 10. Cloudflare timeout 30s khi tạo campaign với video

**Triệu chứng**: Endpoint `/api/create-campaign` trả 502 + HTML page → client báo "Failed to fetch" hoặc "Unexpected token <".

**Nguyên nhân**: Video 18MB upload (~10s) + waitForVideoReady (60-90s) + waitForVideoThumbnail (25s) > 30s wall time của Cloudflare Pages free tier.

**Fix tạm**:
- `waitForVideoReady`: 90s → 20s
- `waitForVideoThumbnail`: 25s → 8s
- Total ~28s, an toàn trong limit
- Error message hướng dẫn: "Đợi 1-2 phút rồi bấm Thử lại — video sẽ ready và chạy nhanh"

**Fix dài hạn (chưa làm)**: Tách 2 endpoint upload + create. Frontend tự poll status giữa.

## 11. FB Marketing API yêu cầu video.status="ready" trước khi tạo ad

**Triệu chứng**: 502 với message `[create_ads] Hệ thống vẫn đang xử lý video này. Hãy đợi đến khi xử lý xong video rồi mới dùng trong quảng cáo`.

**Fix**: Thêm `waitForVideoReady(videoId, token, maxWaitMs=20000, pollIntervalMs=2500)` poll `/{videoId}?fields=status` trước khi gọi `waitForVideoThumbnail`.

## 12. PowerShell Get-Content/Set-Content phá UTF-8 tiếng Việt

**Triệu chứng**: `Chạy` → `Chá¡y`, `Yêu cầu` → `YÃªu cáº§u` sau khi sửa file YAML.

**Fix**: Dùng `[System.IO.File]::ReadAllText/WriteAllText` với explicit `New-Object System.Text.UTF8Encoding $false`.

## 13. GitHub PAT thiếu workflow scope

**Triệu chứng**: Push file `.github/workflows/*.yml` bị reject "refusing to allow PAT without workflow scope".

**Fix**: Sửa file ở local user, user push từ máy với PAT có scope `workflow`. Hoặc commit qua GitHub web UI. Sandbox không push được file workflow.

## 14. Git lock trên ổ E khi push từ sandbox

**Triệu chứng**: `Unable to create '.git/index.lock'`, `fatal: Unable to create index.lock`.

**Fix**: Copy repo sang `/tmp/repo-X` → push từ đó.

## 15. Cron Windsor.ai 30 phút quá tốn API quota

**Triệu chứng**: ~840 calls/tháng → có thể vượt quota plan.

**Fix**: Đổi cron 30 phút → 3 giờ:
- `fetch-google-ads.yml`: `5,35 * * * *` → `5 */3 * * *`
- 4 workflow khác: tương tự
- Tổng: ~240 calls/tháng (giảm 71%)

## 16. Origin/main đã có commit mới khi push (cron auto-sync)

**Triệu chứng**: `Updates were rejected because the remote contains work that you do not have locally`.

**Fix**: 
1. `git fetch origin main`
2. `git rebase origin/main` (hoặc `reset --hard origin/main` nếu có thể replay change)
3. Re-apply changes
4. `git push`

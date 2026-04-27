# 🧠 Memory — Tổng hợp 17 entries từ Claude Cowork (April 2026)

## 1. User Profile — Duy / Doscom

- **Tên**: Duy (tài khoản đăng ký dưới `Dos` / `doscom.vietnam@gmail.com` — tài khoản công ty dùng chung).
- **Vai trò**: Phụ trách vận hành Facebook Ads cho Doscom Holdings. Mô hình **lead-gen** (thu data), không phải e-commerce → KHÔNG có ROAS trực tiếp từ FB Ads.
- **Ngôn ngữ**: Tiếng Việt. Xưng "tôi", gọi user là "Duy".
- **Đơn vị**: VNĐ (₫). Timezone: Asia/Ho_Chi_Minh.
- **Kỹ năng**: Quen React artifacts, Cloudflare Pages, GitHub, Meta Ads MCP (qua Pipeboard), Excel/PowerPoint. Không phải dev nặng nhưng follow step-by-step được.
- **Việc thường nhờ**: Báo cáo tuần PPTX, phân tích FB Ads, viết content QC, review landing Ladipage, tạo/sửa React dashboard.

## 2. Doscom FB Ads Accounts (cập nhật 18/04/2026)

**6 ad accounts** thuộc BM **"Yoday Media Retail"**, tất cả VND, active. Dashboard CHỈ fetch 6 account này.

| Account ID | Tên BM (exact) | Màu dashboard |
|-----------|----------------|---------------|
| 927390616363424 | Doscom - Công nghệ nâng tầm cuộc sống | #3b82f6 blue |
| 764394829882083 | Doscom - Noma.vn - Giải Pháp Chăm Sóc Xe Hơi Toàn Diện | #ef4444 red |
| 1655506672244826 | CÔNG TY TNHH DOSCOM HOLDINGS - Noma Việt Nam | #10b981 green |
| 1449385949897024 | CÔNG TY TNHH DOSCOM HOLDINGS - Công nghệ nâng tầm cuộc sống | #f59e0b amber |
| 906015559004892 | Doscom Mart | #8b5cf6 purple |
| 1416634670476226 | CÔNG TY TNHH DOSCOM HOLDINGS - Doscom Mart | #06b6d4 cyan |

**Tên hiển thị**: Copy nguyên văn BM (gồm prefix "CÔNG TY TNHH DOSCOM HOLDINGS"). KHÔNG dùng tên rút gọn.

**5 sản phẩm cố định** chạy QC: D1, DR1, Noma911, DA8.1, DA8.1 Pro.

**Pixel mapping**:
- D1, DR1, DA8.1, DA8.1 Pro → `act_927390616363424`
- Noma 911 → `act_764394829882083`

## 3. 5 Sản Phẩm Doscom — Thông Tin Chính Xác (10/04/2026)

| Mã | Sản phẩm | Giá | Ghi chú |
|----|----------|-----|---------|
| **Noma911** | Kem lỏng tẩy ố kính ô tô 2in1 (100ml) | 199K | KHÔNG phải nước rửa kính. Đối thủ: 3M 93662 (86K), Sonax 337100 (100K), Libitu (79K) |
| **D1** | Máy dò nghe lén/camera ẩn/định vị | 2.5M | KHÔNG phải máy cảnh báo tốc độ. Đối thủ: GT13 (1.2M) |
| **DR1** | Thiết bị ghi âm 1 chạm (16GB, 30h liên tục) | 1.3M | KHÔNG phải camera hành trình |
| **DA8.1** | Camera gọi video 2 chiều màn hình 2.8" (đã bán 11.856) | 1.25M | KHÔNG phải máy lọc không khí |
| **DA8.1 Pro** | Camera gọi video 2 chiều cầm tay | 1.55M | KHÔNG phải máy lọc không khí |

**KH chính của Noma911**: 70% nam, 30-58 tuổi, sở hữu ô tô.

## 4. Pancake POS Sources

- **Shop ID**: `1942196207`
- **URL**: `https://pos.pancake.vn/shop/1942196207/...`
- **5 source groups** dashboard (`scripts/fetch_pancake_revenue.py` → `SOURCE_GROUPS`):

| Key | Label | Saved filter UUID | Raw source IDs |
|-----|-------|-------------------|---------------|
| DUY | DUY | `8350fe1d-fd9b-41d8-bb3a-f075a5e94df5` | 24 sources hardcoded |
| PHUONG_NAM | PHƯƠNG NAM | `78a874c7-0601-4416-a377-481dce360b87` | 1008799, 1536008673, 1229011407 |
| WEBSITE | Website | (sub-nhóm của `4bbb0478…`) | **921043352** |
| ZALO_OA | Zalo OA | (sub-nhóm của `4bbb0478…`) | **37931** |
| HOTLINE | Hotline | (sub-nhóm của `4bbb0478…`) | **614042808** |

Saved filter "Website" UUID = `4bbb0478-23cd-42d4-aa98-64003b61be6e` (gồm 3 source: WEBSITE + Zalo OA + Hotline).

**Auth**: Pancake API cần `access_token` JWT từ `localStorage.user.accessToken` (browser) hoặc `api_key` env `PANCAKE_API_KEY` (server).

## 5. Dashboard Auth (Google OAuth, 15/04/2026)

- Live tại: `https://facebookadsallinone.pages.dev`
- **3 file**: `functions/_middleware.js`, `functions/auth/login.js`, `functions/auth/callback.js`
- Cookie `doscom_session` HMAC-SHA256, 7 ngày
- **Google Cloud project**: "Tích hợp dữ liệu Youtube" (398769276241)
- **OAuth Client**: "Doscom Dashboard"
- **Whitelist**: `hxduy93@gmail.com`, `manhthangvu888@gmail.com`
- **Env vars**: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAILS, SESSION_SECRET

## 6. Weekly Competitor Radar Automation (11/04/2026)

- **Baseline**: `data/radar-baseline.json` — auto rotate weekly
- **Cowork task**: `competitor-radar-daily` — thứ 5, 9h sáng
- **Windows Task**: `Doscom_Radar_AutoPush` — thứ 5, 9:30 sáng
- **Repo**: `E:\Facebook Ads\github-repo`

## 7. GitHub Push Workflow

- **Repo**: `hxduy93/facebook-ads-dashboard`, branch `main`
- **Vấn đề**: Sandbox Linux không ghi được vào `.git/` trên ổ E (lock file)
- **Workaround**:
  1. `cp -r repo /tmp/ghrepo`
  2. `rm -f .git/index.lock`
  3. `git config user.email "doscom.vietnam@gmail.com"`
  4. Stage chỉ file liên quan task
  5. `commit -m "..."`
  6. `git push origin main`
- **Sau push**: nhắc user `cd /d "E:\Facebook Ads\github-repo" && git pull origin main`

## 8. GitHub PAT Thiếu Workflow Scope

- Token hiện tại chỉ có scope `repo`, KHÔNG có `workflow`
- **Hậu quả**: Không push được file `.github/workflows/*.yml` từ sandbox
- **Workaround**: User phải tạo PAT mới có scope `workflow` tại `github.com/settings/tokens` và push từ máy local

## 9. Skill `doscom-fb-ads`

- File: `Facebook Ads/.claude-skills/doscom-fb-ads/SKILL.md`
- Bao gồm: 4 ad account, 5 sản phẩm, template báo cáo tuần, content writing, landing page review, React dashboard, Cloudflare infra

## 10-17. Feedback Rules từ Duy

Xem chi tiết trong `06-FEEDBACK-RULES.md`. Tóm tắt 8 rule:

1. **Style trả lời**: Tiếng Việt, có bảng so sánh, step-by-step kỹ thuật, không postamble dài
2. **Chống lười**: Triển khai đầy đủ mọi ý, không rút gọn, không placeholder
3. **Hỏi trước khi push**: LUÔN hỏi user trước mỗi `git push`, kể cả khi user nói "push" turn trước
4. **Plan A trước, B sau**: Khi user nói "thử A, fail mới B" → chỉ làm A, không liệt kê B sẵn
5. **Gom commit**: 1 vấn đề = 1 commit, dùng `--amend`/`rebase` thay vì push 3-4 commit liên tiếp
6. **PowerShell UTF-8**: Dùng `[System.IO.File]` API thay vì `Get-Content`/`Set-Content` (mặc định ANSI)
7. **VN terminology**: Mọi term tiếng Anh trong UI/báo cáo phải kèm giải thích tiếng Việt (CTR = tỷ lệ click, CPC = chi phí mỗi click, ...)
8. **Common build errors**: Đọc skill `common-build-errors-doscom` trước khi code/git/PowerShell/CI

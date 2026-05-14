# GEO Content Pipeline — Hướng dẫn setup

Pipeline để: phát hiện lỗ hổng GEO → sinh title → sinh content + ảnh → user duyệt → auto-publish lên WordPress (doscom.vn + noma.vn).

---

## 1. Apply DB migration (chạy 1 lần)

Migration mới: `migrations/0003_create_content_pipeline.sql` — tạo 2 bảng `geo_content_queue` và `geo_article_performance`.

### Cách chạy

```bash
# Trong terminal repo root
npx wrangler d1 execute doscom_geo --remote --file=migrations/0003_create_content_pipeline.sql
```

Hoặc nếu chưa cài wrangler local, upload trực tiếp qua Cloudflare Dashboard:
- Workers & Pages → D1 → `doscom_geo` database → Console tab → paste nội dung file → Execute.

Verify:
```bash
npx wrangler d1 execute doscom_geo --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'geo_%'"
```
Phải thấy `geo_content_queue` và `geo_article_performance` trong list.

---

## 2. Tạo WordPress Application Password cho mỗi site

Bạn cần tạo 1 user "geo-agent" (hoặc dùng user admin) + 1 Application Password trên **MỖI site** (doscom.vn và noma.vn).

### Bước 2.1 — Đăng nhập WP admin của site

- doscom.vn: `https://doscom.vn/wp-admin`
- noma.vn: `https://noma.vn/wp-admin`

### Bước 2.2 — (Recommend) Tạo user mới riêng cho agent

**Tại sao tạo user riêng**: Nếu sau này muốn revoke quyền agent, chỉ cần xóa 1 user, không ảnh hưởng tài khoản chính.

- Users → Add New User
- Username: `geo-agent`
- Email: `geo-agent@doscom.vn` (hoặc email anh có)
- Role: **Editor** (đủ quyền tạo post + upload media, KHÔNG có quyền sửa setting/cài plugin)
- Generate password → lưu lại (sẽ không dùng trực tiếp)
- Save

### Bước 2.3 — Tạo Application Password

Application Password = mật khẩu riêng dùng cho API, không thể dùng để đăng nhập trình duyệt.

- Users → All Users → click vào `geo-agent` (hoặc admin user)
- Scroll xuống cuối trang → tìm section **"Application Passwords"**
- Nhập tên: `GEO Content Pipeline`
- Click **"Add New Application Password"**
- WP sẽ hiện 1 chuỗi dạng: `xxxx xxxx xxxx xxxx xxxx xxxx`
- **COPY NGAY** (sẽ không xem lại được).
- Bỏ space đi → còn chuỗi 24 ký tự liền.

### Bước 2.4 — Test thử Application Password

Mở Terminal/PowerShell, thay `<USER>` và `<APP_PWD>`:

```bash
curl -u "geo-agent:xxxxxxxxxxxxxxxxxxxxxxxx" https://doscom.vn/wp-json/wp/v2/users/me
```

Trả về JSON object với `id`, `name`, `roles: ["editor"]` → OK.
Nếu trả `{"code":"rest_not_logged_in"}` → password sai.

### Lưu ý quan trọng

- **Không bao giờ commit** Application Password vào Git.
- Application Password hoạt động độc lập với password đăng nhập browser → nếu bị lộ chỉ cần xóa cái App Password đó.
- Nếu site có plugin security (Wordfence, iThemes Security) chặn REST API → cần whitelist endpoint `/wp-json/wp/v2/*` cho user `geo-agent`.
- Nếu site dùng plugin SEO (Yoast / RankMath) → pipeline đã ghi meta description tự động vào field tương thích cả 2.

---

## 3. Set environment variables trong Cloudflare Pages

Vào **Cloudflare Dashboard → Workers & Pages → `facebookadsallinone` → Settings → Environment variables**.

Thêm các secrets sau (chọn type = **Encrypted**):

| Variable name | Giá trị | Ghi chú |
|---|---|---|
| `WP_DOSCOM_URL` | `https://doscom.vn` | KHÔNG có dấu `/` cuối |
| `WP_DOSCOM_USER` | `geo-agent` | Username trên doscom.vn |
| `WP_DOSCOM_APP_PWD` | `xxxxxxxxxxxxxxxxxxxxxxxx` | App password đã copy (bỏ space) |
| `WP_NOMA_URL` | `https://noma.vn` | |
| `WP_NOMA_USER` | `geo-agent` | |
| `WP_NOMA_APP_PWD` | `yyyyyyyyyyyyyyyyyyyyyyyy` | |

Nhớ chọn cả **Production** và **Preview** environment.

Sau khi save, **redeploy** Pages 1 lần để load env vars mới:
- Deployments → vào deployment mới nhất → "Retry deployment" hoặc push commit mới.

---

## 4. Verify pipeline đã hoạt động

### Test 1 — DB tables
Vào dashboard `facebookadsallinone.pages.dev` → tab "📝 Content Pipeline" → nếu thấy empty state "Chưa có article nào" → OK.

### Test 2 — Analyze gaps
Click nút **"🔍 Analyze gaps now"** → đợi 20-40 giây.

Nếu data GEO Monitor đã có (đã chạy ít nhất vài batch trước đó):
- Sẽ thấy thông báo "Phân tích xong, sinh X ý tưởng bài viết..."
- Queue list xuất hiện các ý tưởng với status "💡 Idea"

Nếu chưa có data GEO:
- Vào tab Monitor → click "Refresh" → kiểm tra `total runs > 0`.
- Nếu = 0: vào GitHub Actions → run workflow "GEO Monitor — batch processor" thủ công ít nhất 1 lần.

### Test 3 — Generate content
Trong queue, click **"✍️ Generate content"** trên 1 idea → status chuyển sang "✍️ Drafting..." → sau 15-30 giây thành "👁 Pending review" → bài đã có content.

Click **"👁 Preview & Edit"** để xem nội dung.

### Test 4 — Generate image
Trong modal Preview, tab **"🎨 Image"** → click **"Generate image"** (medium quality) → đợi 20-40 giây → ảnh hiển thị.

### Test 5 — Publish
Trong modal, tab **"🚀 Publish"** → chọn target site → chọn **"Draft"** trước (an toàn) → click Publish.

Nếu thành công: link tới bài WP hiện ra → vào WP admin xem có post mới ở Drafts.

---

## 5. Chi phí vận hành thực tế

Đã tính cho **18 bài/tháng** (mỗi bài 2000-2500 từ):

| Khoản | Chi phí/tháng |
|---|---|
| Monitor (2 click/tuần) | $6.55 |
| Sinh báo cáo gap (4 lần) | $0.20 |
| Sinh content (18 bài × Claude Haiku) | $0.54 |
| Sinh ảnh (18 × Flux Schnell trên CF Workers AI) | **$0 (FREE)** |
| Đo hiệu quả sau 14 ngày | $0.54 |
| Auto-publish WordPress | $0 |
| Cloudflare hosting + D1 | $0 |
| **TỔNG** | **~$7.83/tháng (~200k VNĐ)** |

Có thể giảm thêm bằng cách:
- Bỏ ChatGPT khỏi monitor (cắt $6.55) → còn ~$1.30/tháng (~33k VNĐ), nhưng mất engine quan trọng nhất
- Click monitor 1 lần/tuần thay vì 2 → tiết kiệm $3.30/tháng

**Note về Flux Schnell**: Free tier Cloudflare Workers AI cho 10,000 neurons/ngày. 1 ảnh Flux ~1500-3000 neurons → **~5-6 ảnh miễn phí/ngày**. Quá free tier: $0.011/1000 neurons (~$0.02-0.03/ảnh). Với 18 bài/tháng rải đều = dư free tier.

---

## 6. Workflow vận hành hàng tuần (đề xuất)

**Thứ Hai sáng** (10 phút):
1. Vào tab Monitor → click "Refresh" → xem có drop SoV bất thường không
2. Sang tab Content Pipeline → click "Analyze gaps now"
3. Đợi 30s → có ~10 ý tưởng mới trong queue

**Thứ Hai chiều** (1 giờ):
4. Trong queue, click "✍️ Generate content" cho 5-6 ý tưởng tốt
5. Chờ AI viết xong (~15-30s/bài)
6. Click "🎨 Gen image" trên những bài chuẩn bị publish

**Thứ Ba — Thứ Năm** (15 phút/bài):
7. Mở từng bài, đọc + sửa nội dung trong modal Edit
8. Review SEO meta, FAQ, schema
9. Khi sẵn sàng → tab Publish → chọn site + status "Draft"
10. Mở WP admin → đọc lại bản WP render → publish chính thức

**Thứ Sáu** (5 phút):
11. Click "Analyze gaps" lại để verify signal tuần trước
12. Plan content cho tuần sau

---

## 7. Troubleshooting

### "WP post create failed 401"
→ Application Password sai hoặc user không có quyền. Test bằng curl theo Bước 2.4.

### "WP post create failed 403"
→ Plugin security đang block REST API. Check Wordfence/iThemes settings, whitelist user `geo-agent` hoặc IP của Cloudflare.

### "Cannot create category"
→ User `geo-agent` thiếu permission. Đổi role lên `Editor` hoặc cấp custom capability `manage_categories`.

### "Workers AI binding 'AI' missing"
→ Chưa add binding. Vào Cloudflare Pages → Settings → Functions → Bindings → Add binding → **Workers AI** → name: `AI`. Sau đó redeploy.

### "Flux returned empty/invalid response" hoặc rate limit khi gen ảnh
→ Có thể đã vượt free tier 10K neurons/ngày. Đợi 24h hoặc giảm `steps` xuống 4 (mặc định).

### Content sinh ra bị cụt giữa chừng
→ Tăng `max_tokens` trong [generate-content.js](functions/api/geo/generate-content.js) hoặc đổi model sang `sonnet`.

### Schema JSON không hiển thị trong source code WP
→ Một số theme strip `<script>` trong content. Cần cài plugin "Insert Headers and Footers" hoặc custom code vào functions.php.

---

## 8. Roll back nếu cần

### Tắt pipeline tạm thời
Chỉ cần không click vào tab Content Pipeline. Nothing đăng tự động — luôn cần user click Publish.

### Xóa 1 bài đã publish nhầm
1. Vào WP admin → Posts → Trash bài đó
2. Vào D1 console: `UPDATE geo_content_queue SET status='rejected', reject_reason='manual rollback' WHERE id='...'`

### Xóa toàn bộ pipeline
```sql
DROP TABLE geo_content_queue;
DROP TABLE geo_article_performance;
```
Monitor (geo_runs, geo_queries...) vẫn còn nguyên, không ảnh hưởng.

---

## 9. Files & endpoints reference

### Files mới (Phase 5)
- `migrations/0003_create_content_pipeline.sql` — DB schema
- `functions/api/geo/_utils/claude.js` — helper gọi Claude qua AI Gateway
- `functions/api/geo/analyze-gaps.js` — endpoint phân tích lỗ hổng
- `functions/api/geo/generate-content.js` — endpoint sinh content
- `functions/api/geo/generate-image.js` — endpoint sinh ảnh
- `functions/api/geo/publish-wp.js` — endpoint publish WordPress
- `functions/api/geo/queue.js` — list queue
- `functions/api/geo/queue/[id].js` — GET/PATCH/DELETE 1 article
- `agent-geo-doscom.html` — UI mới (tab "Content Pipeline")

### Endpoints
| Method | URL | Mục đích |
|---|---|---|
| POST | `/api/geo/analyze-gaps` | Tìm lỗ hổng + sinh title đề xuất |
| POST | `/api/geo/generate-content` | Sinh full content cho 1 article |
| POST | `/api/geo/generate-image` | Sinh ảnh hero qua gpt-image-1 |
| POST | `/api/geo/publish-wp` | Publish lên WordPress |
| GET | `/api/geo/queue` | List articles |
| GET | `/api/geo/queue/:id` | Chi tiết 1 article |
| PATCH | `/api/geo/queue/:id` | Sửa article |
| DELETE | `/api/geo/queue/:id` | Reject article |

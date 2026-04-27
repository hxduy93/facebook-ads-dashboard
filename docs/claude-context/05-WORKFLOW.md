# 🔄 Workflow — Doscom Dashboard

## A. Push GitHub workflow (từ sandbox AI)

### Bước 1: Copy repo sang /tmp (vượt git lock)
```bash
SRC="/sessions/.../mnt/Facebook Ads/github-repo"
DST="/tmp/repo-push-$(date +%s)"
mkdir -p "$DST"
cp -r "$SRC/.git" "$DST/.git"
cd "$DST"
rm -f .git/index.lock
git fetch origin main
git reset --hard origin/main
```

### Bước 2: Apply file đã sửa
```bash
mkdir -p functions/api
cp "$SRC/functions/api/agent-google-ai.js" functions/api/agent-google-ai.js
git status --short
```

### Bước 3: Commit (CHỈ file liên quan task)
```bash
git -c user.email="doscom.vietnam@gmail.com" -c user.name="Duy Doscom" \
    add functions/api/agent-google-ai.js
git -c user.email="doscom.vietnam@gmail.com" -c user.name="Duy Doscom" \
    commit -m "fix(scope): description"
```

### Bước 4: Push (CHỈ KHI USER ĐÃ XÁC NHẬN)
```bash
git push origin main
```

### Bước 5: Hướng dẫn user pull về máy
```cmd
cd /d "E:\Facebook Ads\github-repo"
git pull origin main
```

## B. Cloudflare Auto-Build sau push

- Cloudflare Pages tự build trong **~2 phút** sau mỗi push lên `main`
- Build command: `pip install --user requests && SKIP_NETLIFY_DEPLOY=1 python3 update_dashboard.py`
- Output: `index.html` (905KB) được generate từ template.html
- Pages Functions tự deploy từ folder `functions/`

### Verify build OK
- Vào `https://dash.cloudflare.com` → Pages → `facebook-ads-dashboard` → Deployments
- Click commit hash → xem log
- Refresh dashboard → check feature mới hoạt động

## C. Sửa GitHub Workflow (cron schedule)

**KHÔNG push được từ sandbox** (PAT thiếu workflow scope) → user phải push từ máy:

```cmd
cd /d "E:\Facebook Ads\github-repo"
notepad .github\workflows\fetch-google-ads.yml
:: ... edit cron
git add .github/workflows/fetch-google-ads.yml
git commit -m "chore(cron): change schedule"
git push origin main
```

## D. Sync POS Pancake → KV Inventory

### Manual sync (1 lần)
1. Mở `https://pos.pancake.vn/shop/1942196207/`
2. F12 Console → `JSON.parse(localStorage.user).accessToken` → copy
3. Vào `https://facebookadsallinone.pages.dev/inventory.html`
4. Bấm "🔄 Đồng bộ từ POS" → paste token → confirm

### Auto sync
GitHub Actions workflow `fetch-pancake.yml` chạy mỗi 30 phút giờ hành chính (9h-17h30 VN). Cập nhật `data/product-revenue.json`.

## E. Cập nhật giá nhập từ Excel kho tổng

1. User chuẩn bị Excel `kho-tong.xlsx` đặt vào `data/cost-source/`
2. Chạy `scripts/build_product_costs.py` (hoặc workflow `update-product-costs.yml`)
3. Output: `data/excel-costs.json`
4. Trên dashboard inventory: bấm "💰 Cập nhật giá nhập từ Excel"

## F. Weekly Competitor Radar

### Auto (thứ 5 hàng tuần)
- 9:00 AM — Cowork task `competitor-radar-daily` chạy phân tích 5 SP
- 9:30 AM — Windows Task Scheduler `Doscom_Radar_AutoPush` chạy `push_radar.bat`

### Manual rerun
```cmd
cd /d "E:\Facebook Ads\github-repo"
push_radar.bat
```

## G. Generate báo cáo tuần PPTX

```bash
cd "E:\Facebook Ads\github-repo"
python scripts/generate_agent_report.py --week 17
```

Output: `Bao-cao-tuan/Tuan-17-2026.pptx`

## H. Test endpoint AI agent

```bash
# Get session cookie từ browser
curl -X POST https://facebookadsallinone.pages.dev/api/agent-google-ai \
  -H "Content-Type: application/json" \
  -H "Cookie: doscom_session=YOUR_COOKIE" \
  -d '{
    "mode": "audit_account_json",
    "context": {
      "product_group": "MAY_DO",
      "time_range": {"start": "2026-04-01", "end": "2026-04-30", "label": "Tháng 4/2026"}
    }
  }'
```

## I. Quick Debug Cloudflare timeout

Nếu endpoint Pages Function trả 502/524 HTML page:
1. Check **Cloudflare logs**: Pages → Functions → Real-time logs
2. Tìm exception trong code (vd `await env.AI.run()` timeout)
3. Giảm `max_tokens` hoặc đổi model FAST
4. Tách workflow dài thành nhiều endpoint nhỏ

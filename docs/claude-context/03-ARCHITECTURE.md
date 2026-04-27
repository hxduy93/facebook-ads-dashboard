# 🏗️ Architecture — Doscom Dashboard

## Stack tổng thể

```
USER → Cloudflare Pages → 2 dashboard:
       ├── facebookadsallinone.pages.dev/index.html         (FB Ads + Pancake KPI)
       └── facebookadsallinone.pages.dev/agent-google-doscom.html  (Google Ads AI agent)

Auth: Google OAuth (whitelist email) qua Pages Functions middleware

Backend (Pages Functions):
  /api/agent-google-ai      — POST: Llama 3.1 8B audit + suggest 9 modes
  /api/create-campaign      — POST: Tạo FB campaign + adset + ad (multipart upload)
  /api/inventory/*          — KV INVENTORY CRUD (sync POS Pancake)
  /api/radar-data           — Competitor weekly radar
  /api/generate-ad-copy     — AI gen content (deprecated)
  /auth/login + /auth/callback  — Google OAuth flow

Data (refreshed by GitHub Actions cron):
  data/google-ads-spend.json       — Windsor.ai (90d daily by_category)
  data/google-ads-search-terms.json
  data/google-ads-ads.json         — ad_aggregates dict 297 ads
  data/google-ads-placement.json   — 19,974 placements
  data/google-ads-context.json     — 22 campaigns per_campaign category
  data/product-revenue.json        — Pancake POS (90d daily by source × product × status)
  data/excel-costs.json            — Giá nhập SP từ Excel kho tổng
  data/radar-baseline.json         — Competitor weekly snapshot

KV Storage:
  INVENTORY namespace — 200 SP code → {gia_nhap_vnd, gia_ban_vnd, ton_kho, trang_thai}
  Sync từ POS Pancake (sync-pos.js) + Excel (apply-costs.js)
```

## Cron Schedule (GitHub Actions, mỗi 3 giờ — đã giảm từ 30 phút → 3h ngày 26/04/2026)

| Workflow | Cron | Tác dụng |
|----------|------|----------|
| `fetch-google-ads.yml` | `5 */3 * * *` | Spend từ Windsor.ai → `google-ads-spend.json` |
| `fetch-google-ads-search-terms.yml` | `10 */3 * * *` | Search terms |
| `fetch-google-ads-placement.yml` | `15 */3 * * *` | Placement |
| `fetch-google-ads-ads.yml` | `20 */3 * * *` | Ad-level |
| `compute-google-ads-context.yml` | `25 */3 * * *` | Gộp 4 file → context.json |
| `fetch-pancake.yml` | `0,30 2-10 * * *` | Pancake revenue (giờ hành chính VN) |
| `update-product-costs.yml` | (manual) | Đọc Excel kho tổng → JSON |
| `weekly-competitor-radar.yml` | (manual + Windows task) | Snapshot competitor weekly |

## Repo Structure

```
github-repo/
├── functions/
│   ├── _middleware.js              # Google OAuth gate (verify cookie HMAC)
│   ├── auth/
│   │   ├── login.js                # Redirect Google OAuth
│   │   └── callback.js             # Verify email whitelist + set cookie
│   └── api/
│       ├── agent-google-ai.js      # 9 mode audit/suggest/ask Llama 3.1 8B (730 lines)
│       ├── create-campaign.js      # FB Marketing API multipart upload (418 lines)
│       ├── inventory/
│       │   ├── index.js            # GET/POST KV INVENTORY
│       │   ├── sync-pos.js         # Pull POS Pancake → KV
│       │   └── apply-costs.js      # Excel cost → KV
│       ├── radar-data.js           # Competitor weekly snapshot
│       └── generate-ad-copy.js     # Deprecated AI content
├── scripts/                        # Python scripts cho cron
│   ├── fetch_google_ads_spend.py   # Windsor.ai → google-ads-spend.json
│   ├── fetch_google_ads_*.py       # search_terms, placement, ads
│   ├── compute_google_ads_metrics.py
│   ├── fetch_pancake_revenue.py    # Pancake → product-revenue.json
│   ├── build_product_costs.py      # Excel → excel-costs.json
│   └── generate_agent_report.py    # Báo cáo tuần
├── data/                           # JSON output từ cron
│   ├── google-ads-*.json
│   ├── product-*.json
│   └── radar-*.json
├── .github/workflows/              # 9 workflow YAML cron
├── template.html                   # Dashboard chính (FB Ads + Pancake KPI)
├── agent-google-doscom.html        # Agent Google Ads AI (795 lines)
├── inventory.html + inventory.js   # CRUD KV INVENTORY
├── update_dashboard.py             # Script build template.html → index.html
├── wrangler.toml                   # Cloudflare Pages config (BETA, không có pages_build_output_dir → bị skip OK)
└── docs/claude-context/            # Folder này (backup memory + skills)
```

## Cloudflare Pages Env Vars

| Var | Type | Dùng để |
|-----|------|---------|
| `FB_ACCESS_TOKEN` | Secret | Long-lived FB Marketing API token (hết hạn 2026-06-07) |
| `WINDSOR_API_KEY` | Secret | Windsor.ai connector |
| `WINDSOR_GOOGLE_ADS_ACCOUNT_ID` | Text | `477-705-2298` |
| `WINDSOR_GOOGLE_ADS_ACCOUNT_NAME` | Text | `MHDI` |
| `GOOGLE_CLIENT_ID` | Text | OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Secret | OAuth secret |
| `ALLOWED_EMAILS` | Text | `hxduy93@gmail.com,manhthangvu888@gmail.com` |
| `SESSION_SECRET` | Secret | HMAC key cho cookie |
| `PANCAKE_API_KEY` | Secret | Pancake server API |
| `AI` (binding) | Binding | Cloudflare Workers AI |
| `INVENTORY` (binding) | Binding | Cloudflare KV namespace |

## Mapping Categories (Windsor.ai → Doscom group)

```js
WINDSOR_TO_GROUP = {
  GHIAM:    "GHI_AM",
  MAYDO:    "MAY_DO",
  DINHVI:   "DINH_VI",
  CAMCALL:  "CAMERA_VIDEO_CALL",
  OTHER_DI: "CHONG_GHI_AM",
  OTHER_SIM:"CAMERA_4G",
  OTHER_CAM:(heuristic theo tên campaign: 4g/sim → CAMERA_4G, else → CAMERA_WIFI),
  OTHER_RAZOR: "OTHER",
  OTHER:    "OTHER",
}
```

## Mapping SP Code (Pancake) → Doscom group

```js
classifyByCode(code):
  /^DA8\.1/      → CAMERA_VIDEO_CALL
  /^DR\d/        → GHI_AM
  /^DI\d/        → CHONG_GHI_AM
  /^DV\d|^DT\d/  → DINH_VI
  /^DA(1 PRO 4G|1 ZOOMX6|2|3 PRO 4G|5\.1|6|6\.1|6\.2)/ → CAMERA_4G
  /^DA\d/        → CAMERA_WIFI
  /^D\d/         → MAY_DO
  /NOMA|A002/    → NOMA
```

## Models (Cloudflare Workers AI)

- **MODEL_FAST** = `@cf/meta/llama-3.1-8b-instruct-fast` (default mọi mode, tránh timeout 30s)
- **MODEL_BIG** = `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (deprecated cho mode hiện tại do timeout)

## 9 Modes của `/api/agent-google-ai`

| Mode | Skills | Data load | Output |
|------|--------|-----------|--------|
| `audit_account` | parent | context+spend+revenue+inv | Markdown |
| `audit_account_json` | parent | context+spend+revenue+inv | JSON 8 nhóm chấm điểm |
| `audit_keyword` | keyword | context+search_terms+spend+inv | Markdown |
| `audit_gdn` | gdn | context+ads+placement+spend+inv | Markdown |
| `audit_headline` | headline | ads+context+inv | Markdown |
| `suggest_keyword` | keyword | search_terms+context+inv | Markdown table 12-15 hàng |
| `suggest_headline` | headline | ads+context+inv | 10 brief headline |
| `suggest_banner` | gdn | ads+placement+inv | 5-7 brief banner |
| `ask` | tất cả 4 skill | context+spend+revenue+inv | Markdown free-form |

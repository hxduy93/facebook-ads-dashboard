# Doscom ERP — Onboarding cho AI Assistant

> File này dành cho **chat mới với AI** (Claude Code, Cursor, Antigravity, Copilot...).
> Paste/upload file này ở đầu chat để AI hiểu project ngay, không phải đọc lại 500+ tin nhắn lịch sử.
>
> **Last updated**: 2026-05-07. Latest commit: `33c7d07` (cache 24h + UI rõ ràng)

---

## 🎯 Project là gì

**Doscom Vietnam ERP** — dashboard quản lý FB Ads + Google Ads + Pancake POS cho công ty Doscom Holdings.

- **Live**: https://facebookadsallinone.pages.dev
- **Repo**: https://github.com/hxduy93/facebook-ads-dashboard
- **Working dir local**: `e:\Facebook Ads\github-repo`
- **User**: Hoang Xuan Duy (manhthangvu888@gmail.com)

## 🛠️ Stack

| Layer | Tech |
|---|---|
| Frontend | HTML + Vanilla JS + React (1 page tạo QC) + Tailwind CDN |
| Backend | Cloudflare Pages Functions (JavaScript, ESM) |
| Storage | Cloudflare KV (`INVENTORY` namespace) cho cache + history |
| AI | **Claude Sonnet 4.6** qua Cloudflare AI Gateway `doscom-erp` (fallback Llama 70B) |
| Data fetch | Python scripts trên GitHub Actions cron |
| Auth | Custom session cookie (HMAC) — admin allowlist `ALLOWED_EMAILS` |

## 📁 File chính

```
github-repo/
├── index.html                          ← Dashboard tổng (auto-build từ template.html)
├── template.html                       ← React tab "Tạo quảng cáo" (mới có loading screen 3D)
├── agent-facebook-doscom.html          ← Tab "Agent FB Ads" — KPI, profit, action buttons
├── agent-google-doscom.html            ← Tab "Agent Google Ads"
├── inventory.html                      ← Tab kho/sản phẩm
├── doscom-loading-screen.html          ← Standalone demo loading screen (chia sẻ team)
│
├── functions/api/                      ← Cloudflare Pages Functions
│   ├── agent-fb-ai.js                  ← FB Ads AI agent (Claude/Llama dispatch, KPI, profit)
│   ├── agent-google-ai.js              ← Google Ads AI agent
│   ├── fb-config.js                    ← GET/POST KPI + account mapping
│   ├── fb-actions.js                   ← Pause/update budget/duplicate adset
│   ├── fb-upload-media.js              ← Upload video/image FB (split khỏi create-campaign)
│   ├── create-campaign.js              ← Tạo campaign + adset + ad
│   ├── generate-ad-copy.js             ← AI sinh ad copy (Llama 3.3 70B)
│   ├── fb/snapshot.js                  ← GET snapshot data (profit, accounts, campaigns)
│   └── lib/fbAdsHelpers.js             ← compactFbCampaigns, computeFbProfitInRange, ...
│
├── data/                               ← Auto-fetched (GitHub Actions)
│   ├── fb-ads-data.json                ← FB campaigns/ads/insights
│   ├── product-revenue.json            ← Pancake orders + revenue
│   ├── product-costs.json              ← Giá nhập 13 SP
│   ├── google-ads-daily-report.json
│   ├── radar-baseline.json / radar-latest.json  ← Competitor radar
│   └── fb-config.json                  ← KPI tháng + account → group mapping
│
├── scripts/
│   ├── fetch_fb_ads.py                 ← Meta Marketing API → fb-ads-data.json
│   ├── fetch_pancake_revenue.py        ← Pancake POS API → product-revenue.json
│   ├── fetch_google_ads.py
│   └── ...
│
├── update_dashboard.py                 ← Build index.html từ template.html + data
├── .github/workflows/                  ← Cron jobs
│   ├── fetch-fb-ads.yml                ← mỗi 3h
│   ├── fetch-pancake.yml               ← mỗi 30 phút (10-17:30 VN)
│   ├── update.yml                      ← mỗi 30 phút (rebuild index.html)
│   └── ... (Google Ads, weekly competitor)
│
├── docs/claude-context/                ← Deep context cho AI (đọc nếu cần chi tiết)
│   ├── 01-CLAUDE-MD.md                 ← Hồ sơ công ty đầy đủ
│   ├── 02-MEMORY.md                    ← User profile + project memory
│   ├── 03-ARCHITECTURE.md              ← Architecture chi tiết
│   ├── 04-KNOWN-BUGS.md                ← Bug đã gặp + fix
│   └── 05-WORKFLOW.md                  ← Git push, Cloudflare deploy
│
└── ONBOARDING.md                       ← FILE NÀY (đầu mối cho chat mới)
```

## 🔑 Env vars (Cloudflare Pages → Settings → Variables)

| Tên | Loại | Dùng cho |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | Claude Sonnet 4.6 |
| `CF_ACCOUNT_ID` | Plaintext | URL AI Gateway |
| `FB_ACCESS_TOKEN` | Secret | Meta Marketing API (60 ngày hết hạn) |
| `PANCAKE_API_KEY` + `PANCAKE_SHOP_ID` | Secret + Plain | Fetch Pancake (chỉ dùng trong GitHub Actions) |
| `SESSION_SECRET` | Secret | HMAC session cookie |
| `ALLOWED_EMAILS` | Plaintext | Comma-list email được login |
| `GA_PROPERTY_ID` + `GA_SERVICE_ACCOUNT_JSON` | Plain + Secret | Google Analytics |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Plain + Secret | OAuth login |
| `TEST_BYPASS_TOKEN` | Secret | Bypass auth khi dev |
| `USE_CLAUDE` | Plaintext (optional) | Set `false` để revert về Llama |

## 🏗️ Tính năng đã hoàn thành (FB Ads agent)

### Core flow
1. User chọn time filter (today/week/month/...) → load profit summary từ Pancake
2. Click 1 account → auto-loop phân tích tất cả campaigns ACTIVE
3. Mỗi campaign: AI Sonnet → verdict (SCALE/KEEP/REFRESH/AUDIENCE/PAUSE) + scale_plan + dẫn chứng số liệu cụ thể

### Đã build
- ✅ Filter chỉ campaign ACTIVE + spend > 0
- ✅ Time range comparison (so kỳ trước với delta % + dẫn chứng dates)
- ✅ Profit attribution per campaign (account → group mapping → group profit × share spend)
- ✅ History KV: 10 entries/campaign + 12 months/staff
- ✅ Action buttons: Pause / Update budget (max +50%) / Duplicate adset, 2-step confirm + audit log
- ✅ KPI tháng input + tiến độ progress bar (auto-update)
- ✅ "Đánh giá tổng quan nhân sự" mode (DUY / PHƯƠNG NAM) với top/weak products + action plan 4 tuần
- ✅ Cache 24h (key gồm todayVN) → F5 cùng ngày = no cost
- ✅ Auto-fallback Claude → Llama nếu fail
- ✅ Debug fields trong response (claude_used, claude_error, claude_debug)

### Account mapping FB Ads (data/fb-config.json)

| Account ID | Staff | Groups SP | Note |
|---|---|---|---|
| 1449385949897024 | DUY | CAMERA_VIDEO_CALL + GHI_AM | DA8.1 + DR1 (MIXED) |
| 927390616363424 | DUY | MAY_DO | D1 |
| 1655506672244826 | DUY | NOMA | Noma chăm sóc xe |
| 764394829882083 | PHƯƠNG NAM | NOMA | Noma 911 |
| 906015559004892 | PHƯƠNG NAM | MAY_DO | D1 |
| 1416634670476226 | PHƯƠNG NAM | (rỗng) | Chưa chạy |
| 1418124406240173 | PHƯƠNG NAM | CAMERA_VIDEO_CALL | DA8.1 mới (chưa chạy) |

## 🧠 AI Modes (functions/api/agent-fb-ai.js)

| Mode | Skill | Model | Cache | History |
|---|---|---|---|---|
| `optimize_campaign` | fb_overview + fb_optimize | Sonnet (fallback Llama 70B) | 24h | 10 entries/campaign |
| `staff_overview` | fb_overview + fb_staff_overview | Sonnet | 24h | 12 months/staff |
| `audit_account_json` | fb_overview | Sonnet | 24h | — |
| `audit_account` / `audit_funnel` / `analyze_metrics` | fb_overview / fb_funnel | Sonnet | 24h | — |
| `ask` (Q&A free-form) | fb_overview + fb_funnel | Sonnet | — | — |

Skill prompts đều trong `agent-fb-ai.js` (object `SKILL_SUMMARY`).

## 🛡️ Pitfalls đã từng dính (xem chi tiết `docs/claude-context/04-KNOWN-BUGS.md`)

1. **Backtick trong template literal break JS** — đừng dùng `` ` `` trong prompt strings, dùng `"..."`
2. **Cloudflare 30s timeout** — split media upload ra endpoint riêng nếu video > 15MB
3. **`.git/index.lock` File exists** — chạy `Remove-Item .git\index.lock -Force` (PowerShell)
4. **Bash heredoc auto-escape `!`** — dùng `Write` tool thay heredoc
5. **PowerShell mojibake tiếng Việt** — dùng `[System.IO.File]::ReadAllText/WriteAllText` với UTF-8
6. **Cache hallucination** — Llama 70B đôi khi bịa số (vd "27 tỷ"). Disable Llama fallback cho mode quan trọng nếu cần
7. **`json()` undefined** trong functions — phải define `function json(obj, status)` ở đầu file (không như các file khác dùng `jsonResponse`)

## 🚀 Workflow mỗi lần làm việc trong chat MỚI

### Bước 1 — Mở chat mới với AI

(Claude Code / Cursor / Antigravity / Copilot — bất kỳ tool nào)

### Bước 2 — Paste/upload `ONBOARDING.md` này

```
@ONBOARDING.md           ← drag/drop hoặc reference file
```

Hoặc paste nội dung file này vào tin nhắn đầu.

### Bước 3 — Nói rõ task

Dạng:
```
Đã đọc ONBOARDING. Tôi muốn [làm gì cụ thể].

File liên quan: [path1, path2]
Bug/error nếu có: [paste exact error message]
```

Ví dụ:
- "Tôi muốn fix bug verdict KEEP đang hiển thị sai trong agent FB Ads. File: `agent-facebook-doscom.html`"
- "Thêm tab mới 'Báo cáo tuần' tổng hợp data 7 ngày. Layout giống tab Agent FB Ads"
- "Workflow GitHub Actions update.yml fail với error X. Log: ..."

### Bước 4 — Đợi AI làm + duyệt

- AI sẽ propose plan → bạn duyệt
- AI code → push (không tự push nếu chưa duyệt)
- Test trên Cloudflare Pages → báo kết quả

## 🔧 Common commands

```powershell
# Pull latest từ GitHub
cd "e:\Facebook Ads\github-repo"
git pull origin main

# Xem deploy gần nhất Cloudflare
# https://dash.cloudflare.com → Workers & Pages → tab "Deployments"

# Trigger workflow thủ công
# https://github.com/hxduy93/facebook-ads-dashboard/actions
# → click workflow → Run workflow

# Force redeploy (push empty commit)
git commit --allow-empty -m "redeploy"
git push origin main

# Xóa lock nếu git stuck
Remove-Item ".git\index.lock" -Force
```

## 📚 Sâu hơn nữa

- **Memory + user profile**: `docs/claude-context/02-MEMORY.md`
- **Architecture chi tiết**: `docs/claude-context/03-ARCHITECTURE.md`
- **Hồ sơ công ty + sản phẩm**: `docs/claude-context/01-CLAUDE-MD.md`
- **Bug history + fix**: `docs/claude-context/04-KNOWN-BUGS.md`
- **Git workflow + deploy**: `docs/claude-context/05-WORKFLOW.md`

## 💰 Cost estimate AI

Với usage hiện tại (6 accounts × 1 scan/ngày + 2 staff overview):
- **Claude Sonnet 4.6** qua AI Gateway: ~**$60-80/tháng**
- **Workers Paid**: $5/tháng base (10K neurons free + pay-as-go)
- **Total**: ~$65-85/tháng

→ ROI: 0.2-0.3% của FB ad spend (~300M VND/tháng).

## 📞 Khi gặp vấn đề

1. **AI không chạy / hallucinate**: F12 → Network → request `agent-fb-ai` → Response → check `claude_used` + `claude_error`
2. **Data không update**: GitHub Actions tab → check workflow status
3. **UI sai**: Cloudflare Pages → Deployments → check latest commit deploy success
4. **Lost context giữa chat**: Re-paste ONBOARDING.md đầu chat mới

---

**End of onboarding. AI đọc xong file này phải nắm được:**
- Doscom là gì + tech stack
- Cấu trúc file chính
- Tính năng đã build
- Workflow làm việc + pitfalls
- Cách verify deploy + debug

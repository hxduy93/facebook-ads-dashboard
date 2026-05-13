# GEO Monitor — Migrations

D1 migrations cho module GEO Monitor (theo dõi brand Doscom/NOMA trong câu trả lời AI).

## File trong thư mục này

| File | Mục đích |
|---|---|
| `0001_create_geo_tables.sql` | Tạo 5 bảng (queries, runs, citations, competitor_mentions, job_queue) + 6 indexes |
| `0002_seed_priority_queries.sql` | Insert 30 priority queries (20 Doscom + 10 NOMA) |

## Cách apply (Option A — Cloudflare Dashboard, không cần wrangler CLI)

### Bước 1 — Tạo D1 database
1. Vào https://dash.cloudflare.com → **Workers & Pages → D1** (sidebar trái)
2. Click **Create database**
3. Name: `doscom_geo`
4. Location: chọn `Asia-Pacific (APAC)` (gần VN)
5. Click **Create**
6. Note lại **Database ID** ở trang chi tiết (dạng `xxxx-xxxx-xxxx-...`)

### Bước 2 — Chạy migration tạo bảng
1. Vẫn ở trang database `doscom_geo` → tab **Console**
2. Mở file `0001_create_geo_tables.sql` → copy toàn bộ nội dung
3. Paste vào Console → click **Execute**
4. Verify: bên trái sidebar **Tables** thấy 5 bảng `geo_queries`, `geo_runs`, `geo_citations`, `geo_competitor_mentions`, `geo_job_queue`

### Bước 3 — Seed 30 queries
1. Vẫn ở tab Console
2. Copy nội dung `0002_seed_priority_queries.sql` → paste → Execute
3. Verify: chạy lệnh sau trong Console
   ```sql
   SELECT COUNT(*) FROM geo_queries;
   ```
   Kết quả phải là `30`.

### Bước 4 — Bind D1 vào Pages project
1. Vào **Workers & Pages → facebookadsallinone → Settings → Functions**
2. Cuộn xuống **D1 database bindings** → click **Add binding**
3. Variable name: `DB`
4. D1 database: `doscom_geo`
5. Click **Save**

### Bước 5 — Set 3 secrets API key
1. Vẫn ở **facebookadsallinone → Settings → Environment variables**
2. Click **Add variable** cho từng key dưới đây, **check "Encrypt"**:
   - `OPENAI_API_KEY` — lấy từ https://platform.openai.com/api-keys
   - `GEMINI_API_KEY` — lấy từ https://aistudio.google.com/apikey
   - `GROQ_API_KEY` — lấy từ https://console.groq.com/keys
3. **KHÔNG** set `ANTHROPIC_API_KEY` (đã có sẵn cho FB Ads agent, reuse).
4. Click **Save**
5. Trigger redeploy: vào tab **Deployments** → click **Retry deployment** ở bản latest, hoặc push commit trống.

## Checkpoint Phase 1 ✓

- [ ] D1 `doscom_geo` tồn tại
- [ ] `SELECT COUNT(*) FROM geo_queries;` = 30
- [ ] Pages binding `DB` → `doscom_geo`
- [ ] 3 secrets `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` đã set (encrypted)
- [ ] Latest deployment success sau khi add bindings/secrets

Sau khi xong → báo lại để bắt đầu Phase 2 (code 3 AI engine + brand detection).

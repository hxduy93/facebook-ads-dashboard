# Phase 0 Setup Guide — Doscom ERP

> **Trạng thái**: Code đã push (commit Phase 0). Cần user setup D1 + run schema + add nhân viên.
> **Effort**: ~30-45 phút setup, làm 1 lần.

## ✅ Đã code xong (server-side)

- `schema.sql` — Schema D1 đầy đủ 15 tables + seed data
- `functions/lib/rbac.js` — 6 role permission check
- `functions/lib/db.js` — D1 helper wrapper
- `functions/api/me.js` — Endpoint trả thông tin user đăng nhập
- `functions/api/admin/migrate.js` — Migrate JSON → D1 (CEO/COO only)
- `index.html` — Landing page ERP với 4 cards phòng ban + tools

## 📋 Bước User cần làm (5 bước)

### Bước 1: Tạo D1 database trên Cloudflare

1. Mở https://dash.cloudflare.com → chọn account `doscom.vietnam@gmail.com`
2. Sidebar trái → **Storage & Databases** → **D1 SQL Database**
3. Bấm **Create database**
4. Form:
   - **Database name**: `doscom-erp`
   - **Location**: `Asia Pacific (APAC)` (gần VN)
5. Bấm **Create**
6. Đợi ~10s, sẽ thấy database mới với **Database ID** dạng `abc123-def456-...`
7. **Copy Database ID** → lưu tạm

### Bước 2: Bind D1 vào Pages project

1. Workers & Pages → click project **`facebookadsallinone`**
2. Tab **Settings** → mục **Functions** (hoặc **Bindings**)
3. **Add binding** → chọn **D1 Database**
4. Form:
   - **Variable name**: `DB` (chính xác chữ này, code của tôi reference `env.DB`)
   - **D1 database**: chọn `doscom-erp` từ dropdown
5. **Save**
6. **Quan trọng**: redeploy project để binding có hiệu lực
   - Tab **Deployments** → click ⋮ ở deploy mới nhất → **Retry deployment**

### Bước 3: Run schema.sql vào D1

**Cách dễ nhất — qua Cloudflare Console**:
1. Workers & Pages → D1 → click `doscom-erp`
2. Tab **Console**
3. Mở file `schema.sql` trong repo (hoặc tại GitHub: https://github.com/hxduy93/facebook-ads-dashboard/blob/main/schema.sql)
4. Copy TOÀN BỘ nội dung
5. Paste vào ô Console
6. Bấm **Execute**
7. Sẽ thấy "✓ Successful" — tất cả tables tạo xong

**Verify**: trong Console gõ:
```sql
SELECT name FROM sqlite_master WHERE type='table';
```
→ thấy list 15 tables: departments, teams, employees, products, customers, leads, orders, ...

### Bước 4: Verify connection từ Pages Function

Sau khi deploy xong, mở browser:
```
https://facebookadsallinone.pages.dev/api/me
```

Kỳ vọng response:
```json
{
  "logged_in": true,
  "email": "doscom.vietnam@gmail.com",
  "employee": {
    "id": "emp_ceo_1",
    "name": "CEO Doscom",
    "department_id": "TECH",
    "role_level": 60,
    "role_label": "CEO"
  }
}
```

Nếu trả `db_status: { ok: false }` → D1 chưa bind đúng hoặc schema chưa run.

### Bước 5: Migrate data cũ → D1

1. Mở DevTools (F12) trong tab dashboard
2. Console tab, paste:
```javascript
fetch('/api/admin/migrate', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dry_run: true })
}).then(r => r.json()).then(console.log)
```

→ Xem dry_run output, kiểm tra số products/orders sẽ import.

3. Nếu OK → chạy thật:
```javascript
fetch('/api/admin/migrate', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dry_run: false })
}).then(r => r.json()).then(console.log)
```

→ Output sẽ show:
```json
{
  "dry_run": false,
  "steps": {
    "products": { "count": 45, "skipped": 12 },
    "orders": { "orders": 3453, "errors": [] },
    "snapshots": { "count": 90 }
  }
}
```

### Bước 6 (sau): Add 27 nhân viên Doscom

CEO/COO làm 1 lần, paste vào D1 Console:

```sql
-- Mẫu cấu trúc:
INSERT INTO employees (id, email, name, department_id, team_id, role_level, role_label, active) VALUES

-- ── Tech (4 người) ──
('emp_tech_1', 'tech1@doscom.vn', 'Nguyễn Văn A', 'TECH', 'TECH', 30, 'Leader Tech', 1),
('emp_tech_2', 'tech2@doscom.vn', 'Trần Văn B', 'TECH', 'TECH', 10, 'Nhân viên Tech', 1),
('emp_tech_3', 'tech3@doscom.vn', 'Lê Văn C', 'TECH', 'TECH', 10, 'Nhân viên Tech', 1),
('emp_tech_4', 'tech4@doscom.vn', 'Phạm Văn D', 'TECH', 'TECH', 10, 'Nhân viên Tech', 1),

-- ── Marketing (10 người, 5 team) ──
('emp_mkt_tp', 'tp.marketing@doscom.vn', 'TP Marketing', 'MARKETING', NULL, 40, 'TP Marketing', 1),
('emp_content_lead', 'leader.content@doscom.vn', 'Leader Content', 'MARKETING', 'CONTENT', 30, 'Leader Content', 1),
('emp_content_1', 'content1@doscom.vn', 'NV Content 1', 'MARKETING', 'CONTENT', 10, 'Nhân viên', 1),
('emp_fb_lead', 'leader.fb@doscom.vn', 'Leader FB', 'MARKETING', 'FB_ADS', 30, 'Leader FB Ads', 1),
('emp_fb_1', 'fb1@doscom.vn', 'NV FB Ads 1', 'MARKETING', 'FB_ADS', 10, 'Nhân viên', 1),
('emp_gg_1', 'gg1@doscom.vn', 'NV Google Ads', 'MARKETING', 'GG_ADS', 30, 'Leader GG', 1),
('emp_tt_1', 'tt1@doscom.vn', 'NV TikTok', 'MARKETING', 'TIKTOK', 10, 'Nhân viên', 1),
('emp_shopee_1', 'shopee1@doscom.vn', 'NV Shopee', 'MARKETING', 'SHOPEE', 10, 'Nhân viên', 1),

-- ── Sales/CSKH (10 người) ──
('emp_kd_tp', 'tp.kd@doscom.vn', 'TP Kinh doanh', 'SALES', NULL, 40, 'TP KD', 1),
('emp_duy', 'duy@doscom.vn', 'DUY', 'SALES', 'SALES_REP', 10, 'Sales Rep', 1),
('emp_phuong_nam', 'phuongnam@doscom.vn', 'PHƯƠNG NAM', 'SALES', 'SALES_REP', 10, 'Sales Rep', 1),
-- ... thêm 7 sales rep + CSKH

-- ── Kho (3 người) ──
('emp_kho_lead', 'leader.kho@doscom.vn', 'Leader Kho', 'WAREHOUSE', 'WAREHOUSE', 30, 'Leader Kho', 1),
('emp_kho_1', 'kho1@doscom.vn', 'NV Kho 1', 'WAREHOUSE', 'WAREHOUSE', 10, 'Nhân viên', 1),
('emp_kho_2', 'kho2@doscom.vn', 'NV Kho 2', 'WAREHOUSE', 'WAREHOUSE', 10, 'Nhân viên', 1);
```

⚠ **Quan trọng**: email phải KHỚP với email Google của nhân viên (vì login qua Google OAuth).

→ Sau khi add xong, mỗi nhân viên login bằng Google account → ERP nhận diện đúng role.

---

## 🎯 Sau khi xong setup

Test workflow:
1. Truy cập https://facebookadsallinone.pages.dev/ → thấy ERP landing page mới
2. Login bằng Google (đã setup OAuth)
3. Thấy avatar + tên + role hiển thị ở header
4. Click card phòng ban → vào tool tương ứng

**Nếu role STAFF**: chỉ thấy phòng mình
**Nếu role LEADER+**: thấy hết 4 phòng

---

## 📋 Phase 1 next (Warehouse module)

Sau khi Phase 0 chạy ngon, tôi sẽ build:
- `pages/warehouse/inventory.html` v2 (UI mới, đọc từ D1)
- API: stock CRUD, movement log, low stock alert
- Migrate inventory.html cũ thành phiên bản v2

---

## 🆘 Troubleshooting

### `/api/me` trả 500 error
→ DB binding chưa setup hoặc schema chưa run. Check Bước 2 + 3.

### Login Google OAuth nhưng ERP nói "Email chưa đăng ký"
→ Email đó chưa add vào `employees` table. Add bằng Bước 6.

### Migrate trả error "constraint failed"
→ Có thể đã có data cũ conflict. Check D1 Console: `SELECT * FROM products LIMIT 10;`

### Schema run fail giữa chừng
→ D1 console không hỗ trợ multi-statement đôi khi. Chia schema.sql thành nhiều block, paste từng block.

---

Liên hệ tôi (Claude Code) nếu kẹt bất kỳ bước nào.

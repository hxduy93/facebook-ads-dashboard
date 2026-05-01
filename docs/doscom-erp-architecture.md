# Doscom ERP — Kiến trúc tổng thể

> **Mục tiêu**: chuyển dashboard hiện tại thành ERP module-based cho 4 phòng ban Doscom.
> **Tech stack**: Cloudflare Pages + Functions + D1 (SQLite) + KV + R2 + Workers AI.
> **Trạng thái**: Draft v2 — confirmed user requirements.

## ✅ User confirmations (locked)

| Tham số | Giá trị | Note |
|---|---|---|
| **Số user** | 27 (Tech 4 + Marketing 10 + KD/CSKH 10 + Kho 3) | Plus 2-3 management trên 27 |
| **Permission hierarchy** | 6 levels: CEO > COO > TP Marketing > Leader > Phó Leader > Nhân viên | Hierarchical inheritance |
| **Pancake integration** | Read-only (chỉ pull) | KHÔNG push back order |
| **Mobile** | ALL departments cần | PWA mobile-first, responsive design |
| **Data migration** | Migrate 1 lần JSON/Pancake → D1 | Giữ historical từ đầu |
| **Retention** | Lưu data tổng kết cả năm | Cần aggregation table + snapshot strategy |

## 📊 Cost estimate (revised cho 27 user)

| Service | Free tier | Doscom usage | Cost |
|---|---|---|---|
| Cloudflare Pages | 100K req/day | 27 user × ~50 req/day = 1.4K req | Free |
| Cloudflare D1 | 5M writes/mo, 25M reads/mo (paid) | ~100K orders/year + queries | $5/mo (Workers Paid plan, recommended) |
| Cloudflare KV | 100K reads/day | Used for cache | Free |
| Cloudflare R2 | 10GB | Content assets ~5GB | Free |
| Workers AI | 10K neurons/day free | Need 50K+/day | $5/mo (with Paid plan) |
| **TỔNG** | | | **$5-10/tháng** |

---

## 1. Cấu trúc tổ chức Doscom

```
                    ┌────────────────────────┐
                    │   GIÁM ĐỐC / OWNER     │
                    │   (top dashboard)      │
                    └───────────┬────────────┘
                                │
        ┌─────────────┬─────────┼─────────┬──────────────┐
        ▼             ▼         ▼         ▼              ▼
  ┌──────────┐  ┌──────────┐ ┌────┐  ┌─────────┐  ┌──────────┐
  │ CÔNG     │  │MARKETING │ │KINH│  │ KHO     │  │ (FUTURE: │
  │ NGHỆ     │  │ (5 teams)│ │DOANH│  │         │  │  HR, KT) │
  │          │  │          │ │ +  │  │         │  │          │
  │ - Infra  │  │ - Content│ │CSKH│  │ - Stock │  │          │
  │ - APIs   │  │ - FB Ads │ │    │  │ - Cost  │  │          │
  │ - Data   │  │ - GG Ads │ │    │  │ - Order │  │          │
  │ - Deploy │  │ - TikTok │ │    │  │   ship  │  │          │
  │ - Bug    │  │ - Shopee │ │    │  │         │  │          │
  └──────────┘  └──────────┘ └────┘  └─────────┘  └──────────┘
```

---

## 2. Module suggest cho từng phòng ban

### 🔧 Phòng Công nghệ (Tech)

Vai trò: **maintainer** — không sản xuất nội dung, đảm bảo hạ tầng cho 3 phòng kia.

| Module | Tính năng | Trạng thái |
|---|---|---|
| **System Health** | Uptime monitor, API quota (CF Workers AI, Google Ads, Meta), error rate, response time | ⏳ TODO |
| **Integration Hub** | Quản lý API key, webhook, OAuth token (Google/FB/Pancake) — tự động alert khi token expire | ⏳ TODO |
| **User & Permissions** | RBAC (owner/admin/marketer/sales/warehouse/viewer) — ai thấy gì, làm gì | ⏳ TODO |
| **Cost Tracker** | Track cost Cloudflare + Anthropic API + Apify + GA + Meta — chia per-team | ⏳ TODO |
| **Deploy Log** | History các commit + deploy + rollback trigger | ⏳ TODO |
| **Audit Trail** | Log mọi action quan trọng (ai pause campaign, ai update stock) | ⏳ TODO |

### 📈 Phòng Marketing (5 teams)

#### a. Team Content
| Module | Tính năng | Status |
|---|---|---|
| **Content Calendar** | Lịch đăng FB/IG/TikTok/Web theo tuần/tháng, drag-drop | 🚧 Đã có agent |
| **Asset Library** | Kho ảnh/video/copy reusable, tag theo SP/nhóm | ⏳ TODO |
| **Brand Guidelines** | Color, logo, voice, USP per nhóm SP | ⏳ TODO |
| **Trend Monitor** | TikTok trends + Google Trends + Apify scraping (đối thủ) | ⏳ TODO |
| **SEO Blog Manager** | Quản lý bài blog, keyword target, tracking traffic | ⏳ TODO |
| **Content Performance** | Per asset: views, leads, conversions → biết content nào win | ⏳ TODO |

#### b. Team Facebook Ads ✅
| Module | Tính năng | Status |
|---|---|---|
| **FB Ads Agent** | 5 modes: audit, funnel, metrics, ask + scorecard 8 nhóm | ✅ DONE (v1 yesterday) |
| **FB Profit Tracker** | Filter DUY+PHƯƠNG NAM, profit per nhóm SP | ✅ DONE |
| **Lead Inbox Sync** | Pull lead từ FB Lead Form → push Pancake | ⏳ TODO |
| **Creative Library FB** | Top performing ads, viral rate, CTR ranking | ⏳ TODO |
| **Audience Manager** | LAL audience refresh, demographic/geo split | ⏳ TODO |
| **Pixel Debug** | Verify pixel firing, event volume per page | ⏳ TODO |

#### c. Team Google Ads ✅
| Module | Tính năng | Status |
|---|---|---|
| **Google Ads Agent** | Audit account, keyword, GDN, headline, suggest | ✅ DONE |
| **GA Overview** | Sessions, engagement, top LP, device split | ✅ DONE |
| **Keyword Research** | Suggest keyword với Google Suggest + Trends | ✅ DONE |
| **SERP Monitor** | Daily check top 10 SERP cho 20 kw chính | ⏳ TODO |
| **Quality Score Tracker** | QS theo kw, history, alert khi giảm | ⏳ TODO |
| **Conversion Tracker** | Link Pancake order → Google Ads campaign attribution | ⏳ TODO |

#### d. Team TikTok Shop
| Module | Tính năng | Status |
|---|---|---|
| **TikTok Shop Dashboard** | Top selling, GMV, traffic source breakdown | ⏳ TODO |
| **Live Stream Tracker** | History live + GMV per session + creator performance | ⏳ TODO |
| **Affiliate Pipeline** | 30+ creator pipeline, commission, DM template | ⏳ TODO |
| **Trend Sound Detector** | Bắt sound rising trước peak qua Apify | ⏳ TODO |
| **Comment Mining** | Đào objection từ comment, auto reply template | ⏳ TODO |
| **TikTok Ads Agent** | (Future, similar pattern FB Ads) | ⏳ TODO |

#### e. Team Shopee Media ✅
| Module | Tính năng | Status |
|---|---|---|
| **Media Agent** | (User mentioned đã có) | ✅ DONE |
| **Shopee Listing Manager** | Quản lý product listing, ảnh, mô tả, giá | ⏳ TODO |
| **Voucher/Promotion** | Quản lý voucher, flash sale | ⏳ TODO |
| **Shopee Ads Tracker** | Spend, ROAS, top performing keyword | ⏳ TODO |
| **Order Status** | Track order Shopee, dispute, return | ⏳ TODO |

### 💼 Phòng Kinh doanh & CSKH

| Module | Tính năng | Status |
|---|---|---|
| **CRM Inbox** | Tổng hợp lead từ FB/Google/Zalo/Hotline → assign sales | ⏳ TODO (có Pancake làm 1 phần) |
| **Lead → Order Pipeline** | Track conversion từng lead, time-to-close | ⏳ TODO |
| **Sales Rep Performance** | KPI per rep: leads handled, close rate, revenue (DUY, PN, ...) | ⏳ TODO |
| **Customer Database** | Hồ sơ KH: LTV, mua lần 2, complaint history | ⏳ TODO |
| **Order Management** | Sync Pancake/POSPancake → ERP, status tracking | 🚧 Partial (có data) |
| **Complaint & Return** | Ghi nhận khiếu nại, return process | ⏳ TODO |
| **After-sales Follow-up** | Auto schedule check-in 7d/30d after delivery | ⏳ TODO |
| **Sales Forecast** | Dự đoán đơn tuần tới dựa lead volume hiện tại | ⏳ TODO |
| **Voice Call Log** | Hotline integration, ghi âm + transcript | ⏳ TODO |

### 📦 Phòng Kho

| Module | Tính năng | Status |
|---|---|---|
| **Inventory Real-time** | Stock level per SKU per kho | 🚧 Có inventory.html cơ bản |
| **Product Master** | Master data SP: cost, sell price, weight, supplier | 🚧 Có product-costs.json |
| **Stock Movement Log** | Lịch sử nhập/xuất/chuyển kho | ⏳ TODO |
| **Low Stock Alert** | Auto alert khi stock < threshold | ⏳ TODO |
| **Supplier Management** | NCC info, terms thanh toán, lead time | ⏳ TODO |
| **Purchase Order** | Tạo PO, track delivery, receive | ⏳ TODO |
| **Stock Taking** | Kiểm kê định kỳ, đối soát | ⏳ TODO |
| **Barcode/QR** | In/scan barcode picking | ⏳ TODO |
| **Multi-warehouse** | (nếu có nhiều kho) | ⏳ TODO |

---

## 3. Mối liên kết / data flow giữa các phòng

### 3.1 Sơ đồ data ownership (ai owns gì)

```
┌─────────────────────────────────────────────────────────────────┐
│  SHARED DATA LAYER (Cloudflare D1 + KV + R2)                   │
│                                                                 │
│  Tables (D1):                                                   │
│  ├── products      ◀── Owner: KHO (master), readonly: others   │
│  ├── customers     ◀── Owner: KD (master), readonly: Marketing │
│  ├── leads         ◀── Owner: MARKETING (write), KD (read+update│
│  │                     status)                                  │
│  ├── orders        ◀── Owner: KD (write), KHO (update ship),   │
│  │                     Marketing (read attribution)             │
│  ├── inventory_mvt ◀── Owner: KHO                              │
│  ├── ad_campaigns  ◀── Owner: MARKETING (per team)             │
│  ├── content_assets◀── Owner: CONTENT, used by all marketing   │
│  ├── employees     ◀── Owner: TECH (admin)                     │
│  └── audit_log     ◀── Owner: TECH (auto-write)                │
│                                                                 │
│  KV (cache + state):                                           │
│  ├── ai_token_cache (GA, Anthropic OAuth)                      │
│  ├── stock_alerts (real-time threshold)                        │
│  └── pending_actions (FB Ads agent suggest queue)              │
│                                                                 │
│  R2 (file storage):                                            │
│  ├── content_assets/    (ảnh/video Content team)               │
│  ├── ad_creatives/       (FB/Google ad media)                  │
│  └── reports/            (PDF audit reports)                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Workflow chính (cross-department)

#### Workflow A: FB Lead → Đơn hàng → Ship → After-sales

```
[Marketing FB Ads]                 [KD/CSKH]                 [KHO]
  Run FB campaign                                                
       │                                                         
       ▼                                                         
  Lead form submit ──────► leads table (auto-assign rep)        
                                │                                
                                ▼                                
                          DUY/PN gọi điện                       
                                │                                
                                ▼                                
                          Close order? ─yes─► orders table      
                                                  │              
                                                  ▼              
                                            Stock reserve ─────► inventory_mvt
                                                                         │
                                                                         ▼
                                                                   KHO ship
                                                                         │
                                                                         ▼
                                                            orders.shipped_at
                                ┌────────────────────────────────────┘
                                ▼
                          Customer receive
                                │
                                ▼
                          delivered status
                                │
                                ▼ (after 7d)
                          CSKH follow-up call
                                │
                                ▼
                          customers.ltv++ + tag positive/negative
                                │
                                ▼
                                feedback ────► Marketing dashboard (audience refinement)
```

#### Workflow B: Content team → Marketing channels

```
[CONTENT team]                 [FB Ads / GG Ads / TikTok]
  Tạo asset mới                                              
   (video DA8.1 demo)                                        
       │                                                     
       ▼                                                     
  Upload to R2                                               
       │                                                     
       ▼                                                     
  content_assets row                                         
   (metadata: SP, USP, type)                                 
       │                                                     
       ▼ (notify webhook)                                    
                              FB Ads team:                   
                              "Asset mới cho DA8.1 — dùng?" 
                                       │                     
                                       ▼                     
                              tag asset vào campaign          
                              ad_campaign_assets             
                                       │                     
                              Run ad                         
                                       │                     
                                       ▼                     
                              Performance back to             
                              content_assets.metrics         
                              (CTR, lead, ROAS)              
                                       │                     
       ◀──────────────────────────────┘                     
  Content team thấy             
  asset nào win →               
  làm thêm cùng style           
```

#### Workflow C: Kho → Marketing (low stock pause)

```
[KHO]                          [Marketing FB/GG]
  Stock < threshold (vd 10)                              
       │                                                  
       ▼                                                  
  KV stock_alerts publish event                          
       │                                                  
       ▼ (webhook)                                        
                              Dashboard alert popup       
                              "Camera D1 còn 8 cái"      
                                      │                   
                                      ▼                   
                              FB Ads agent suggest:       
                              "Pause campaigns cho D1     
                               cho đến khi restock"      
                                      │                   
                              User chấp nhận → pause      
       ◀─────────────────────────────┘                   
  KHO restock                  
  Stock > 50                   
       │                                                  
       ▼                                                  
  KV publish                   
       │                                                  
       ▼ (webhook)                                        
                              Auto suggest resume         
                              campaigns đã pause          
```

#### Workflow D: Sales feedback → Marketing audience tuning

```
[KD/CSKH]                       [Marketing]
  Sales rep gọi lead             
       │                         
       ▼                         
  Đánh tag lead:                
  - "fake_lead"                  
  - "price_complaint"            
  - "wrong_target_audience"     
  - "high_intent"                
       │                         
       ▼                         
  leads.tags updated             
       │                         
       ▼ (aggregated weekly)     
                                Dashboard Marketing:    
                                "Campaign X: 30% lead    
                                 báo giá cao → review    
                                 audience hoặc copy"    
                                          │              
                                          ▼              
                                Adjust targeting/copy    
```

### 3.3 Sales Rep Performance flow

```
[KD/CSKH] track DUY, PHƯƠNG NAM, etc.
       │
       ▼
sales_kpi table (per rep, per week):
  - leads_assigned
  - leads_called
  - leads_closed (= orders created)
  - revenue_generated
  - close_rate %
  - avg_time_to_close
       │
       ▼
[FB Ads team] dùng để:
  - Calc lead-to-order rate per FB campaign
  - Track which sales rep best for which audience
  - Compute ROAS chính xác (revenue / spend)
       │
       ▼
Dashboard cá nhân từng sales rep:
  - Hôm nay đã gọi bao nhiêu lead
  - Tuần này close bao nhiêu đơn
  - Ranking trong team
```

---

## 3.4 Permission hierarchy (6 levels)

```
Level 60 — CEO                                  ⚪ Toàn quyền, xem + sửa mọi thứ
   │
Level 50 — Giám đốc vận hành (COO)              🟢 Toàn quyền trừ user/billing
   │
Level 40 — Trưởng phòng (TP Marketing, etc.)    🟡 Quyền full trong phòng + read all
   │
Level 30 — Leader team                          🟠 Manage team + read other teams
   │
Level 20 — Phó Leader                           🔵 Hỗ trợ leader, edit team data
   │
Level 10 — Nhân viên                            ⚫ Edit own assigned items only
```

### Permission matrix (key actions)

| Action | Staff | Phó Lead | Leader | TP | COO | CEO |
|---|---|---|---|---|---|---|
| Xem data phòng mình | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Xem data phòng khác | 👁 (readonly) | 👁 | ✅ | ✅ | ✅ | ✅ |
| Edit lead/order assigned cho mình | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit lead/order của staff khác | ❌ | ✅ team mình | ✅ team mình | ✅ phòng mình | ✅ all | ✅ |
| Pause FB/GG campaign | ❌ | ❌ | ✅ team Ads | ✅ marketing | ✅ | ✅ |
| Update inventory stock | ❌ | ❌ | ✅ kho | ❌ | ✅ | ✅ |
| Tạo employee mới (HR) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Sửa permission người khác | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Xem cost API + billing | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Export báo cáo cả năm | ❌ | ❌ | ✅ team mình | ✅ phòng | ✅ | ✅ |

### RBAC implementation

```javascript
// functions/lib/rbac.js
export const ROLE_LEVELS = {
  CEO: 60,
  COO: 50,
  DEPT_HEAD: 40,    // TP Marketing, TP Kinh doanh, etc.
  TEAM_LEADER: 30,  // Leader Content, Leader FB Ads, etc.
  DEP_LEADER: 20,   // Phó leader
  STAFF: 10,
};

// Tất cả route đều check qua:
export function canAccess(user, resource, action) {
  // 1. CEO/COO bypass mọi thứ
  if (user.level >= 50) return true;
  
  // 2. TP Marketing có quyền trên 5 team Marketing + readonly khác
  if (user.role === 'DEPT_HEAD') {
    if (resource.department === user.department) return true;
    if (action === 'read') return true;
    return false;
  }
  
  // 3. Leader có quyền trên team mình
  if (user.role === 'TEAM_LEADER') {
    if (resource.team === user.team) return true;
    if (action === 'read' && resource.department === user.department) return true;
    return false;
  }
  
  // 4. Phó leader giống leader, giảm 1 vài action sensitive
  // 5. Staff: chỉ edit assigned to mình
  if (user.role === 'STAFF') {
    if (resource.assigned_to === user.id) return true;
    if (action === 'read' && resource.team === user.team) return true;
    return false;
  }
  
  return false;
}
```

---

## 3.5 Mobile-first design (TẤT CẢ phòng ban cần)

### Approach: PWA + Responsive
- 1 codebase HTML/CSS responsive cho desktop + mobile
- Service worker để work offline 1 phần (xem cache)
- Add to home screen → app icon
- Push notification (sau Phase 0)

### Mobile-specific UX per dept

| Phòng | Mobile use case ưu tiên |
|---|---|
| **Sales/CSKH** | Click-to-call lead, mark đơn từ điện thoại khi đi gặp KH |
| **Kho** | Camera scan barcode để check tồn kho, log xuất nhập |
| **Marketing** | Approve FB/GG ad pause/scale on-the-go, xem alert trên di động |
| **Tech** | System health alert, deploy status check |
| **CEO/COO** | Executive dashboard, KPI realtime |

### CSS approach
- **Tailwind utility-first** — dễ responsive (`sm:`, `md:`, `lg:` breakpoints)
- Hoặc CSS variables + media queries (cách hiện tại)
- Layout mobile: bottom navigation (4-5 icon), sidebar collapsible

---

## 4. Database schema (Cloudflare D1)

```sql
-- ────── MASTER DATA ──────

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  group_code TEXT,            -- MAY_DO, NOMA, etc.
  cost_vnd INTEGER,           -- giá nhập
  sell_vnd INTEGER,           -- giá bán
  current_stock INTEGER DEFAULT 0,
  reorder_threshold INTEGER DEFAULT 10,
  supplier_id TEXT,
  status TEXT DEFAULT 'active',  -- active | discontinued | pending
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE,
  name TEXT,
  email TEXT,
  city TEXT,
  ltv_vnd INTEGER DEFAULT 0,
  first_order_at TEXT,
  last_order_at TEXT,
  total_orders INTEGER DEFAULT 0,
  status TEXT DEFAULT 'lead',  -- lead | customer | vip | churned
  notes TEXT
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  department TEXT,             -- TECH | MARKETING | KD | KHO
  team TEXT,                   -- CONTENT | FB_ADS | GG_ADS | TIKTOK | SHOPEE | SALES | CSKH | WAREHOUSE
  role TEXT,                   -- owner | admin | manager | staff | viewer
  active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  payment_terms TEXT,
  lead_time_days INTEGER
);

-- ────── TRANSACTIONAL ──────

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  source TEXT,                 -- FB_ADS | GG_ADS | TIKTOK | SHOPEE | HOTLINE | ZALO
  campaign_id TEXT,
  customer_phone TEXT,
  captured_at TEXT,
  assigned_to_employee_id TEXT,
  status TEXT,                 -- new | contacted | qualified | closed | lost
  tags TEXT,                   -- JSON array: ["price_complaint","high_intent"]
  notes TEXT,
  closed_order_id TEXT,        -- FK nếu đã chốt
  FOREIGN KEY (assigned_to_employee_id) REFERENCES employees(id),
  FOREIGN KEY (closed_order_id) REFERENCES orders(id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  pancake_order_id TEXT,
  customer_id TEXT,
  lead_id TEXT,
  total_vnd INTEGER,
  items_json TEXT,             -- [{product_id, qty, unit_price}]
  sales_rep_id TEXT,
  status TEXT,                 -- pending | confirmed | shipped | delivered | returned | canceled
  created_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  channel TEXT,                -- FB_ADS | GG_ADS | etc. (attribution)
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (sales_rep_id) REFERENCES employees(id)
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  qty INTEGER,                 -- âm = xuất, dương = nhập
  type TEXT,                   -- IN | OUT | TRANSFER | ADJUSTMENT
  reference_type TEXT,         -- ORDER | PURCHASE | RETURN | STOCKTAKE
  reference_id TEXT,
  warehouse_id TEXT,
  by_employee_id TEXT,
  created_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (by_employee_id) REFERENCES employees(id)
);

CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY,
  channel TEXT,                -- FB | GOOGLE | TIKTOK | SHOPEE
  name TEXT,
  external_id TEXT,            -- ID trên platform (FB campaign ID)
  budget_daily_vnd INTEGER,
  status TEXT,
  product_group TEXT,
  start_date TEXT,
  end_date TEXT,
  owner_employee_id TEXT,
  created_at TEXT
);

CREATE TABLE content_assets (
  id TEXT PRIMARY KEY,
  type TEXT,                   -- IMAGE | VIDEO | COPY | LANDING_PAGE
  title TEXT,
  product_group TEXT,
  url TEXT,                    -- R2 public URL
  thumbnail_url TEXT,
  created_by_employee_id TEXT,
  performance_json TEXT,       -- {fb_ctr: 2.5%, gg_ctr: 3.1%, tt_views: 50K}
  used_in_campaigns TEXT,      -- JSON array of campaign IDs
  created_at TEXT
);

-- ────── KPI / REPORTING ──────

CREATE TABLE sales_kpi (
  id TEXT PRIMARY KEY,
  employee_id TEXT,
  period_start TEXT,           -- weekly aggregation
  period_end TEXT,
  leads_assigned INTEGER,
  leads_contacted INTEGER,
  orders_closed INTEGER,
  revenue_vnd INTEGER,
  avg_time_to_close_hours REAL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT,
  employee_id TEXT,
  department TEXT,
  action TEXT,                 -- 'pause_campaign' | 'update_stock' | 'create_order'
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT
);

-- ────── STOCK ALERTS (denormalized) ──────

CREATE TABLE stock_alerts (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  level TEXT,                  -- LOW | OUT
  triggered_at TEXT,
  resolved_at TEXT,
  notified_departments TEXT
);
```

---

## 5. Tech architecture

### 5.1 Folder structure

```
github-repo/
├── functions/                       # Cloudflare Pages Functions (backend API)
│   ├── api/
│   │   ├── _shared/                # Shared middleware, helpers
│   │   ├── tech/                   # Phòng Công nghệ APIs
│   │   ├── marketing/
│   │   │   ├── content/
│   │   │   ├── fb/
│   │   │   ├── gg/
│   │   │   ├── tiktok/
│   │   │   └── shopee/
│   │   ├── sales/                  # Phòng KD/CSKH
│   │   └── warehouse/              # Phòng Kho
│   ├── lib/                        # Shared business logic
│   │   ├── db.js                   # D1 wrapper
│   │   ├── auth.js                 # RBAC
│   │   ├── webhook.js              # Cross-dept events
│   │   └── ai.js                   # Workers AI wrapper
│   └── _middleware.js              # Auth gate
│
├── pages/                          # Frontend pages (per department)
│   ├── index.html                  # Landing — chọn phòng ban
│   ├── tech/                       # Tech department UI
│   ├── marketing/
│   │   ├── content.html
│   │   ├── fb-ads.html             # ✅ ĐÃ CÓ (agent-facebook-doscom.html)
│   │   ├── gg-ads.html             # ✅ ĐÃ CÓ (agent-google-doscom.html)
│   │   ├── tiktok.html
│   │   └── shopee.html             # ✅ Có agent media
│   ├── sales/
│   │   ├── crm.html
│   │   ├── orders.html
│   │   └── kpi.html
│   └── warehouse/
│       ├── inventory.html          # 🚧 ĐÃ CÓ basic
│       ├── purchase.html
│       └── stock-take.html
│
├── shared/                         # Shared UI components
│   ├── layout.html                 # Sidebar nav giữa modules
│   ├── theme.css
│   └── components.js
│
├── data/                           # JSON snapshots (cache)
├── docs/                           # Architecture docs
├── .github/workflows/              # Cron jobs sync data
└── schema.sql                      # D1 init schema
```

### 5.2 Tech stack

| Layer | Tech | Cost free | Cost full |
|---|---|---|---|
| Hosting + Functions | Cloudflare Pages | 100K req/day free | $5/mo (Workers Paid → 10M req) |
| Database | Cloudflare D1 (SQLite) | 5M writes/mo, 100K reads/day | Same paid tier |
| Cache | Cloudflare KV | 100K reads/day, 1K writes/day | Same |
| File storage | Cloudflare R2 | 10GB + 10M ops/mo | $0.015/GB/mo overage |
| AI | Workers AI (Llama) + Anthropic API | 10K neurons/day free | $5/mo Workers Paid |
| Cron | Cloudflare Workers Cron | 1K trigger/day free | Same |
| Email | Resend | 3K email/mo free | $20/mo (50K emails) |
| Analytics | Cloudflare Web Analytics | Free | Free |

**Tổng cost ước tính**: ~$5-15/tháng cho ERP đầy đủ 30-50 user.

---

## 5.3 Migration plan (chuyển data cũ vào D1)

Khi bắt đầu setup D1, chạy script migration 1 lần để import data lịch sử:

### Script migration (function tạm dùng 1 lần)

```javascript
// functions/api/admin/migrate.js (chỉ CEO/COO chạy được)
export async function onRequestPost(context) {
  const { env } = context;
  const summary = { products: 0, customers: 0, orders: 0, leads: 0 };
  
  // 1. Migrate products từ product-costs.json + Pancake
  const costs = await fetchJson("/data/product-costs.json");
  const revenue = await fetchJson("/data/product-revenue.json");
  for (const [key, p] of Object.entries(costs.products)) {
    if (!p.gia_nhap_vnd) continue;
    await env.DB.prepare(`
      INSERT OR REPLACE INTO products 
      (id, sku, name, group_code, cost_vnd, sell_vnd, current_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(key, p.sku || key, p.dinh_danh, classifyGroup(p.dinh_danh),
      p.gia_nhap_vnd, p.gia_ban_vnd, parseInt(p.ton_kho) || 0).run();
    summary.products++;
  }
  
  // 2. Migrate customers + orders từ Pancake source_groups (DUY + PHƯƠNG NAM)
  for (const sg of ["DUY", "PHUONG_NAM"]) {
    const products = revenue.source_groups[sg]?.products || {};
    for (const [name, p] of Object.entries(products)) {
      // Tạo order placeholder cho mỗi by_date entry
      // (Chi tiết order_id sẽ pull thực từ Pancake API riêng)
    }
  }
  
  // 3. Migrate fb-ads-data.json
  // 4. Migrate google-ads-spend.json
  // 5. Migrate competitor data
  
  return jsonResponse({ ok: true, migrated: summary });
}
```

### Pancake live sync (sau migration)

Sau khi migrate xong, **GitHub Actions cron 1h/lần** pull Pancake order mới:
```
.github/workflows/sync-pancake.yml
  - cron: hourly
  - call Pancake API → get orders since last_sync timestamp
  - INSERT INTO orders + customers
  - Update last_sync state
```

→ ERP luôn có data Pancake fresh trong 1h.

---

## 5.4 Yearly retention strategy (lưu data tổng kết cả năm)

Đây là yêu cầu rất quan trọng. Plan:

### Lớp 1: Raw data (D1 main tables)
Giữ NGUYÊN tất cả transactions:
- `orders` — không xoá, index by `created_at`
- `leads` — không xoá
- `inventory_movements` — không xoá

→ Với 27 user × 100 orders/ngày = 36K orders/năm = vài MB → D1 nuốt thoải mái.

### Lớp 2: Daily snapshots (cho dashboard nhanh)
Mỗi ngày 23:55 cron job tạo snapshot:

```sql
CREATE TABLE daily_snapshots (
  date TEXT PRIMARY KEY,           -- '2026-04-30'
  total_revenue_vnd INTEGER,
  total_orders INTEGER,
  total_leads INTEGER,
  fb_spend_estimated INTEGER,
  gg_spend INTEGER,
  by_group_json TEXT,               -- {"MAY_DO": {revenue:..., orders:...}, ...}
  by_channel_json TEXT,             -- {"FB":..., "GG":..., "TIKTOK":..., "SHOPEE":...}
  by_sales_rep_json TEXT,           -- {"DUY":..., "PHUONG_NAM":...}
  notes TEXT
);
```

→ Dashboard query "doanh thu 365 ngày qua" = 365 row, nhanh 50ms.

### Lớp 3: Monthly aggregates (cho báo cáo CEO)

```sql
CREATE TABLE monthly_summary (
  month TEXT PRIMARY KEY,           -- '2026-04'
  total_revenue_vnd INTEGER,
  total_profit_vnd INTEGER,
  total_orders INTEGER,
  margin_pct REAL,
  top_5_products_json TEXT,
  cost_breakdown_json TEXT,         -- {fb_ads: 60M, gg_ads: 80M, vat: 30M, cogs: 200M}
  notes TEXT
);
```

→ CEO dashboard "tổng kết 12 tháng" = 12 row, nhanh.

### Lớp 4: Yearly archive (export PDF/Excel)
Cuối năm 31/12 cron job:
- Generate PDF báo cáo năm (revenue, profit, top SP, top sales rep, ...)
- Save vào R2: `reports/2026/yearly_summary.pdf`
- Email cho CEO/COO + tax accountant

### Backup strategy
- D1 export hàng tuần → R2 (auto via Cloudflare cron)
- Backup retain 12 tháng (hoặc lâu hơn, R2 cheap $0.015/GB/tháng)
- Nếu D1 lỗi → restore từ R2 backup

→ Data của bạn an toàn cả năm + dễ truy xuất + phục hồi được.

---

## 6. Roadmap implement (8 phases)

| Phase | Time | Module | Depend on |
|---|---|---|---|
| **0. Foundation** | 1 tuần | D1 schema + auth RBAC + landing page nav | — |
| **1. Warehouse module** ⭐ | 1-2 tuần | Inventory + product master + stock movement | Phase 0 |
| **2. Sales/CSKH module** | 2 tuần | CRM inbox + order management + sales rep KPI | Phase 0, Phase 1 |
| **3. Marketing integration** | 1 tuần | Sync existing FB/GG/TikTok/Content agents vào ERP layout + share data | Phase 0, 1, 2 |
| **4. Cross-department workflows** | 1 tuần | Stock alert → marketing pause, lead → order pipeline | Phase 1, 2, 3 |
| **5. Tech monitoring** | 1 tuần | System health + cost tracker + audit log | Phase 0 |
| **6. Reports & forecasting** | 1 tuần | Sales forecast, profit per channel, executive dashboard | Phase 1-5 |
| **7. PWA + Mobile** | 1 tuần | Service worker, manifest, mobile UI optimize | All phases |
| **8. Hardening & training** | ongoing | Bug fix, edge cases, train nhân viên dùng | All phases |

**Tổng effort: 9-11 tuần** cho ERP cơ bản đầy đủ.

---

## 7. MVP đề xuất (~3 tuần đầu)

Để có ERP **chạy được ngay** mà không phải đợi 11 tuần, tôi suggest MVP gồm:

### Tuần 1: Foundation
- [ ] D1 schema setup (chỉ tables: products, customers, leads, orders, employees)
- [ ] RBAC middleware (3 role: owner/staff/viewer)
- [ ] Landing page nav 4 phòng ban (link tới UI có sẵn)
- [ ] Migrate existing dashboard pages vào folder structure mới

### Tuần 2: Warehouse + Sales bridge
- [ ] Sync product-costs.json → D1 products table
- [ ] Sync product-revenue.json (Pancake) → D1 orders + customers
- [ ] Tạo trang `pages/warehouse/inventory.html` v2 với D1 backend
- [ ] Tạo trang `pages/sales/crm.html` v1 (xem lead chưa close)

### Tuần 3: Cross-dept first integration
- [ ] Workflow A (FB Lead → Order) — kết nối FB Ads agent với Sales CRM
- [ ] Stock alert event (KV publish) — Marketing dashboard hiển thị
- [ ] Sales KPI per rep (DUY, PHƯƠNG NAM)

→ Sau 3 tuần: bạn có ERP MVP chạy được, từng phòng ban có thể login + xem data của mình + cross-dept đã có 1-2 workflow kết nối.

---

## 8. Câu hỏi cần user trả lời trước khi code

1. **Số lượng user dự kiến** mỗi phòng ban?
   - Tech: ___
   - Marketing: ___
   - KD/CSKH: ___
   - Kho: ___

2. **Permission model** — bạn muốn:
   - [ ] Đơn giản: 3 role (owner/staff/viewer), staff thấy hết mọi phòng
   - [ ] Strict: per-department isolation, marketer KHÔNG xem được data sales
   - [ ] Hybrid: owner thấy hết, staff chỉ thấy phòng mình + cross-dept readonly

3. **Pancake/POSPancake integration** — bạn muốn:
   - [ ] Pull data 1 chiều (đọc thôi, không write back) — đơn giản
   - [ ] 2 chiều (ERP có thể create order → push sang Pancake) — phức tạp hơn

4. **Mobile priority** — phòng ban nào cần dùng nhiều trên điện thoại?
   - [ ] Tất cả desktop chính
   - [ ] Sales/CSKH cần mobile (gọi điện ngoài đường)
   - [ ] Kho cần tablet/mobile (scan barcode)

5. **Dữ liệu hiện tại migrate hay làm lại từ đầu**?
   - [ ] Migrate hết product-revenue.json, product-costs.json vào D1
   - [ ] Bắt đầu từ bây giờ, data cũ giữ ở JSON files

6. **MVP 3 tuần OK không hay cần fast track**?

---

**Đây là spec tổng thể. Sau khi user review, mình sẽ:**
- Refine theo feedback
- Bắt đầu Phase 0 (D1 schema + landing nav)
- Build tăng dần từng phòng ban

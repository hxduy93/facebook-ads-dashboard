-- ═══════════════════════════════════════════════════════════════
-- DOSCOM ERP — D1 Schema v1
-- ═══════════════════════════════════════════════════════════════
-- Run này 1 lần khi setup D1 database mới.
-- Cách: Cloudflare Dashboard → D1 → chọn database → Console tab
--       → paste hết file này → Execute
--
-- HOẶC qua wrangler CLI:
--   wrangler d1 execute doscom-erp --file=schema.sql --remote
-- ═══════════════════════════════════════════════════════════════

-- ────── DEPARTMENTS & TEAMS (lookup) ──────

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,                 -- 'TECH' | 'MARKETING' | 'SALES' | 'WAREHOUSE'
  name TEXT NOT NULL,                  -- 'Phòng Công nghệ' etc.
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,                 -- 'CONTENT' | 'FB_ADS' | 'GG_ADS' | 'TIKTOK' | 'SHOPEE' | 'SALES_REP' | 'CSKH' | 'WAREHOUSE'
  department_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- ────── EMPLOYEES (users) ──────

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,          -- match Google OAuth email
  name TEXT NOT NULL,
  phone TEXT,
  department_id TEXT,
  team_id TEXT,
  role_level INTEGER NOT NULL DEFAULT 10,  -- 60=CEO, 50=COO, 40=DEPT_HEAD, 30=TEAM_LEADER, 20=DEP_LEADER, 10=STAFF
  role_label TEXT,                     -- 'CEO' | 'COO' | 'TP_MARKETING' | 'LEADER_FB' | 'STAFF' | etc.
  active INTEGER DEFAULT 1,
  hired_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_team ON employees(team_id);

-- ────── PRODUCTS (master) ──────

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms TEXT,
  lead_time_days INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,                 -- vd 'd1', 'da8.1', 'noma-911'
  sku TEXT,
  name TEXT NOT NULL,
  group_code TEXT,                     -- 'MAY_DO' | 'CAMERA_VIDEO_CALL' | 'GHI_AM' | 'NOMA' | 'CAMERA_4G' | 'CAMERA_WIFI' | 'DINH_VI' | 'CHONG_GHI_AM'
  description TEXT,
  cost_vnd INTEGER,                    -- giá nhập
  sell_vnd INTEGER,                    -- giá bán
  current_stock INTEGER DEFAULT 0,
  reorder_threshold INTEGER DEFAULT 10,
  unit TEXT DEFAULT 'Cái',
  supplier_id TEXT,
  status TEXT DEFAULT 'active',        -- 'active' | 'discontinued' | 'pending'
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_code);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(current_stock);

-- ────── CUSTOMERS (master) ──────

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  city TEXT,
  province TEXT,
  ltv_vnd INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  first_order_at TEXT,
  last_order_at TEXT,
  status TEXT DEFAULT 'lead',          -- 'lead' | 'customer' | 'vip' | 'churned'
  source_first_touch TEXT,             -- channel đầu tiên contact: FB | GG | TIKTOK | SHOPEE | HOTLINE | ZALO
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

-- ────── LEADS (transactional) ──────

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                -- 'FB_ADS' | 'GG_ADS' | 'TIKTOK' | 'SHOPEE' | 'HOTLINE' | 'ZALO' | 'ORGANIC'
  campaign_id TEXT,                    -- FK ad_campaigns.id
  product_group TEXT,                  -- nhóm SP user inquire
  customer_phone TEXT,
  customer_name TEXT,
  customer_id TEXT,
  captured_at TEXT NOT NULL,           -- when lead arrived
  assigned_to_employee_id TEXT,
  contacted_at TEXT,                   -- sales rep gọi lần đầu
  status TEXT DEFAULT 'new',           -- 'new' | 'contacted' | 'qualified' | 'closed' | 'lost' | 'spam'
  loss_reason TEXT,                    -- nếu status='lost'
  tags TEXT,                           -- JSON array: ["price_complaint","high_intent","fake"]
  notes TEXT,
  closed_order_id TEXT,                -- FK orders.id nếu chốt được
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to_employee_id) REFERENCES employees(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_leads_captured ON leads(captured_at);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);

-- ────── ORDERS (transactional) ──────

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  pancake_order_id TEXT UNIQUE,        -- ID gốc trong Pancake (để dedupe sync)
  customer_id TEXT,
  customer_phone TEXT,                 -- denormalized for quick search
  lead_id TEXT,
  total_vnd INTEGER NOT NULL,
  items_json TEXT,                     -- [{product_id, qty, unit_price, name}]
  sales_rep_id TEXT,                   -- employees.id (DUY, PHƯƠNG NAM, ...)
  source_group TEXT,                   -- Pancake source: 'DUY' | 'PHUONG_NAM' | 'WEBSITE' | 'ZALO_OA' | 'HOTLINE'
  channel TEXT,                        -- inferred: 'FB' | 'GG' | 'TIKTOK' | 'SHOPEE' | 'ORGANIC'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'returned' | 'canceled'
  shipping_address TEXT,
  shipping_fee_vnd INTEGER,
  payment_method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  shipped_at TEXT,
  delivered_at TEXT,
  returned_at TEXT,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (sales_rep_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_rep ON orders(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_pancake ON orders(pancake_order_id);

-- ────── INVENTORY MOVEMENTS ──────

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,                -- âm = xuất, dương = nhập
  type TEXT NOT NULL,                  -- 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN'
  reference_type TEXT,                 -- 'ORDER' | 'PURCHASE' | 'STOCKTAKE' | 'MANUAL'
  reference_id TEXT,
  warehouse_id TEXT DEFAULT 'MAIN',
  by_employee_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (by_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_invmvt_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_invmvt_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_invmvt_type ON inventory_movements(type);

-- ────── AD CAMPAIGNS ──────

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,               -- 'FB' | 'GOOGLE' | 'TIKTOK' | 'SHOPEE'
  external_id TEXT,                    -- ID trên platform (FB campaign ID)
  name TEXT NOT NULL,
  product_group TEXT,
  budget_daily_vnd INTEGER,
  status TEXT DEFAULT 'active',        -- 'active' | 'paused' | 'archived'
  start_date TEXT,
  end_date TEXT,
  owner_employee_id TEXT,
  total_spend_vnd INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_revenue_vnd INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_channel ON ad_campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_external ON ad_campaigns(external_id);

-- ────── CONTENT ASSETS ──────

CREATE TABLE IF NOT EXISTS content_assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- 'IMAGE' | 'VIDEO' | 'COPY' | 'LANDING_PAGE'
  title TEXT,
  product_group TEXT,
  url TEXT,                            -- R2 public URL
  thumbnail_url TEXT,
  size_bytes INTEGER,
  duration_sec REAL,                   -- nếu video
  created_by_employee_id TEXT,
  performance_json TEXT,               -- {fb_ctr, gg_ctr, tt_views, ...}
  used_in_campaigns TEXT,              -- JSON array of ad_campaigns.id
  status TEXT DEFAULT 'active',        -- 'active' | 'archived'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON content_assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_group ON content_assets(product_group);

-- ────── KPI / REPORTING ──────

CREATE TABLE IF NOT EXISTS sales_kpi (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  period_start TEXT NOT NULL,          -- weekly: 'YYYY-MM-DD' (Monday)
  period_end TEXT NOT NULL,
  leads_assigned INTEGER DEFAULT 0,
  leads_contacted INTEGER DEFAULT 0,
  orders_closed INTEGER DEFAULT 0,
  revenue_vnd INTEGER DEFAULT 0,
  avg_time_to_close_hours REAL,
  close_rate_pct REAL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE (employee_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_employee ON sales_kpi(employee_id);
CREATE INDEX IF NOT EXISTS idx_kpi_period ON sales_kpi(period_start);

-- ────── DAILY SNAPSHOTS (cho dashboard nhanh) ──────

CREATE TABLE IF NOT EXISTS daily_snapshots (
  date TEXT PRIMARY KEY,               -- 'YYYY-MM-DD'
  total_revenue_vnd INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  fb_spend_vnd INTEGER DEFAULT 0,
  gg_spend_vnd INTEGER DEFAULT 0,
  tt_spend_vnd INTEGER DEFAULT 0,
  shopee_spend_vnd INTEGER DEFAULT 0,
  by_group_json TEXT,                  -- {"MAY_DO":{revenue,orders}, ...}
  by_channel_json TEXT,                -- {"FB":..., "GG":..., ...}
  by_sales_rep_json TEXT,              -- {"DUY":..., "PHUONG_NAM":...}
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ────── MONTHLY SUMMARY (cho báo cáo CEO) ──────

CREATE TABLE IF NOT EXISTS monthly_summary (
  month TEXT PRIMARY KEY,              -- 'YYYY-MM'
  total_revenue_vnd INTEGER DEFAULT 0,
  total_profit_vnd INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  margin_pct REAL,
  cogs_vnd INTEGER,
  vat_vnd INTEGER,
  total_ad_spend_vnd INTEGER,
  top_5_products_json TEXT,
  top_5_channels_json TEXT,
  top_5_sales_reps_json TEXT,
  notes TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ────── STOCK ALERTS ──────

CREATE TABLE IF NOT EXISTS stock_alerts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  level TEXT NOT NULL,                 -- 'LOW' | 'OUT'
  current_stock INTEGER,
  threshold INTEGER,
  triggered_at TEXT NOT NULL,
  resolved_at TEXT,
  notified_departments TEXT,           -- JSON array: ['MARKETING', 'SALES']
  acknowledged_by_employee_id TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON stock_alerts(resolved_at);

-- ────── AUDIT LOG (mọi action quan trọng) ──────

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  employee_id TEXT,
  employee_email TEXT,                 -- denormalized
  department TEXT,
  action TEXT NOT NULL,                -- 'pause_campaign' | 'update_stock' | 'create_order' | etc.
  target_type TEXT,                    -- 'order' | 'product' | 'campaign' | 'lead'
  target_id TEXT,
  metadata_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_employee ON audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- ════════════════════════════════════════════════════════════════
-- SEED DATA — Departments & Teams (run lúc init)
-- ════════════════════════════════════════════════════════════════

INSERT OR REPLACE INTO departments (id, name, display_order) VALUES
  ('TECH',      'Phòng Công nghệ',                  1),
  ('MARKETING', 'Phòng Marketing',                  2),
  ('SALES',     'Phòng Kinh doanh & CSKH',          3),
  ('WAREHOUSE', 'Phòng Kho',                        4);

INSERT OR REPLACE INTO teams (id, department_id, name, display_order) VALUES
  ('TECH',         'TECH',      'Tech',                  1),
  ('CONTENT',      'MARKETING', 'Content',               1),
  ('FB_ADS',       'MARKETING', 'Facebook Ads',          2),
  ('GG_ADS',       'MARKETING', 'Google Ads',            3),
  ('TIKTOK',       'MARKETING', 'TikTok Shop',           4),
  ('SHOPEE',       'MARKETING', 'Shopee Media',          5),
  ('SALES_REP',    'SALES',     'Sales Rep',             1),
  ('CSKH',         'SALES',     'Chăm sóc khách hàng',   2),
  ('WAREHOUSE',    'WAREHOUSE', 'Kho',                   1);

-- ════════════════════════════════════════════════════════════════
-- SEED DATA — Initial admin (CEO) — sửa email theo của bạn
-- ════════════════════════════════════════════════════════════════

INSERT OR REPLACE INTO employees (id, email, name, department_id, team_id, role_level, role_label, active)
VALUES ('emp_ceo_1', 'doscom.vietnam@gmail.com', 'CEO Doscom', 'TECH', 'TECH', 60, 'CEO', 1);

-- DONE

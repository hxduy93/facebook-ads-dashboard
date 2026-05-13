-- GEO Monitor — D1 schema
-- Module theo dõi brand Doscom/NOMA trong câu trả lời AI (ChatGPT, Gemini, Meta AI)
-- Tham chiếu spec: 00-Index.md §3.1

-- ====================================================================
-- 1. Priority queries: 30 câu hỏi cốt lõi
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_queries (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT CHECK(category IN ('TOFU', 'MOFU', 'BOFU')),
  brand_target TEXT CHECK(brand_target IN ('doscom', 'noma', 'both')),
  language TEXT DEFAULT 'vi',
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ====================================================================
-- 2. Runs: mỗi run = 1 query × 1 engine × 1 lần chạy
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_runs (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES geo_queries(id),
  engine TEXT NOT NULL CHECK(engine IN ('chatgpt', 'gemini', 'meta_ai')),
  model TEXT NOT NULL,
  run_seq INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  response_text TEXT,
  doscom_mentioned INTEGER DEFAULT 0,
  doscom_position INTEGER,
  doscom_sentiment TEXT,
  noma_mentioned INTEGER DEFAULT 0,
  noma_position INTEGER,
  noma_sentiment TEXT,
  brand_url_cited INTEGER DEFAULT 0,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL,
  raw_json TEXT,
  error TEXT,
  processed_at INTEGER
);

-- ====================================================================
-- 3. Citations: URLs AI cite kèm theo response
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_citations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES geo_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  domain TEXT,
  is_brand_url INTEGER DEFAULT 0,
  position INTEGER
);

-- ====================================================================
-- 4. Competitor mentions
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_competitor_mentions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES geo_runs(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  mention_count INTEGER DEFAULT 1
);

-- ====================================================================
-- 5. Job queue: chunked processing thay cho Cloudflare Queue
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_job_queue (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  run_seq INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  error TEXT
);

-- ====================================================================
-- Indexes
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_runs_query       ON geo_runs(query_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_runs_engine      ON geo_runs(engine, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_runs_timestamp   ON geo_runs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_citations_run    ON geo_citations(run_id);
CREATE INDEX IF NOT EXISTS idx_competitors_name ON geo_competitor_mentions(competitor_name, run_id);
CREATE INDEX IF NOT EXISTS idx_queue_status     ON geo_job_queue(status, created_at);

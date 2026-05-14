-- GEO Content Pipeline — Phase 5
-- Mở rộng GEO Monitor (chỉ "đo") sang "đề xuất content + sinh bài + auto publish lên WordPress".
-- Bài viết đi qua queue: idea → drafting → pending_review → (anh sửa) → publishing → published.

-- ====================================================================
-- 1. Content queue: mỗi dòng = 1 ý tưởng bài viết, có thể nâng cấp dần
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_content_queue (
  id TEXT PRIMARY KEY,
  query_id TEXT REFERENCES geo_queries(id),     -- query gốc gây ra lỗ hổng
  brand TEXT CHECK(brand IN ('doscom', 'noma')) NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN (
    'idea',            -- vừa tạo từ gap analysis, chưa sinh content
    'drafting',        -- đang gọi AI sinh content
    'pending_review',  -- có content rồi, chờ user duyệt
    'edited',          -- user đã sửa
    'publishing',      -- đang đẩy lên WordPress
    'published',       -- đã đăng thành công
    'rejected',        -- user từ chối
    'failed'           -- lỗi (drafting hoặc publishing)
  )),

  -- Gap analysis source
  gap_severity TEXT,             -- 'A' (3/3 engine miss), 'B' (2/3), 'C' (1/3)
  gap_engines TEXT,              -- JSON: engines miss brand vd ["chatgpt","gemini"]
  gap_summary TEXT,              -- lý do ngắn tại sao cần viết (do AI gen)
  competitor_winners TEXT,       -- JSON: top đối thủ thắng query này
  source_citations TEXT,         -- JSON: URLs mà AI đang trích cho đối thủ (để học cấu trúc)

  -- Content fields (sinh ra ở phase drafting)
  title TEXT,
  slug TEXT,
  meta_description TEXT,
  excerpt TEXT,
  content_html TEXT,             -- WordPress-ready HTML
  content_markdown TEXT,         -- bản gốc Markdown để dễ edit
  faq_json TEXT,                 -- JSON: [{q, a}, ...]
  schema_jsonld TEXT,            -- JSON-LD full để gắn vào WP custom field
  internal_links_json TEXT,      -- JSON: [{anchor, url}, ...]
  external_links_json TEXT,      -- JSON: [{anchor, url}, ...]
  word_count INTEGER,
  reading_time_min INTEGER,

  -- Image
  image_url TEXT,                -- URL ảnh cuối cùng (sau khi upload lên WP hoặc R2)
  image_alt TEXT,
  image_prompt TEXT,             -- prompt đã dùng để gen (để regenerate)
  image_provider TEXT,           -- 'gpt-image-1' | 'unsplash' | 'cf-flux'
  image_base64 TEXT,             -- tạm lưu base64 trước khi upload lên WP (sẽ xóa sau publish)

  -- WordPress publish
  target_site TEXT,              -- 'doscom' | 'noma'
  wp_post_id INTEGER,
  wp_post_url TEXT,
  wp_featured_media_id INTEGER,  -- WP media library ID của ảnh hero
  wp_categories TEXT,            -- JSON array of WP category IDs
  wp_tags TEXT,                  -- JSON array of WP tag names

  -- Tracking timestamps
  created_at INTEGER NOT NULL,
  drafted_at INTEGER,
  reviewed_at INTEGER,
  published_at INTEGER,
  rejected_at INTEGER,
  reject_reason TEXT,
  last_error TEXT,

  -- Cost tracking
  cost_content_usd REAL DEFAULT 0,
  cost_image_usd REAL DEFAULT 0,
  cost_total_usd REAL DEFAULT 0,

  -- AI metadata
  content_model TEXT,            -- claude-haiku-4-5 / claude-sonnet-4-6 / ...
  content_tokens_input INTEGER,
  content_tokens_output INTEGER
);

CREATE INDEX IF NOT EXISTS idx_content_queue_status  ON geo_content_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_queue_brand   ON geo_content_queue(brand, status);
CREATE INDEX IF NOT EXISTS idx_content_queue_query   ON geo_content_queue(query_id);
CREATE INDEX IF NOT EXISTS idx_content_queue_created ON geo_content_queue(created_at DESC);

-- ====================================================================
-- 2. Article performance: đo trước/sau khi published
-- ====================================================================
CREATE TABLE IF NOT EXISTS geo_article_performance (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES geo_content_queue(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL REFERENCES geo_queries(id),
  measurement_at INTEGER NOT NULL,
  days_since_publish INTEGER,

  -- Snapshot baseline (lưu lúc article được tạo)
  doscom_mentions_before INTEGER DEFAULT 0,
  noma_mentions_before INTEGER DEFAULT 0,
  brand_cited_before INTEGER DEFAULT 0,
  runs_before INTEGER DEFAULT 0,

  -- Sau khi published 14 ngày
  doscom_mentions_after INTEGER DEFAULT 0,
  noma_mentions_after INTEGER DEFAULT 0,
  brand_cited_after INTEGER DEFAULT 0,
  runs_after INTEGER DEFAULT 0,

  -- Computed
  improvement_score REAL,        -- (after - before) / before, tính ở client
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_perf_article ON geo_article_performance(article_id);
CREATE INDEX IF NOT EXISTS idx_perf_query   ON geo_article_performance(query_id, measurement_at DESC);

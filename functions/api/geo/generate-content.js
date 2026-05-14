// Endpoint: POST /api/geo/generate-content
//
// Sinh content đầy đủ cho 1 article trong queue (status=idea → drafting → pending_review).
// Output đầy đủ 15 thành phần SEO (title, meta, slug, H1, H2/H3, FAQ, schema, internal/external links).
//
// Body: {
//   article_id: "uuid-từ-geo-content-queue",
//   model: "haiku" | "sonnet",   // default haiku
//   target_words: 2000           // default 2000
// }

import { callClaude } from "./_utils/claude.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const BRAND_CONTEXT = {
  doscom: {
    name: "Doscom",
    short: "Doscom",
    site: "https://doscom.vn",
    products: "phần mềm quản lý bán hàng, POS, ERP cho cửa hàng và chuỗi",
    audience: "chủ shop, chuỗi cửa hàng, F&B, retailer tại Việt Nam",
    usp: "tích hợp đa kênh (Shopee/TikTok/Lazada), tự host được, hỗ trợ tiếng Việt 24/7, có agent AI bán hàng",
  },
  noma: {
    name: "NOMA Autocare",
    short: "NOMA",
    site: "https://noma.vn",
    products: "dịch vụ bảo dưỡng, chăm sóc xe ô tô (rửa xe, detail, đánh bóng, phủ ceramic)",
    audience: "chủ xe ô tô tại HCM, Hà Nội, các thành phố lớn",
    usp: "kỹ thuật viên Đức/Nhật, sản phẩm chính hãng, bảo hành dài hạn, app đặt lịch online",
  },
};

const CONTENT_SYSTEM_PROMPT = `Bạn là Senior Content Writer cho thương hiệu Việt Nam, chuyên SEO + GEO (Generative Engine Optimization). Nhiệm vụ: viết bài blog tiếng Việt được tối ưu để **AI engine như ChatGPT/Gemini ưu tiên trích nguồn**.

NGUYÊN TẮC GEO (khác SEO truyền thống):
1. Mỗi H2/H3 phải trả lời 1 câu hỏi cụ thể → AI dễ extract.
2. Đoạn intro 100-150 từ có keyword chính + định nghĩa rõ ràng → AI quote phần này.
3. FAQ 5-8 Q&A cuối bài → AI hay copy nguyên trạng vào câu trả lời.
4. Bảng so sánh khi nói về nhiều lựa chọn → AI rất thích trích bảng.
5. Dữ liệu/số liệu cụ thể (không bịa nếu không có) → tăng độ tin cậy.
6. Internal/external link tự nhiên → tăng E-E-A-T.
7. Schema JSON-LD đầy đủ Article + FAQPage + BreadcrumbList.

PHONG CÁCH:
- Tiếng Việt tự nhiên, không dịch máy.
- Tránh câu sáo rỗng ("Trong thời đại 4.0", "Hiện nay...").
- Văn phong chuyên gia thân thiện, không bán hàng lộ liễu.
- Mention brand 2-4 lần tự nhiên (không nhồi nhét).

OUTPUT BẮT BUỘC: 1 JSON object hợp lệ, bắt đầu bằng { kết thúc bằng }. KHÔNG markdown wrapper, KHÔNG text bao quanh.`;

function buildContentPrompt({ article, brand, targetWords }) {
  const ctx = BRAND_CONTEXT[brand];
  const competitors = JSON.parse(article.competitor_winners || "[]").slice(0, 5);
  const citations = JSON.parse(article.source_citations || "[]").slice(0, 5);

  return `BRAND: ${ctx.name}
SẢN PHẨM: ${ctx.products}
ĐỐI TƯỢNG: ${ctx.audience}
USP: ${ctx.usp}
WEBSITE: ${ctx.site}

TITLE ĐÃ ĐỀ XUẤT: ${article.title}
SLUG: ${article.slug}
BRIEF: ${article.gap_summary || "Bài viết để fix lỗ hổng GEO — AI engine không nhắc brand cho query này."}

LỖ HỔNG GỐC:
- Query gây ra: "${article.query_text || ""}"
- AI nào miss brand: ${(JSON.parse(article.gap_engines || "[]")).join(", ")}
- Đối thủ đang thắng: ${competitors.map(c => `${c.name} (${c.mentions} mentions)`).join(", ") || "không có"}
- AI đang trích từ những domain: ${citations.map(c => c.domain).join(", ") || "không có"}

YÊU CẦU OUTPUT (JSON object, ${targetWords} từ tổng cộng):

{
  "title": "60 ký tự, có keyword + benefit",
  "slug": "kebab-case-khong-dau",
  "meta_description": "155 ký tự, snippet hấp dẫn",
  "excerpt": "2-3 câu tóm tắt 200 ký tự",
  "content_markdown": "BÀI VIẾT FULL theo cấu trúc:\\n\\n# H1\\n\\n[Intro 100-150 từ có keyword chính + 1 số liệu nếu có + mention ${ctx.short}]\\n\\n## H2 thứ 1 (dạng câu hỏi)\\n[200-300 từ trả lời]\\n\\n## H2 thứ 2\\n### H3 sub-section\\n...\\n\\n## Bảng so sánh (nếu phù hợp)\\n| Cột 1 | Cột 2 | Cột 3 |\\n|---|---|---|\\n| ... |\\n\\n## Câu hỏi thường gặp (FAQ)\\n### Q1?\\nA1...\\n\\n## Kết luận + CTA",
  "faq": [
    {"q": "Câu hỏi 1?", "a": "Trả lời 50-100 từ, có thể trích thẳng vào AI response"},
    ... 5-8 items
  ],
  "internal_links": [
    {"anchor": "...", "url": "${ctx.site}/...", "context": "đặt ở đoạn nào"}
  ],
  "external_links": [
    {"anchor": "...", "url": "https://...", "context": "đặt ở đoạn nào"}
  ],
  "primary_keyword": "...",
  "secondary_keywords": ["...", "..."],
  "comparison_table": {
    "title": "...",
    "headers": ["Tiêu chí", "${ctx.short}", "Đối thủ A", "Đối thủ B"],
    "rows": [["...","✓","-","-"]]
  } | null,
  "image_prompt": "Mô tả ảnh hero bằng tiếng Anh, để dùng cho gpt-image-1. Phong cách: realistic photography, professional, brand-safe (không có chữ trong ảnh, không có khuôn mặt rõ).",
  "image_alt_vi": "Alt text tiếng Việt 100-125 ký tự",
  "wp_categories_suggest": ["tên category tiếng Việt, vd: 'Phần mềm bán hàng' hoặc 'Hướng dẫn'"],
  "wp_tags_suggest": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}

LƯU Ý:
- content_markdown PHẢI \\n thật trong JSON (escape).
- Bảng so sánh chỉ thêm nếu title gợi ý so sánh / liệt kê.
- KHÔNG bịa tính năng/giá Doscom/NOMA. Chỉ nói chung về danh mục sản phẩm.
- Internal links: nếu chưa biết URL cụ thể, dùng ${ctx.site}/blog/<slug-liên-quan>.`;
}

function buildSchemaJsonLd({ article, content, brand, publishUrl }) {
  const ctx = BRAND_CONTEXT[brand];
  const now = new Date().toISOString();

  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": content.title,
      "description": content.meta_description,
      "author": { "@type": "Organization", "name": ctx.name, "url": ctx.site },
      "publisher": {
        "@type": "Organization",
        "name": ctx.name,
        "logo": { "@type": "ImageObject", "url": `${ctx.site}/logo.png` },
      },
      "datePublished": now,
      "dateModified": now,
      "mainEntityOfPage": publishUrl || `${ctx.site}/blog/${content.slug}`,
      "image": article.image_url || undefined,
      "keywords": content.secondary_keywords?.join(", "),
    },
  ];

  if (Array.isArray(content.faq) && content.faq.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": content.faq.map(f => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": f.a },
      })),
    });
  }

  schemas.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Trang chủ", "item": ctx.site },
      { "@type": "ListItem", "position": 2, "name": "Blog", "item": `${ctx.site}/blog` },
      { "@type": "ListItem", "position": 3, "name": content.title, "item": publishUrl || `${ctx.site}/blog/${content.slug}` },
    ],
  });

  return schemas;
}

function markdownToHtml(md) {
  // Minimal Markdown → HTML cho WordPress (vì WP đã render block, chỉ cần HTML cơ bản).
  // Không dùng lib ngoài để giữ Worker nhỏ.
  if (!md) return "";
  let html = md;

  // Code blocks (đơn giản)
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${escapeHtml(code.trim())}</code></pre>`);

  // Headings
  html = html.replace(/^###### (.*$)/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.*$)/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.*$)/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.*$)/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gm, "<h1>$1</h1>");

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Tables (đơn giản: chỉ table dạng | a | b |)
  html = html.replace(/(\|[^\n]+\|\n\|[\s\-:|]+\|\n(?:\|[^\n]+\|\n?)+)/g, table => {
    const lines = table.trim().split("\n").filter(l => l.trim().startsWith("|"));
    if (lines.length < 2) return table;
    const headers = lines[0].split("|").slice(1, -1).map(s => s.trim());
    const rows = lines.slice(2).map(l => l.split("|").slice(1, -1).map(s => s.trim()));
    return `<table class="geo-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  });

  // Lists (basic)
  html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  // Paragraphs: split by 2+ newlines, wrap non-tag lines
  const blocks = html.split(/\n{2,}/);
  html = blocks.map(b => {
    const t = b.trim();
    if (!t) return "";
    if (/^<(h\d|ul|ol|pre|table|blockquote|div)/i.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br>")}</p>`;
  }).join("\n\n");

  return html;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).length;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}

  const articleId = body.article_id;
  const model = ["haiku", "sonnet"].includes(body.model) ? body.model : "haiku";
  const targetWords = Math.min(Math.max(parseInt(body.target_words) || 2000, 800), 4000);

  if (!articleId) return jsonResponse({ error: "Missing article_id" }, 400);

  // Load article + join với geo_queries để lấy query text
  const article = await env.DB.prepare(`
    SELECT q.id as article_id, q.brand, q.status, q.title, q.slug,
           q.gap_severity, q.gap_engines, q.gap_summary,
           q.competitor_winners, q.source_citations,
           gq.text as query_text, gq.category, gq.brand_target,
           gq.id as query_id
    FROM geo_content_queue q
    LEFT JOIN geo_queries gq ON gq.id = q.query_id
    WHERE q.id = ?
  `).bind(articleId).first();

  if (!article) return jsonResponse({ error: `Article ${articleId} not found` }, 404);
  if (!["idea", "failed"].includes(article.status)) {
    return jsonResponse({
      error: `Article status='${article.status}' — chỉ regen được cho idea/failed. Dùng PATCH /api/geo/queue/:id nếu muốn edit.`
    }, 400);
  }

  // Mark drafting
  await env.DB.prepare(
    `UPDATE geo_content_queue SET status='drafting' WHERE id = ?`
  ).bind(articleId).run();

  try {
    const userPrompt = buildContentPrompt({ article, brand: article.brand, targetWords });
    const result = await callClaude(env, {
      model,
      systemPrompt: CONTENT_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8000,
      jsonOutput: true,
    });

    const c = result.parsed;
    if (!c || !c.content_markdown) throw new Error("Claude trả content_markdown empty");

    const contentHtml = markdownToHtml(c.content_markdown);
    const wordCount = countWords(c.content_markdown);
    const readingTime = Math.max(1, Math.round(wordCount / 220));

    const schemas = buildSchemaJsonLd({
      article,
      content: c,
      brand: article.brand,
    });

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      UPDATE geo_content_queue SET
        status = 'pending_review',
        title = ?,
        slug = ?,
        meta_description = ?,
        excerpt = ?,
        content_html = ?,
        content_markdown = ?,
        faq_json = ?,
        schema_jsonld = ?,
        internal_links_json = ?,
        external_links_json = ?,
        word_count = ?,
        reading_time_min = ?,
        image_prompt = ?,
        image_alt = ?,
        wp_categories = ?,
        wp_tags = ?,
        drafted_at = ?,
        cost_content_usd = ?,
        cost_total_usd = COALESCE(cost_total_usd, 0) + ?,
        content_model = ?,
        content_tokens_input = ?,
        content_tokens_output = ?
      WHERE id = ?
    `).bind(
      (c.title || article.title || "").slice(0, 250),
      (c.slug || article.slug || "").slice(0, 200),
      (c.meta_description || "").slice(0, 200),
      (c.excerpt || "").slice(0, 500),
      contentHtml,
      c.content_markdown,
      JSON.stringify(c.faq || []),
      JSON.stringify(schemas),
      JSON.stringify(c.internal_links || []),
      JSON.stringify(c.external_links || []),
      wordCount,
      readingTime,
      (c.image_prompt || "").slice(0, 1000),
      (c.image_alt_vi || "").slice(0, 250),
      JSON.stringify(c.wp_categories_suggest || []),
      JSON.stringify(c.wp_tags_suggest || []),
      now,
      result.cost_usd,
      result.cost_usd,
      result.model,
      result.tokens_input,
      result.tokens_output,
      articleId
    ).run();

    return jsonResponse({
      article_id: articleId,
      status: "pending_review",
      title: c.title,
      slug: c.slug,
      word_count: wordCount,
      reading_time_min: readingTime,
      faq_count: (c.faq || []).length,
      has_comparison_table: !!c.comparison_table,
      image_prompt: c.image_prompt,
      cost_usd: result.cost_usd,
      model: result.model,
      tokens: { input: result.tokens_input, output: result.tokens_output },
    });

  } catch (err) {
    const errMsg = String(err?.message || err).slice(0, 500);
    await env.DB.prepare(
      `UPDATE geo_content_queue SET status='failed', last_error=? WHERE id=?`
    ).bind(errMsg, articleId).run();
    return jsonResponse({ error: errMsg, article_id: articleId }, 500);
  }
}

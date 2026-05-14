// Endpoint: POST /api/geo/publish-wp
//
// Đăng article từ geo_content_queue lên WordPress (doscom.vn hoặc noma.vn).
//
// Flow:
//   1. Validate article ở status pending_review/edited.
//   2. Nếu có image_base64 → upload lên WP media → lấy featured_media ID.
//   3. Resolve category names → category IDs (auto tạo nếu chưa có).
//   4. POST /wp-json/wp/v2/posts với title/content/excerpt/slug/status/categories/tags/featured_media/meta.
//   5. Cập nhật geo_content_queue: status='published', wp_post_id, wp_post_url, xóa image_base64.
//
// Body: {
//   article_id: "uuid",
//   target_site: "doscom" | "noma",   // default lấy từ article.brand
//   wp_status: "publish" | "draft" | "pending",   // default "draft" để anh review trên WP trước khi go-live
//   override?: { title, content_html, meta_description, slug, ... }  // optional last-min override
// }
//
// ENV cần set:
//   WP_DOSCOM_URL       — vd "https://doscom.vn"
//   WP_DOSCOM_USER      — username trên doscom.vn (vd "geo-agent")
//   WP_DOSCOM_APP_PWD   — Application Password
//   WP_NOMA_URL         — vd "https://noma.vn"
//   WP_NOMA_USER
//   WP_NOMA_APP_PWD

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function getSiteConfig(site, env) {
  if (site === "doscom") {
    return {
      url:  env.WP_DOSCOM_URL,
      user: env.WP_DOSCOM_USER,
      pwd:  env.WP_DOSCOM_APP_PWD,
    };
  }
  if (site === "noma") {
    return {
      url:  env.WP_NOMA_URL,
      user: env.WP_NOMA_USER,
      pwd:  env.WP_NOMA_APP_PWD,
    };
  }
  return null;
}

function authHeader(user, pwd) {
  // WordPress Application Password = Basic Auth
  return "Basic " + btoa(`${user}:${pwd}`);
}

function base64ToBlob(b64, mime = "image/png") {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

async function uploadMedia(siteConfig, { base64, filename, alt }) {
  // WP REST API hỗ trợ raw body upload (Approach B) — đơn giản hơn multipart,
  // hoạt động ngon trên Cloudflare Workers fetch.
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);

  const res = await fetch(`${siteConfig.url}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      "Authorization": authHeader(siteConfig.user, siteConfig.pwd),
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: bytes,
  });

  if (!res.ok) {
    const txt = (await res.text()).slice(0, 500);
    throw new Error(`WP media upload failed ${res.status}: ${txt}`);
  }

  const created = await res.json();

  // Set alt_text bằng PATCH riêng (raw upload không support form fields).
  if (alt) {
    await fetch(`${siteConfig.url}/wp-json/wp/v2/media/${created.id}`, {
      method: "POST",  // WP REST cho update cũng dùng POST
      headers: {
        "Authorization": authHeader(siteConfig.user, siteConfig.pwd),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alt_text: alt }),
    }).catch(() => {});  // best-effort, không break pipeline nếu fail
  }

  return {
    id: created.id,
    source_url: created.source_url,
    media_details: created.media_details,
  };
}

async function resolveCategories(siteConfig, categoryNames) {
  if (!categoryNames || !categoryNames.length) return [];
  const ids = [];

  for (const name of categoryNames) {
    // 1. Tìm category đã tồn tại
    const searchRes = await fetch(
      `${siteConfig.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}&per_page=10`,
      { headers: { "Authorization": authHeader(siteConfig.user, siteConfig.pwd) } }
    );

    if (searchRes.ok) {
      const found = await searchRes.json();
      const exact = found.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (exact) {
        ids.push(exact.id);
        continue;
      }
    }

    // 2. Tạo category mới nếu chưa có
    const createRes = await fetch(`${siteConfig.url}/wp-json/wp/v2/categories`, {
      method: "POST",
      headers: {
        "Authorization": authHeader(siteConfig.user, siteConfig.pwd),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, slug: slugify(name) }),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      ids.push(created.id);
    }
    // Nếu lỗi tạo (vd quyền) → skip silent, không break pipeline
  }
  return ids;
}

async function resolveTags(siteConfig, tagNames) {
  if (!tagNames || !tagNames.length) return [];
  const ids = [];

  for (const name of tagNames) {
    const searchRes = await fetch(
      `${siteConfig.url}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=10`,
      { headers: { "Authorization": authHeader(siteConfig.user, siteConfig.pwd) } }
    );
    if (searchRes.ok) {
      const found = await searchRes.json();
      const exact = found.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (exact) {
        ids.push(exact.id);
        continue;
      }
    }

    const createRes = await fetch(`${siteConfig.url}/wp-json/wp/v2/tags`, {
      method: "POST",
      headers: {
        "Authorization": authHeader(siteConfig.user, siteConfig.pwd),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, slug: slugify(name) }),
    });
    if (createRes.ok) {
      const created = await createRes.json();
      ids.push(created.id);
    }
  }
  return ids;
}

function slugify(s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // remove diacritics
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildContentWithSchema(html, schemaJsonLd) {
  // Inject schema vào cuối content dưới dạng <script type="application/ld+json">
  if (!schemaJsonLd) return html;
  let schemas;
  try { schemas = typeof schemaJsonLd === "string" ? JSON.parse(schemaJsonLd) : schemaJsonLd; }
  catch { return html; }

  const scripts = (Array.isArray(schemas) ? schemas : [schemas])
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join("\n");

  return `${html}\n\n<!-- GEO Schema JSON-LD -->\n${scripts}`;
}

async function createPost(siteConfig, payload) {
  const res = await fetch(`${siteConfig.url}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Authorization": authHeader(siteConfig.user, siteConfig.pwd),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = (await res.text()).slice(0, 800);
    throw new Error(`WP post create failed ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}

  const articleId = body.article_id;
  if (!articleId) return jsonResponse({ error: "Missing article_id" }, 400);

  const wpStatus = ["publish", "draft", "pending", "future", "private"].includes(body.wp_status)
    ? body.wp_status : "draft";

  // Load article
  const article = await env.DB.prepare(
    `SELECT * FROM geo_content_queue WHERE id = ?`
  ).bind(articleId).first();

  if (!article) return jsonResponse({ error: `Article ${articleId} not found` }, 404);

  const validStatuses = ["pending_review", "edited", "failed"];
  if (!validStatuses.includes(article.status)) {
    return jsonResponse({
      error: `Article status='${article.status}' — chỉ publish được khi pending_review/edited/failed`,
    }, 400);
  }

  const targetSite = body.target_site || article.brand;
  const siteConfig = getSiteConfig(targetSite, env);
  if (!siteConfig || !siteConfig.url || !siteConfig.user || !siteConfig.pwd) {
    return jsonResponse({
      error: `Missing WP config cho site '${targetSite}'. Set env vars: WP_${targetSite.toUpperCase()}_URL, WP_${targetSite.toUpperCase()}_USER, WP_${targetSite.toUpperCase()}_APP_PWD`,
    }, 500);
  }

  // Apply override (nếu user gửi)
  const override = body.override || {};
  const finalTitle    = override.title    || article.title;
  const finalContent  = override.content_html || article.content_html;
  const finalExcerpt  = override.excerpt  || article.excerpt;
  const finalSlug     = override.slug     || article.slug;
  const finalMetaDesc = override.meta_description || article.meta_description;
  const wpCats        = override.wp_categories || JSON.parse(article.wp_categories || "[]");
  const wpTags        = override.wp_tags || JSON.parse(article.wp_tags || "[]");

  await env.DB.prepare(
    `UPDATE geo_content_queue SET status='publishing', target_site=? WHERE id=?`
  ).bind(targetSite, articleId).run();

  try {
    // 1. Upload image lên WP (nếu có base64)
    let featuredMediaId = null;
    let imageUrl = article.image_url;

    if (article.image_base64) {
      const filename = `${slugify(finalTitle)}-${Date.now()}.png`;
      const media = await uploadMedia(siteConfig, {
        base64: article.image_base64,
        filename,
        alt: article.image_alt || finalTitle,
      });
      featuredMediaId = media.id;
      imageUrl = media.source_url;
    }

    // 2. Resolve categories + tags
    const categoryIds = await resolveCategories(siteConfig, wpCats);
    const tagIds = await resolveTags(siteConfig, wpTags);

    // 3. Build content với schema JSON-LD inject
    const contentWithSchema = buildContentWithSchema(finalContent, article.schema_jsonld);

    // 4. Create post
    const postPayload = {
      title: finalTitle,
      content: contentWithSchema,
      excerpt: finalExcerpt,
      slug: finalSlug,
      status: wpStatus,
      categories: categoryIds,
      tags: tagIds,
      meta: {
        // Yoast SEO compatible (nếu site dùng Yoast)
        _yoast_wpseo_metadesc: finalMetaDesc,
        _yoast_wpseo_focuskw: article.title,
        // RankMath compatible
        rank_math_description: finalMetaDesc,
      },
    };
    if (featuredMediaId) postPayload.featured_media = featuredMediaId;

    const post = await createPost(siteConfig, postPayload);

    // 5. Update DB
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      UPDATE geo_content_queue SET
        status = 'published',
        wp_post_id = ?,
        wp_post_url = ?,
        wp_featured_media_id = ?,
        image_url = ?,
        image_base64 = NULL,
        published_at = ?,
        target_site = ?
      WHERE id = ?
    `).bind(
      post.id,
      post.link,
      featuredMediaId,
      imageUrl,
      now,
      targetSite,
      articleId
    ).run();

    return jsonResponse({
      article_id: articleId,
      status: "published",
      target_site: targetSite,
      wp_post_id: post.id,
      wp_post_url: post.link,
      wp_status: wpStatus,
      featured_media_id: featuredMediaId,
      categories_assigned: categoryIds,
      tags_assigned: tagIds,
    });

  } catch (err) {
    const errMsg = String(err?.message || err).slice(0, 500);
    await env.DB.prepare(
      `UPDATE geo_content_queue SET status='failed', last_error=? WHERE id=?`
    ).bind(errMsg, articleId).run();
    return jsonResponse({ error: errMsg, article_id: articleId }, 500);
  }
}

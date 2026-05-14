// Endpoint: POST /api/geo/generate-image
//
// Sinh ảnh hero qua Cloudflare Workers AI — Flux Schnell (miễn phí trong free tier).
// Trước đây dùng gpt-image-1 ($0.042/ảnh) — đã chuyển sang Flux 2026-05-14
// để tiết kiệm chi phí. Cùng pattern với generate-ad-copy.js (env.AI binding).
//
// Free tier: 10,000 neurons/ngày → ~5-6 ảnh Flux Schnell/ngày miễn phí.
// Quá free tier: $0.011/1000 neurons (rẻ hơn gpt-image-1 ~4×).
//
// Body: {
//   article_id: "uuid",
//   prompt_override: "...",        // optional, override image_prompt từ DB
//   steps: 4,                       // 1-8, default 4. 8 = chất lượng cao hơn, chậm hơn
//   width: 1024,                    // 256-2048, default 1024
//   height: 1024                    // 256-2048, default 1024
// }

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const GATEWAY_ID = "doscom-erp";

// Cost ước tính: Flux Schnell ~1500-3000 neurons/ảnh.
// Free tier 10K neurons/ngày → 5-6 ảnh/ngày free.
// Quá free: $0.011/1000 neurons → ~$0.02-0.03/ảnh.
const COST_ESTIMATE = 0;  // assume within free tier; nếu vượt thì +$0.025 fallback

async function generateFluxImage(env, { prompt, steps, width, height }) {
  if (!env.AI) throw new Error("Workers AI binding 'AI' missing — vào Cloudflare Pages → Settings → Functions → Bindings → Add → Workers AI → name: AI");

  const inputs = { prompt, steps };
  if (width)  inputs.width  = width;
  if (height) inputs.height = height;

  let response;
  try {
    response = await env.AI.run(MODEL, inputs, { gateway: { id: GATEWAY_ID } });
  } catch (err) {
    throw new Error(`Workers AI Flux failed: ${err?.message || String(err)}`);
  }

  // Flux Schnell trả về { image: "base64string" } (PNG, base64-encoded, no data: prefix)
  if (!response?.image) {
    throw new Error(`Flux returned empty/invalid response: ${JSON.stringify(response).slice(0, 200)}`);
  }

  return { b64_json: response.image };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "D1 binding 'DB' missing" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}

  const articleId = body.article_id;
  if (!articleId) return jsonResponse({ error: "Missing article_id" }, 400);

  const steps  = Math.min(Math.max(parseInt(body.steps)  || 4,    1),  8);
  const width  = Math.min(Math.max(parseInt(body.width)  || 1024, 256), 2048);
  const height = Math.min(Math.max(parseInt(body.height) || 1024, 256), 2048);

  const article = await env.DB.prepare(
    `SELECT id, title, image_prompt, status FROM geo_content_queue WHERE id = ?`
  ).bind(articleId).first();

  if (!article) return jsonResponse({ error: `Article ${articleId} not found` }, 404);

  const finalPrompt = body.prompt_override || article.image_prompt;
  if (!finalPrompt) {
    return jsonResponse({
      error: "Article chưa có image_prompt. Chạy generate-content trước, hoặc gửi prompt_override.",
    }, 400);
  }

  // Wrap prompt với guardrails cho blog hero
  const safePrompt = `${finalPrompt}\n\nPhotography style, professional, clean composition, NO TEXT in image, NO clearly visible faces, brand-safe, modern blog hero image, high detail.`;

  try {
    const result = await generateFluxImage(env, {
      prompt: safePrompt.slice(0, 2000),
      steps,
      width,
      height,
    });

    await env.DB.prepare(`
      UPDATE geo_content_queue SET
        image_base64 = ?,
        image_prompt = ?,
        image_provider = 'flux-schnell',
        cost_image_usd = COALESCE(cost_image_usd, 0) + ?,
        cost_total_usd = COALESCE(cost_total_usd, 0) + ?
      WHERE id = ?
    `).bind(
      result.b64_json,
      safePrompt.slice(0, 1000),
      COST_ESTIMATE,
      COST_ESTIMATE,
      articleId
    ).run();

    return jsonResponse({
      article_id: articleId,
      status: "image_ready",
      provider: "flux-schnell",
      model: MODEL,
      width,
      height,
      steps,
      cost_usd: COST_ESTIMATE,
      free_tier: true,
      has_base64: !!result.b64_json,
      note: "Free trong Cloudflare Workers AI tier (10K neurons/ngày).",
    });

  } catch (err) {
    const errMsg = String(err?.message || err).slice(0, 500);
    return jsonResponse({ error: errMsg, article_id: articleId }, 500);
  }
}

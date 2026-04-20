// Endpoint: POST /api/generate-ad-copy
// Body: { product: "D1" | "DR1" | ..., format: "lead_gen" | ..., formatLabel, cta, notes, promotion }
//  - promotion (tùy chọn): chuỗi mô tả KM do user cung cấp (quà tặng/giảm giá/thời hạn).
//    Nếu rỗng → AI KHÔNG tự ý bịa KM. Chỉ giữ dòng Bảo hành cố định.
// Response: { variants: [...] }
//
// Powered by Cloudflare Workers AI (Llama 3.3 70B) — native Cloudflare, free tier,
// không cần API key, không bị region block.
//
// YÊU CẦU: Cloudflare Pages binding tên "AI" đã được kích hoạt
// (Settings → Functions → Bindings → Add binding → Workers AI → name: AI).

import { getProduct } from "../lib/product-catalog.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/ad-prompts.js";

const CF_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return jsonResponse({
      error: "Thiếu Workers AI binding. Vào Cloudflare Pages → Settings → Functions → Bindings → Add binding → Workers AI → name: AI.",
    }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  const { product: productKey, format, formatLabel, cta, notes, promotion } = body;

  const product = getProduct(productKey);
  if (!product) {
    return jsonResponse({ error: `Không tìm thấy sản phẩm: ${productKey}` }, 400);
  }

  const userPrompt = buildUserPrompt({ product, format, formatLabel, cta, notes, promotion });

  let aiResult;
  try {
    aiResult = await env.AI.run(CF_AI_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      top_p: 0.95,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    return jsonResponse({
      error: "Workers AI lỗi: " + (err?.message || String(err)),
    }, 502);
  }

  // Workers AI trả về { response: "..." } hoặc object đã parse tùy model
  let textOut;
  if (typeof aiResult === "string") {
    textOut = aiResult;
  } else if (aiResult?.response) {
    textOut = typeof aiResult.response === "string"
      ? aiResult.response
      : JSON.stringify(aiResult.response);
  } else if (aiResult?.result) {
    textOut = typeof aiResult.result === "string"
      ? aiResult.result
      : JSON.stringify(aiResult.result);
  } else {
    return jsonResponse({
      error: "Workers AI không trả về nội dung.",
      debug: aiResult,
    }, 502);
  }

  // Thử parse JSON; nếu model kèm text thừa, cố gắng extract block JSON
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const match = textOut.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (err2) {
        return jsonResponse({
          error: "Workers AI trả JSON không hợp lệ.",
          raw: textOut.slice(0, 500),
        }, 502);
      }
    } else {
      return jsonResponse({
        error: "Workers AI trả JSON không hợp lệ.",
        raw: textOut.slice(0, 500),
      }, 502);
    }
  }

  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    return jsonResponse({
      error: "Workers AI không trả variants hợp lệ.",
      raw: parsed,
    }, 502);
  }

  // Truncate to enforce FB limits (safety net)
  parsed.variants = parsed.variants.map((v) => ({
    id: v.id || "?",
    style: v.style || "",
    headline: (v.headline || "").slice(0, 40),
    primary_text: (v.primary_text || "").slice(0, 2200),
    video_title: (v.video_title || "").slice(0, 100),
    description: (v.description || "").slice(0, 30),
  }));

  return jsonResponse({
    ok: true,
    model: CF_AI_MODEL,
    product: productKey,
    variants: parsed.variants,
  });
}

// Các method khác GET/POST sẽ tự động trả 405 bởi Cloudflare Pages Functions

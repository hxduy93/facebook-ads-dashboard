// Endpoint: POST /api/generate-ad-copy
// Body: { product: "D1" | "DR1" | ..., format: "lead_gen" | ..., formatLabel, cta, notes }
// Response: { variants: [...] }
//
// Powered by Groq (Llama 3.3 70B Versatile) — free tier, không region block, siêu nhanh.

import { getProduct } from "../lib/product-catalog.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "../lib/ad-prompts.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GROQ_API_KEY) {
    return jsonResponse({ error: "Thiếu GROQ_API_KEY trong env var." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  const { product: productKey, format, formatLabel, cta, notes } = body;

  const product = getProduct(productKey);
  if (!product) {
    return jsonResponse({ error: `Không tìm thấy sản phẩm: ${productKey}` }, 400);
  }

  const userPrompt = buildUserPrompt({ product, format, formatLabel, cta, notes });

  const groqBody = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.9,
    top_p: 0.95,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  };

  let groqRes;
  try {
    groqRes = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(groqBody),
    });
  } catch (err) {
    return jsonResponse({ error: "Không gọi được Groq API: " + err.message }, 502);
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    return jsonResponse({
      error: `Groq trả về lỗi ${groqRes.status}`,
      detail: errText.slice(0, 500),
    }, 502);
  }

  const groqData = await groqRes.json();
  const textOut = groqData?.choices?.[0]?.message?.content;

  if (!textOut) {
    return jsonResponse({
      error: "Groq không trả về nội dung.",
      debug: groqData,
    }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch (err) {
    return jsonResponse({
      error: "Groq trả JSON không hợp lệ.",
      raw: textOut.slice(0, 500),
    }, 502);
  }

  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    return jsonResponse({
      error: "Groq không trả variants hợp lệ.",
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
    model: GROQ_MODEL,
    product: productKey,
    variants: parsed.variants,
  });
}

// Các method khác GET/POST sẽ tự động trả 405 bởi Cloudflare Pages Functions

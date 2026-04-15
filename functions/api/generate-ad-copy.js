// Endpoint: POST /api/generate-ad-copy
// Body: { product: "D1" | "DR1" | ..., format: "lead_gen" | ..., formatLabel, cta, notes }
// Response: { variants: [...] }

import { getProduct } from "../lib/product-catalog.js";
import { SYSTEM_PROMPT, buildUserPrompt, RESPONSE_SCHEMA } from "../lib/ad-prompts.js";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return jsonResponse({ error: "Thiếu GEMINI_API_KEY trong env var." }, 500);
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

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let geminiRes;
  try {
    geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
  } catch (err) {
    return jsonResponse({ error: "Không gọi được Gemini API: " + err.message }, 502);
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return jsonResponse({
      error: `Gemini trả về lỗi ${geminiRes.status}`,
      detail: errText.slice(0, 500),
    }, 502);
  }

  const geminiData = await geminiRes.json();
  const textOut = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textOut) {
    return jsonResponse({
      error: "Gemini không trả về nội dung.",
      debug: geminiData,
    }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch (err) {
    return jsonResponse({
      error: "Gemini trả JSON không hợp lệ.",
      raw: textOut.slice(0, 500),
    }, 502);
  }

  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    return jsonResponse({
      error: "Gemini không trả variants hợp lệ.",
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
    model: GEMINI_MODEL,
    product: productKey,
    variants: parsed.variants,
  });
}

// Các method khác GET/POST sẽ tự động trả 405 bởi Cloudflare Pages Functions

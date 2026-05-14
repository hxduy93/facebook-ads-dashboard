// Gemini với Google Search grounding.
// Trả về citations URL từ groundingMetadata.groundingChunks.
//
// Model: Gemini 3 Flash Preview — match với consumer Gemini (gemini.google.com)
// hiện default sang Gemini 3. Có thể override qua env var GEMINI_MODEL nếu tên
// model thay đổi (vd Google promote sang stable "gemini-3-flash" không có suffix
// "preview").
//
// Pricing Gemini 3 Flash (2026-05): tương tự 2.5 Flash range
// input ~$0.075/1M tokens, output ~$0.30/1M tokens (sẽ update khi Google công bố giá chính thức).
//
// Route qua Cloudflare AI Gateway nếu env.CF_ACCOUNT_ID set (tăng reliability +
// observability + log). Fallback về generativelanguage.googleapis.com.

const DEFAULT_MODEL = "gemini-3-flash-preview";
const PRICE_IN_PER_1M  = 0.075;
const PRICE_OUT_PER_1M = 0.30;
const GATEWAY_ID = "doscom-erp";

function getModel(env) {
  return env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getBaseUrl(env) {
  if (env.CF_ACCOUNT_ID) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${GATEWAY_ID}/google-ai-studio/v1beta`;
  }
  return "https://generativelanguage.googleapis.com/v1beta";
}

export async function queryGemini(query, env) {
  const MODEL = getModel(env);
  if (!env.GEMINI_API_KEY) return errorResponse("GEMINI_API_KEY missing", MODEL);

  try {
    const url = `${getBaseUrl(env)}/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      const txt = (await res.text()).slice(0, 400);
      return errorResponse(`HTTP ${res.status}: ${txt}`, MODEL);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const responseText = parts.map(p => p?.text).filter(Boolean).join("\n").slice(0, 8000);

    const citations = [];
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    for (const c of chunks) {
      if (c?.web?.uri) {
        citations.push({ url: c.web.uri, title: c.web.title || "" });
      }
    }

    const tIn  = data.usageMetadata?.promptTokenCount     || 0;
    const tOut = data.usageMetadata?.candidatesTokenCount || 0;
    const cost = (tIn * PRICE_IN_PER_1M + tOut * PRICE_OUT_PER_1M) / 1_000_000;

    return {
      engine: "gemini",
      model: MODEL,
      response_text: responseText,
      citations,
      tokens_input: tIn,
      tokens_output: tOut,
      cost_usd: Number(cost.toFixed(6)),
      raw_json: data,
    };
  } catch (err) {
    return errorResponse(err?.message || String(err), MODEL);
  }
}

function errorResponse(error, model) {
  return {
    engine: "gemini",
    model: model || DEFAULT_MODEL,
    response_text: "",
    citations: [],
    tokens_input: 0,
    tokens_output: 0,
    cost_usd: 0,
    raw_json: null,
    error,
  };
}

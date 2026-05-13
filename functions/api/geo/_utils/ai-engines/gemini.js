// Gemini 2.0 Flash với Google Search grounding.
// Trả về citations URL từ groundingMetadata.groundingChunks.
//
// Pricing Gemini 2.0 Flash (2026-05): input $0.075/1M tokens, output $0.30/1M tokens.
// Free tier: 1500 requests/day.

const MODEL = "gemini-2.0-flash";
const PRICE_IN_PER_1M  = 0.075;
const PRICE_OUT_PER_1M = 0.30;

export async function queryGemini(query, env) {
  if (!env.GEMINI_API_KEY) return errorResponse("GEMINI_API_KEY missing");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
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
      return errorResponse(`HTTP ${res.status}: ${txt}`);
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
    return errorResponse(err?.message || String(err));
  }
}

function errorResponse(error) {
  return {
    engine: "gemini",
    model: MODEL,
    response_text: "",
    citations: [],
    tokens_input: 0,
    tokens_output: 0,
    cost_usd: 0,
    raw_json: null,
    error,
  };
}

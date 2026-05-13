// OpenAI engine — GPT-4o-mini với web_search tool (Responses API).
// Trả về citations URL → cần thiết cho GEO Monitor (track AI có cite doscom.vn không).
//
// Pricing GPT-4o-mini (2026-05): input $0.15/1M tokens, output $0.60/1M tokens.
// Web search tool: $25/1000 calls (1 call/response).

const MODEL = "gpt-4o-mini";
const PRICE_IN_PER_1M  = 0.15;
const PRICE_OUT_PER_1M = 0.60;
const WEB_SEARCH_COST  = 25 / 1000; // $0.025 per call

export async function queryOpenAI(query, env) {
  if (!env.OPENAI_API_KEY) return errorResponse("OPENAI_API_KEY missing");

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: query,
        tools: [{ type: "web_search" }],
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const txt = (await res.text()).slice(0, 400);
      return errorResponse(`HTTP ${res.status}: ${txt}`);
    }

    const data = await res.json();

    // Responses API: data.output là array. Lấy item cuối có type="message"
    const output = Array.isArray(data.output) ? data.output : [];
    const messages = output.filter(o => o && o.type === "message");
    const last = messages[messages.length - 1];
    const content = last?.content?.[0];
    const responseText = (content?.text || "").slice(0, 8000);

    const citations = [];
    for (const ann of (content?.annotations || [])) {
      if (ann?.type === "url_citation" && ann.url) {
        citations.push({ url: ann.url, title: ann.title || "" });
      }
    }

    const tIn  = data.usage?.input_tokens  || 0;
    const tOut = data.usage?.output_tokens || 0;
    const tokenCost = (tIn * PRICE_IN_PER_1M + tOut * PRICE_OUT_PER_1M) / 1_000_000;
    const cost = tokenCost + WEB_SEARCH_COST;

    return {
      engine: "chatgpt",
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
    engine: "chatgpt",
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

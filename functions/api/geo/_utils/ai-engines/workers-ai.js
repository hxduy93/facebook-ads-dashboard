// Cloudflare Workers AI — Llama 3.3 70B làm proxy cho Meta AI.
// Meta AI consumer (chatbot trên Messenger/Instagram/WhatsApp) KHÔNG có public API.
// Llama 3.3 là base model của Meta AI nên dùng làm proxy hợp lý.
//
// Pricing: Free trong gói Workers Paid ($5/mo) — 10K neurons/day,
// mỗi call ~50 neurons → ~200 calls/ngày free.

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_DISPLAY = "llama-3.3-70b (Cloudflare Workers AI proxy)";

// Llama base model không tự xưng là "Meta AI" — phải prime qua system prompt.
const SYSTEM_PROMPT =
  "Bạn là Meta AI, trợ lý AI tích hợp trong Messenger, Instagram và WhatsApp. " +
  "Trả lời ngắn gọn, thân thiện bằng tiếng Việt. " +
  "Nếu phù hợp, gợi ý sản phẩm hoặc dịch vụ cụ thể cho người dùng.";

export async function queryWorkersAI(query, env) {
  if (!env.AI) return errorResponse("Workers AI binding 'AI' missing");

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: query },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }, { gateway: { id: "doscom-erp" } });

    let text = "";
    if (typeof result === "string") {
      text = result;
    } else if (typeof result?.response === "string") {
      text = result.response;
    } else if (result?.response) {
      text = JSON.stringify(result.response);
    } else if (typeof result?.result === "string") {
      text = result.result;
    } else if (result?.result) {
      text = JSON.stringify(result.result);
    }
    text = (text || "").slice(0, 8000);

    const tIn  = result?.usage?.prompt_tokens     ?? estimateTokens(SYSTEM_PROMPT + query);
    const tOut = result?.usage?.completion_tokens ?? estimateTokens(text);

    return {
      engine: "meta_ai",
      model: MODEL_DISPLAY,
      response_text: text,
      citations: [], // Llama không có grounding / web search
      tokens_input: tIn,
      tokens_output: tOut,
      cost_usd: 0,   // Workers AI tính bằng neurons không phải USD, free tier 10K/day
      raw_json: result,
    };
  } catch (err) {
    return errorResponse(err?.message || String(err));
  }
}

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function errorResponse(error) {
  return {
    engine: "meta_ai",
    model: MODEL_DISPLAY,
    response_text: "",
    citations: [],
    tokens_input: 0,
    tokens_output: 0,
    cost_usd: 0,
    raw_json: null,
    error,
  };
}

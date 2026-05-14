// Shared Claude helper cho GEO Content Pipeline.
// Gọi Anthropic API qua Cloudflare AI Gateway 'doscom-erp' (cùng pattern agent-fb-ai.js).
//
// Pricing (5/2026):
//   Haiku 4.5:   input $1/1M, output $5/1M    → ~$0.03/bài 2500 từ
//   Sonnet 4.6:  input $3/1M, output $15/1M   → ~$0.09/bài 2500 từ

export const CLAUDE_MODELS = {
  haiku:  "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
};

const PRICING = {
  "claude-haiku-4-5":  { in: 1,  out: 5  },
  "claude-sonnet-4-6": { in: 3,  out: 15 },
};

export async function callClaude(env, {
  model = "haiku",
  systemPrompt,
  userPrompt,
  maxTokens = 4000,
  jsonOutput = false,
  cacheSystem = true,
}) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing in Cloudflare env");
  if (!env.CF_ACCOUNT_ID)     throw new Error("CF_ACCOUNT_ID missing in Cloudflare env");

  const modelId = CLAUDE_MODELS[model] || model;
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/doscom-erp/anthropic/v1/messages`;

  const systemBlock = cacheSystem
    ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: systemPrompt }];

  const body = {
    model: modelId,
    max_tokens: maxTokens,
    system: systemBlock,
    messages: [{ role: "user", content: userPrompt }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude ${modelId} ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === "text");
  if (!textBlock?.text) throw new Error(`Claude ${modelId} returned empty content`);

  const usage = data.usage || {};
  const tIn  = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const tOut = usage.output_tokens || 0;
  const price = PRICING[modelId] || PRICING["claude-haiku-4-5"];
  const cost = (tIn * price.in + tOut * price.out) / 1_000_000;

  let parsed = null;
  if (jsonOutput) {
    parsed = extractJson(textBlock.text);
  }

  return {
    text: textBlock.text,
    parsed,
    tokens_input: tIn,
    tokens_output: tOut,
    cost_usd: Number(cost.toFixed(6)),
    model: modelId,
    raw_usage: usage,
  };
}

function extractJson(text) {
  // Cố parse JSON nguyên text. Nếu fail, tìm khối JSON đầu tiên trong ```json``` hoặc {...}.
  try { return JSON.parse(text); } catch {}

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace  = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch {}
  }

  const firstBracket = text.indexOf("[");
  const lastBracket  = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try { return JSON.parse(text.slice(firstBracket, lastBracket + 1)); } catch {}
  }

  throw new Error(`Claude output không parse được JSON. First 200 chars: ${text.slice(0, 200)}`);
}

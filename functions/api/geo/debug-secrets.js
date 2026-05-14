// Endpoint: GET /api/geo/debug-secrets
// Debug — hiển thị tóm tắt các secret/binding mà Pages Function thấy.
// CHỈ show prefix 6 ký tự + suffix 4 ký tự (an toàn share, không lộ key).
//
// Auth: tự động qua _middleware.js (session cookie).
// XÓA file này sau khi debug xong.

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function maskSecret(value) {
  if (typeof value !== "string") return { present: false, type: typeof value };
  const trimmed = value.trim();
  return {
    present: true,
    length: value.length,
    length_trimmed: trimmed.length,
    has_leading_whitespace: value.length !== value.trimStart().length,
    has_trailing_whitespace: value.length !== value.trimEnd().length,
    first6: trimmed.slice(0, 6),
    last4: trimmed.slice(-4),
  };
}

export async function onRequestGet(context) {
  const { env } = context;

  return jsonResponse({
    info: "Debug endpoint — chỉ show first 6 + last 4 chars của key. KHÔNG lộ key đầy đủ.",
    timestamp: new Date().toISOString(),
    secrets: {
      OPENAI_API_KEY:    maskSecret(env.OPENAI_API_KEY),
      GEMINI_API_KEY:    maskSecret(env.GEMINI_API_KEY),
      ANTHROPIC_API_KEY: maskSecret(env.ANTHROPIC_API_KEY),
    },
    bindings: {
      DB_present: !!env.DB,
      AI_present: !!env.AI,
      KV_present: !!env.KV || !!env.INVENTORY,
    },
    other_env: {
      CF_ACCOUNT_ID_set: !!env.CF_ACCOUNT_ID,
      CF_ACCOUNT_ID_first8: env.CF_ACCOUNT_ID ? env.CF_ACCOUNT_ID.slice(0, 8) : null,
    },
  });
}

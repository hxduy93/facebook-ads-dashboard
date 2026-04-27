// TEMPORARY debug endpoint - se xoa sau khi debug xong.
// Path /auth/_diag - skip auth gate (vi middleware allow tat ca /auth/*)
// Tra ve thong tin env vars (boolean flags only - khong leak value)

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = {};
  for (const [k, v] of request.headers) headers[k] = k.toLowerCase().includes("token") || k.toLowerCase().includes("cookie") ? "***present***" : v;

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    deployed_path: "/auth/_diag",
    env_vars: {
      TEST_BYPASS_TOKEN: !!env.TEST_BYPASS_TOKEN,
      TEST_BYPASS_TOKEN_length: env.TEST_BYPASS_TOKEN ? env.TEST_BYPASS_TOKEN.length : 0,
      SESSION_SECRET: !!env.SESSION_SECRET,
      ALLOWED_EMAILS: !!env.ALLOWED_EMAILS,
      AI: !!env.AI,
      INVENTORY: !!env.INVENTORY,
    },
    request_info: {
      method: request.method,
      pathname: url.pathname,
      received_test_token_header: !!request.headers.get("X-Test-Token"),
      header_token_length: (request.headers.get("X-Test-Token") || "").length,
      tokens_match: env.TEST_BYPASS_TOKEN && request.headers.get("X-Test-Token")
        ? request.headers.get("X-Test-Token") === env.TEST_BYPASS_TOKEN
        : false,
    },
  }, null, 2), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

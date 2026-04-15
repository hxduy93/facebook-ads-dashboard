// Handle Google OAuth callback: exchange code for token, verify email, set cookie
import { createSession } from "../_middleware.js";

function parseJwt(token) {
  const payload = token.split(".")[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
}

function errorPage(message) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Access Denied</title>
<style>body{font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:480px;padding:40px;background:#1a1a1a;border:1px solid #333;border-radius:12px;text-align:center}
h1{color:#fbbf24;margin:0 0 16px}p{color:#ccc;line-height:1.6}
a{display:inline-block;margin-top:20px;padding:10px 20px;background:#fbbf24;color:#111;text-decoration:none;border-radius:6px;font-weight:600}</style></head>
<body><div class="box"><h1>Không có quyền truy cập</h1><p>${message}</p><a href="/auth/login">Thử đăng nhập lại</a></div></body></html>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirect = url.searchParams.get("state") || "/";

  if (!code) {
    return errorPage("Thiếu mã xác thực từ Google.");
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return errorPage("Không lấy được token từ Google. Vui lòng thử lại.");
  }

  const tokens = await tokenRes.json();
  const idToken = tokens.id_token;
  if (!idToken) {
    return errorPage("Google không trả về id_token.");
  }

  const payload = parseJwt(idToken);
  const email = (payload.email || "").toLowerCase();
  const emailVerified = payload.email_verified;

  if (!email || !emailVerified) {
    return errorPage("Email Google chưa được xác minh.");
  }

  // Check whitelist
  const allowed = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(email)) {
    return errorPage(`Email <b>${email}</b> không có trong danh sách được phép truy cập. Liên hệ quản trị viên.`);
  }

  // Create session cookie
  const session = await createSession(email, env.SESSION_SECRET);

  return new Response(null, {
    status: 302,
    headers: {
      "Location": redirect,
      "Set-Cookie": `doscom_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    },
  });
}

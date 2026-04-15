// Google OAuth gate for Cloudflare Pages
// Env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAILS, SESSION_SECRET

const SESSION_COOKIE = "doscom_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifySession(cookie, secret) {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [email, expiry, sig] = parts;
  const expected = await hmacSign(secret, `${email}.${expiry}`);
  if (expected !== sig) return null;
  if (Date.now() > parseInt(expiry, 10)) return null;
  return { email: atob(email.replace(/-/g, "+").replace(/_/g, "/")) };
}

export async function createSession(email, secret) {
  const emailB64 = btoa(email).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expiry = Date.now() + SESSION_MAX_AGE * 1000;
  const sig = await hmacSign(secret, `${emailB64}.${expiry}`);
  return `${emailB64}.${expiry}.${sig}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Skip auth for login/callback routes
  if (url.pathname.startsWith("/auth/")) {
    return next();
  }

  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);

  if (session) {
    // Valid session → continue
    return next();
  }

  // No valid session → redirect to login
  return Response.redirect(`${url.origin}/auth/login?redirect=${encodeURIComponent(url.pathname + url.search)}`, 302);
}

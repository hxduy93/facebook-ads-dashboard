// Test endpoint: GET /api/ga-test
// Verify GA Service Account credential + Property access có work hay không.
// Cần auth (session) hoặc TEST_BYPASS_TOKEN header.

import { verifySession, hasTestBypass } from "../_middleware.js";
import { testConnection, getEngagementByLandingPage, getDeviceBreakdown } from "../lib/googleAnalytics.js";

const SESSION_COOKIE = "doscom_session";

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const result = {
    env_check: {
      GA_PROPERTY_ID: env.GA_PROPERTY_ID || "MISSING",
      GA_SERVICE_ACCOUNT_JSON: env.GA_SERVICE_ACCOUNT_JSON
        ? `present (${env.GA_SERVICE_ACCOUNT_JSON.length} chars)`
        : "MISSING",
    },
  };

  // Test 1: basic connection
  result.connection = await testConnection(env);
  if (!result.connection.ok) return jsonResponse(result, 502);

  // Test 2: engagement by landing page (top 5, last 7 days)
  try {
    result.landing_page_top5 = await getEngagementByLandingPage(env, 7, 5);
  } catch (e) {
    result.landing_page_top5 = { error: String(e.message || e) };
  }

  // Test 3: device breakdown (last 30 days)
  try {
    result.device_breakdown = await getDeviceBreakdown(env, 30);
  } catch (e) {
    result.device_breakdown = { error: String(e.message || e) };
  }

  return jsonResponse(result);
}

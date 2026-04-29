// Google Analytics Data API (GA4) helpers — Cloudflare Workers compatible.
//
// Auth: Service Account JWT → exchange OAuth token → call Data API.
// Token cache: KV `ga_access_token` 55 phút (GA TTL 1h, cache trừ buffer 5 phút).
//
// Env vars required:
//   GA_SERVICE_ACCOUNT_JSON  — full JSON file content of service account key
//   GA_PROPERTY_ID           — numeric property ID (vd: "462289991")
//
// Usage:
//   import { runReport, getEngagementByLandingPage } from "../lib/googleAnalytics.js";
//   const data = await getEngagementByLandingPage(env, 7);

const TOKEN_CACHE_KEY = "ga_access_token";
const TOKEN_TTL_SECONDS = 3300; // 55 minutes (GA token = 1h, leave 5 min buffer)
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

// ── Base64URL helpers (RFC 4648 §5) ──────────────────────────────────────
function base64UrlEncode(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function strToBase64Url(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

// ── PEM → CryptoKey conversion ───────────────────────────────────────────
// PKCS#8 PEM private key ("-----BEGIN PRIVATE KEY-----...") → CryptoKey RSA.
async function importPrivateKey(pem) {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// ── Sign JWT (RS256) for service account assertion ────────────────────────
async function signJwt(saJson) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: saJson.private_key_id };
  const claim = {
    iss: saJson.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600, // 1h validity (Google rejects > 1h)
  };
  const headerB64 = strToBase64Url(JSON.stringify(header));
  const claimB64 = strToBase64Url(JSON.stringify(claim));
  const signingInput = `${headerB64}.${claimB64}`;

  const key = await importPrivateKey(saJson.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

// ── Exchange JWT → OAuth access token ────────────────────────────────────
async function exchangeJwtForToken(jwt) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const r = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Token exchange failed: HTTP ${r.status} ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error(`No access_token in response: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// ── Get access token (cached) ────────────────────────────────────────────
export async function getAccessToken(env) {
  if (!env.GA_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing env GA_SERVICE_ACCOUNT_JSON");
  }
  // Try cache first
  if (env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get(TOKEN_CACHE_KEY);
      if (cached) return cached;
    } catch { /* KV fail → mint new */ }
  }
  // Mint new
  let saJson;
  try {
    saJson = JSON.parse(env.GA_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    throw new Error(`GA_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  }
  if (!saJson.private_key || !saJson.client_email) {
    throw new Error("GA_SERVICE_ACCOUNT_JSON missing private_key or client_email");
  }
  const jwt = await signJwt(saJson);
  const token = await exchangeJwtForToken(jwt);
  // Cache for 55 min
  if (env.INVENTORY) {
    try {
      await env.INVENTORY.put(TOKEN_CACHE_KEY, token, { expirationTtl: TOKEN_TTL_SECONDS });
    } catch { /* KV write fail → ignore, just won't cache */ }
  }
  return token;
}

// ── Low-level: call Data API runReport ───────────────────────────────────
// Body schema: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties/runReport
export async function runReport(env, requestBody) {
  const propertyId = env.GA_PROPERTY_ID;
  if (!propertyId) throw new Error("Missing env GA_PROPERTY_ID");
  const token = await getAccessToken(env);
  const url = `${DATA_API_BASE}/properties/${propertyId}:runReport`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`runReport failed: HTTP ${r.status} ${text.slice(0, 300)}`);
  }
  return r.json();
}

// ── Helpers: rows → flat array of objects ────────────────────────────────
function flattenRows(report) {
  const dimHeaders = (report.dimensionHeaders || []).map(h => h.name);
  const metHeaders = (report.metricHeaders || []).map(h => h.name);
  const rows = report.rows || [];
  return rows.map(row => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
    (row.metricValues || []).forEach((v, i) => { obj[metHeaders[i]] = isNaN(Number(v.value)) ? v.value : Number(v.value); });
    return obj;
  });
}

// ── High-level: 4 metrics chính cho audit Doscom ─────────────────────────

// 1. Engagement + bounce + duration per landing page (cho Landing skill 8%)
export async function getEngagementByLandingPage(env, days = 7, limit = 10) {
  const report = await runReport(env, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "landingPage" }],
    metrics: [
      { name: "sessions" },
      { name: "engagementRate" },
      { name: "bounceRate" },
      { name: "averageSessionDuration" },
      { name: "conversions" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  return flattenRows(report);
}

// 2. Conversion rate per Google Ads campaign (cho Tracking + Waste)
export async function getConversionByCampaign(env, days = 30, limit = 20) {
  const report = await runReport(env, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionGoogleAdsCampaignName" }],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
      { name: "engagementRate" },
      { name: "totalRevenue" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  return flattenRows(report);
}

// 3. Mobile vs Desktop split (cho skill mới Device Performance)
export async function getDeviceBreakdown(env, days = 30) {
  const report = await runReport(env, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "deviceCategory" }],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
  });
  return flattenRows(report);
}

// ── URL → product group classifier ───────────────────────────────────────
// Doscom's site uses Vietnamese-slug URLs. Map LP path → product group key.
const URL_PATTERNS = [
  // Camera 4G (sub-folder của thiet-bi-camera)
  { regex: /thiet-bi-camera\/(camera-nang-luong-mat-troi|camera-4g|nlmt|khong-day|khong-wifi)/i, group: "CAMERA_4G" },
  { regex: /(camera-4g|camera-nang-luong-mat-troi|camera-sim)/i, group: "CAMERA_4G" },
  // Camera Video Call (DA8.1)
  { regex: /(camera-video-call|goi-2-chieu|goi-video|da8|da-8|video-call|tro-chuyen)/i, group: "CAMERA_VIDEO_CALL" },
  // Camera WiFi (mặc định cho thiet-bi-camera ko match cái khác)
  { regex: /(camera-wifi|cam-wifi|camera-trong-nha|camera-ip|thiet-bi-camera)/i, group: "CAMERA_WIFI" },
  // Máy dò
  { regex: /(thiet-bi-do|may-do|do-nghe-len|do-camera-an|phat-hien-thiet-bi)/i, group: "MAY_DO" },
  // Máy ghi âm
  { regex: /(thiet-bi-ghi-am|ghi-am|may-ghi-am|recorder)/i, group: "GHI_AM" },
  // Định vị (đặt sau Máy dò để tránh "do-dinh-vi" match nhầm)
  { regex: /(thiet-bi-dinh-vi|dinh-vi-gps|dinh-vi|tracker|gps)/i, group: "DINH_VI" },
  // Chống ghi âm
  { regex: /(chong-ghi-am|chong-nghe-len|nhieu-song)/i, group: "CHONG_GHI_AM" },
  // NOMA
  { regex: /(noma|cham-soc-xe|tay-o-kinh|cham-soc-o-to)/i, group: "NOMA" },
];

export function classifyByUrl(url) {
  if (!url) return "OTHER";
  const path = String(url).toLowerCase();
  for (const { regex, group } of URL_PATTERNS) {
    if (regex.test(path)) return group;
  }
  return "OTHER";
}

// ── Group-filtered engagement (cho audit per-group) ───────────────────────
// Filter rows từ getEngagementByLandingPage theo URL pattern của group.
// Trả về { rows, summary } - summary aggregated metrics weighted by sessions.
export async function getEngagementByGroup(env, group, days = 7) {
  if (!group || group === "ALL") return null;
  const allRows = await getEngagementByLandingPage(env, days, 50); // top 50 LP

  const groupRows = allRows.filter(r => classifyByUrl(r.landingPage) === group);
  if (groupRows.length === 0) {
    return { rows: [], summary: null, total_lp_count: 0 };
  }

  // Weighted aggregate by sessions
  const totalSessions = groupRows.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
  if (totalSessions === 0) return { rows: groupRows, summary: null, total_lp_count: groupRows.length };

  let weightedER = 0, weightedBR = 0, weightedDur = 0, totalConv = 0;
  for (const r of groupRows) {
    const w = (Number(r.sessions) || 0) / totalSessions;
    weightedER += (Number(r.engagementRate) || 0) * w;
    weightedBR += (Number(r.bounceRate) || 0) * w;
    weightedDur += (Number(r.averageSessionDuration) || 0) * w;
    totalConv += Number(r.conversions) || 0;
  }

  return {
    rows: groupRows.slice(0, 5), // top 5 LP của group
    summary: {
      total_sessions: totalSessions,
      total_conversions: totalConv,
      avg_engagement_rate: Math.round(weightedER * 1000) / 1000,
      avg_bounce_rate: Math.round(weightedBR * 1000) / 1000,
      avg_session_duration_sec: Math.round(weightedDur * 10) / 10,
      conversion_rate: totalSessions > 0 ? Math.round((totalConv / totalSessions) * 10000) / 10000 : 0,
    },
    total_lp_count: groupRows.length,
  };
}

// ── GA Overview (cho Phase 2 dashboard tab) ───────────────────────────────
export async function getGAOverview(env, days = 30) {
  const [totals, topLPs, devices, geos] = await Promise.all([
    runReport(env, {
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
        { name: "screenPageViewsPerSession" },
      ],
    }).then(flattenRows).then(r => r[0] || {}),
    getEngagementByLandingPage(env, days, 10),
    getDeviceBreakdown(env, days),
    getGeoBreakdown(env, days, 8),
  ]);

  // Annotate top LPs với group classification
  const topLPsWithGroup = topLPs.map(lp => ({
    ...lp,
    group: classifyByUrl(lp.landingPage),
  }));

  return {
    period_days: days,
    totals,
    top_landing_pages: topLPsWithGroup,
    device_breakdown: devices,
    geo_breakdown: geos,
  };
}

// 4. Geo breakdown (cho skill mới Geo Performance)
export async function getGeoBreakdown(env, days = 30, limit = 10) {
  const report = await runReport(env, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "city" }],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
      { name: "engagementRate" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  return flattenRows(report);
}

// ── Test endpoint helper: verify connection ──────────────────────────────
// Trả về { ok, sessions, error? } để debug nhanh xem credential có work không.
export async function testConnection(env) {
  try {
    const report = await runReport(env, {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    });
    const rows = flattenRows(report);
    return {
      ok: true,
      property_id: env.GA_PROPERTY_ID,
      sessions: rows[0]?.sessions ?? 0,
      total_users: rows[0]?.totalUsers ?? 0,
      raw: rows,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

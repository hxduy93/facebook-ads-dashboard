// Google Keyword Research helpers — FREE, không cần auth.
// Combine 3 nguồn để approximate Google Keyword Planner:
//   1. Google Suggest API     → expand seed → candidate keywords (real Google data)
//   2. Google Trends (unauth) → relative interest 0-100 cho VN
//   3. Own search_terms.json  → impressions thật (chính xác nhất khi match)
//
// Các hàm đều return data hoặc fallback rỗng — KHÔNG throw — để pipeline
// luôn chạy được kể cả khi Google rate-limit / endpoint flaky.

const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";
const TRENDS_EXPLORE = "https://trends.google.com/trends/api/explore";
const TRENDS_WIDGET = "https://trends.google.com/trends/api/widgetdata/multiline";

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// Strip Google's `)]}',\n` JSON prefix
function parseGoogleJson(text) {
  const cleaned = text.replace(/^\)\]\}',?\s*/, "");
  return JSON.parse(cleaned);
}

// ── Google Suggest ──────────────────────────────────────────────────────
// Endpoint: ?client=firefox&hl=vi&gl=vn&q=<seed>
// Response: ["seed", ["sug1", "sug2", ...], [], {...}]
export async function fetchSuggestions(seed) {
  if (!seed) return [];
  const url = `${SUGGEST_URL}?client=firefox&hl=vi&gl=vn&q=${encodeURIComponent(seed)}`;
  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DoscomBot/1.0)",
        Accept: "application/json,text/javascript,*/*",
      },
    });
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json[1]) ? json[1].slice(0, 15) : [];
  } catch {
    return [];
  }
}

// Mở rộng seed list → candidate set, dedupe + lower-case
export async function expandSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) return [];
  const results = await Promise.all(seeds.map(s => fetchSuggestions(s)));
  const dedup = new Map();
  results.flat().forEach(kw => {
    const norm = String(kw || "").toLowerCase().trim();
    if (norm && !dedup.has(norm)) dedup.set(norm, kw);
  });
  return Array.from(dedup.values());
}

// ── Google Trends ───────────────────────────────────────────────────────
// 2-step: explore → widgetdata. Trends giới hạn 5 keyword/lần so sánh.
// Trả về { keyword: avg_interest_0_to_100 } hoặc {} nếu fail.
export async function fetchTrendsScores(keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return {};
  const limited = keywords.slice(0, 5);

  const exploreReq = {
    comparisonItem: limited.map(kw => ({
      keyword: kw,
      geo: "VN",
      time: "today 12-m",
    })),
    category: 0,
    property: "",
  };
  const exploreUrl = `${TRENDS_EXPLORE}?hl=vi&tz=-420&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;

  let timeseriesWidget;
  try {
    const r = await fetchWithTimeout(exploreUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DoscomBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!r.ok) return {};
    const text = await r.text();
    const data = parseGoogleJson(text);
    timeseriesWidget = data.widgets?.find(w => w.id === "TIMESERIES");
    if (!timeseriesWidget) return {};
  } catch {
    return {};
  }

  const widgetUrl = `${TRENDS_WIDGET}?hl=vi&tz=-420&req=${encodeURIComponent(JSON.stringify(timeseriesWidget.request))}&token=${timeseriesWidget.token}`;

  try {
    const r = await fetchWithTimeout(widgetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DoscomBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!r.ok) return {};
    const text = await r.text();
    const data = parseGoogleJson(text);
    const timeline = data.default?.timelineData || [];
    if (timeline.length === 0) return {};

    const scores = {};
    limited.forEach((kw, i) => {
      const values = timeline.map(t => Number(t.value?.[i]) || 0);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      scores[kw] = Math.round(avg);
    });
    return scores;
  } catch {
    return {};
  }
}

// ── Volume estimation ───────────────────────────────────────────────────
// Priority: own search_terms (real) > calibrated Trends > null (let AI fall back).
// anchor = { keyword, volume, score } lấy từ 1 keyword đã biết volume thật + Trends score.
export function estimateVolume(keyword, searchTermsArr, trendsScore, anchor) {
  if (!keyword) return null;
  const norm = String(keyword).toLowerCase().trim();

  // Source 1: own data
  if (Array.isArray(searchTermsArr)) {
    const matched = searchTermsArr.find(st => {
      const term = String(st?.search_term || st?.term || "").toLowerCase().trim();
      return term === norm;
    });
    if (matched) {
      const imp = Number(matched.impressions || matched.imp || 0);
      if (imp > 0) {
        // Giả định IS riêng ~30% → estimated_volume ≈ imp / 0.3
        return { volume: Math.round(imp / 0.3), source: "own_data", confidence: "high" };
      }
    }
  }

  // Source 2: calibrated Trends
  if (trendsScore != null && anchor && anchor.score > 0 && anchor.volume > 0) {
    const ratio = trendsScore / anchor.score;
    const vol = Math.max(0, Math.round(anchor.volume * ratio));
    return { volume: vol, source: "trends_calibrated", confidence: "medium" };
  }

  // Source 3: no data
  return null;
}

// Tìm anchor keyword tốt nhất: keyword nào có cả own_impressions THẬT
// + có trong trendsScores → dùng làm điểm tham chiếu để convert score → volume.
export function pickAnchor(searchTermsArr, trendsScores) {
  if (!Array.isArray(searchTermsArr) || !trendsScores) return null;
  let best = null;
  for (const [kw, score] of Object.entries(trendsScores)) {
    if (score <= 0) continue;
    const norm = kw.toLowerCase().trim();
    const matched = searchTermsArr.find(st => {
      const term = String(st?.search_term || st?.term || "").toLowerCase().trim();
      return term === norm;
    });
    if (matched) {
      const imp = Number(matched.impressions || matched.imp || 0);
      if (imp > 100 && (!best || imp > best.imp)) {
        best = { keyword: kw, score, volume: Math.round(imp / 0.3), imp };
      }
    }
  }
  return best;
}

// ── Top-level: enrich candidate list ────────────────────────────────────
// Input:  seeds (5-10), searchTermsArr (own data)
// Output: [{ keyword, volume, source, confidence, trendsScore }]
//          sorted by volume desc, capped at 50.
export async function buildEnrichedCandidates(seeds, searchTermsArr) {
  // Step 1: Suggest expand
  const candidates = await expandSeeds(seeds);
  if (candidates.length === 0) return { candidates: [], anchor: null, trendsAttempted: false };

  // Step 2: Trends — chỉ gọi cho top 5 candidate xuất hiện cũng trong own data
  // (anchor tốt nhất). Nếu không match được → gọi Trends cho 5 candidate đầu.
  const ownMatched = candidates.filter(c => {
    const norm = c.toLowerCase().trim();
    return (searchTermsArr || []).some(st => {
      const term = String(st?.search_term || st?.term || "").toLowerCase().trim();
      return term === norm;
    });
  });
  const trendsTargets = (ownMatched.length >= 2 ? ownMatched : candidates).slice(0, 5);
  const trendsScores = await fetchTrendsScores(trendsTargets);
  const anchor = pickAnchor(searchTermsArr, trendsScores);

  // Step 3: Score every candidate
  const enriched = candidates.map(kw => {
    const score = trendsScores[kw];
    const est = estimateVolume(kw, searchTermsArr, score, anchor);
    return {
      keyword: kw,
      volume: est?.volume ?? null,
      source: est?.source ?? "ai_fallback",
      confidence: est?.confidence ?? "low",
      trendsScore: score ?? null,
    };
  });

  // Sort: own_data first (highest confidence), then by volume desc
  enriched.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    const ra = rank[a.confidence] ?? 3;
    const rb = rank[b.confidence] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.volume || 0) - (a.volume || 0);
  });

  return {
    candidates: enriched.slice(0, 50),
    anchor,
    trendsAttempted: Object.keys(trendsScores).length > 0,
  };
}

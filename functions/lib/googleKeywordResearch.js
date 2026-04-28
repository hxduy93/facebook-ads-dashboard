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
// Trả về { keywords, status, debug } để diagnose khi fail.
export async function fetchSuggestions(seed) {
  if (!seed) return { keywords: [], status: "no_seed" };
  const url = `${SUGGEST_URL}?client=firefox&hl=vi&gl=vn&q=${encodeURIComponent(seed)}`;
  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
    });
    if (!r.ok) return { keywords: [], status: `http_${r.status}`, debug: `HTTP ${r.status}` };
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { keywords: [], status: "parse_fail", debug: `parse fail; sample=${text.slice(0, 120)}` };
    }
    if (!Array.isArray(json) || !Array.isArray(json[1])) {
      return { keywords: [], status: "no_array", debug: `json shape=${JSON.stringify(json).slice(0, 120)}` };
    }
    return { keywords: json[1].slice(0, 15), status: "ok" };
  } catch (e) {
    return { keywords: [], status: `error_${e.name || "unknown"}`, debug: String(e.message || e).slice(0, 200) };
  }
}

// Mở rộng seed list → candidate set, dedupe + lower-case
// Trả về { candidates, perSeed: [{seed, status, count, debug}] }
export async function expandSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) return { candidates: [], perSeed: [] };
  const results = await Promise.all(seeds.map(s => fetchSuggestions(s)));
  const dedup = new Map();
  results.forEach(r => {
    (r.keywords || []).forEach(kw => {
      const norm = String(kw || "").toLowerCase().trim();
      if (norm && !dedup.has(norm)) dedup.set(norm, kw);
    });
  });
  const perSeed = seeds.map((s, i) => ({
    seed: s,
    status: results[i].status,
    count: (results[i].keywords || []).length,
    debug: results[i].debug || null,
  }));
  return { candidates: Array.from(dedup.values()), perSeed };
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
// Output: { candidates, anchor, trendsAttempted, suggestDebug, trendsDebug }
export async function buildEnrichedCandidates(seeds, searchTermsArr) {
  // Step 1: Suggest expand
  const expanded = await expandSeeds(seeds);
  const candidates = expanded.candidates;
  const suggestDebug = expanded.perSeed;

  if (candidates.length === 0) {
    return {
      candidates: [],
      anchor: null,
      trendsAttempted: false,
      suggestDebug,
      trendsDebug: { skipped: "no_candidates" },
    };
  }

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
  let trendsScores = {};
  let trendsDebug = { targets: trendsTargets };
  try {
    trendsScores = await fetchTrendsScores(trendsTargets);
    trendsDebug.scores_count = Object.keys(trendsScores).length;
  } catch (e) {
    trendsDebug.error = String(e.message || e).slice(0, 200);
  }
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
    suggestDebug,
    trendsDebug,
  };
}

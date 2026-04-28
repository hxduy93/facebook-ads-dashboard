// API Agent Google Ads AI v3.1 — Cloudflare Workers AI + Filter theo nhóm SP
// Endpoint: POST /api/agent-google-ai
// Body: {
//   mode,
//   question?,
//   context?: { product_group?: "ALL"|"CAMERA_WIFI"|"CAMERA_4G"|"CAMERA_VIDEO_CALL"|"MAY_DO"|"GHI_AM"|"DINH_VI"|"CHONG_GHI_AM"|"NOMA" }
// }

import { verifySession, hasTestBypass } from "../_middleware.js";
import { buildEnrichedCandidates } from "../lib/googleKeywordResearch.js";

const SESSION_COOKIE = "doscom_session";
const MODEL_FAST = "@cf/meta/llama-3.1-8b-instruct-fast";
const MODEL_BIG = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const GROUP_LABELS = {
  ALL: "Tất cả 8 nhóm SP",
  CAMERA_VIDEO_CALL: "Camera video call (DA8.1)",
  CAMERA_4G: "Camera 4G",
  CAMERA_WIFI: "Camera WiFi",
  MAY_DO: "Máy dò",
  GHI_AM: "Máy ghi âm",
  DINH_VI: "Định vị",
  CHONG_GHI_AM: "Chống ghi âm",
  NOMA: "NOMA (chăm sóc xe)",
};

// Few-shot seed keywords per group: AI yếu hay copy nguyên ví dụ → mỗi nhóm
// dùng seed riêng để keyword đề xuất luôn THUỘC nhóm đang chọn (tránh leak).
const SEED_KEYWORDS = {
  MAY_DO: [
    { mech: "HARVEST", kw: "máy dò nghe lén giá rẻ", match: "Phrase", bid: "9,000đ", vol: 8100, click: 113, reason: "Search term có 8 đơn 30d, CVR 4.2% — kw chuẩn xác", lift: "+10-15 đơn" },
    { mech: "LONG-TAIL", kw: "thiết bị dò camera ẩn trong khách sạn", match: "Exact", bid: "4,000đ", vol: 320, click: 4, reason: "Long-tail intent rõ, CPC rẻ, ít cạnh tranh", lift: "+2-3 đơn" },
    { mech: "COMPETITOR FLAG", kw: "máy phát hiện camera quay lén wifi", match: "Phrase", bid: "7,500đ", vol: 4500, click: 54, reason: "Đối thủ chạy 30d, mình chưa có", lift: "+5 đơn" },
    { mech: "HARVEST", kw: "máy dò sóng nghe lén doscom", match: "Exact", bid: "16,000đ", vol: 1800, click: 200, reason: "XUẤT SẮC: Brand kw + 6 đơn 30d → phá trần 10K", lift: "+15 đơn" },
  ],
  GHI_AM: [
    { mech: "HARVEST", kw: "máy ghi âm chuyên nghiệp", match: "Phrase", bid: "8,000đ", vol: 6500, click: 78, reason: "Tier 1 intent công sở, CVR ổn", lift: "+8-10 đơn" },
    { mech: "LONG-TAIL", kw: "máy ghi âm có chức năng dịch tự động", match: "Exact", bid: "5,000đ", vol: 280, click: 6, reason: "Long-tail ngách, CPC rẻ", lift: "+2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "máy ghi âm mini siêu nhỏ pin trâu", match: "Phrase", bid: "6,500đ", vol: 3200, click: 38, reason: "Đối thủ chạy nhiều, mình thiếu", lift: "+4 đơn" },
    { mech: "HARVEST", kw: "máy ghi âm doscom dr1", match: "Exact", bid: "18,000đ", vol: 2800, click: 315, reason: "XUẤT SẮC: Brand kw + 12 đơn 30d + LP optimize → phá trần 10K", lift: "+20 đơn" },
  ],
  DINH_VI: [
    { mech: "HARVEST", kw: "định vị xe máy không dây", match: "Phrase", bid: "8,000đ", vol: 7200, click: 86, reason: "Tier 1 intent thị trường", lift: "+8 đơn" },
    { mech: "LONG-TAIL", kw: "thiết bị định vị nhỏ gọn pin trâu 30 ngày", match: "Exact", bid: "5,000đ", vol: 240, click: 5, reason: "Long-tail spec, intent mua rõ", lift: "+2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "định vị mini không dây", match: "Phrase", bid: "7,500đ", vol: 4500, click: 54, reason: "Đối thủ ABC chạy 30d, mình chưa có", lift: "+5 đơn" },
    { mech: "HARVEST", kw: "định vị doscom chính hãng", match: "Exact", bid: "15,000đ", vol: 1500, click: 168, reason: "XUẤT SẮC: Brand kw + intent mua mạnh", lift: "+12 đơn" },
  ],
  CHONG_GHI_AM: [
    { mech: "HARVEST", kw: "thiết bị chống ghi âm phòng họp", match: "Phrase", bid: "9,000đ", vol: 3800, click: 46, reason: "Tier 1 corporate B2B intent rõ", lift: "+5 đơn" },
    { mech: "LONG-TAIL", kw: "máy làm nhiễu microphone phòng họp kín", match: "Exact", bid: "4,500đ", vol: 180, click: 3, reason: "Long-tail kỹ thuật, ngách hẹp", lift: "+1-2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "máy chống nghe lén cá nhân", match: "Phrase", bid: "6,000đ", vol: 2400, click: 29, reason: "Đối thủ flag, mình thiếu coverage", lift: "+3 đơn" },
    { mech: "HARVEST", kw: "máy chống ghi âm doscom", match: "Exact", bid: "17,000đ", vol: 900, click: 100, reason: "XUẤT SẮC: Brand kw B2B premium", lift: "+8 đơn" },
  ],
  CAMERA_4G: [
    { mech: "HARVEST", kw: "camera 4g ngoài trời không dây", match: "Phrase", bid: "8,000đ", vol: 9000, click: 108, reason: "Tier 1 broad intent rõ", lift: "+10 đơn" },
    { mech: "LONG-TAIL", kw: "camera 4g năng lượng mặt trời chống nước", match: "Exact", bid: "5,500đ", vol: 320, click: 7, reason: "Long-tail spec, ít cạnh tranh", lift: "+2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "camera 4g pin trâu xem từ xa", match: "Phrase", bid: "6,500đ", vol: 3500, click: 42, reason: "Đối thủ chạy phổ biến", lift: "+4 đơn" },
    { mech: "HARVEST", kw: "camera 4g doscom chính hãng", match: "Exact", bid: "14,000đ", vol: 1200, click: 135, reason: "XUẤT SẮC: Brand kw + intent rõ", lift: "+10 đơn" },
  ],
  CAMERA_WIFI: [
    { mech: "HARVEST", kw: "camera wifi trong nhà 2k", match: "Phrase", bid: "8,000đ", vol: 11000, click: 132, reason: "Tier 1 broad intent gia đình", lift: "+12 đơn" },
    { mech: "LONG-TAIL", kw: "camera wifi xoay 360 độ nhìn đêm full color", match: "Exact", bid: "5,500đ", vol: 360, click: 8, reason: "Long-tail spec rõ", lift: "+2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "camera wifi không dây pin trâu", match: "Phrase", bid: "6,500đ", vol: 4200, click: 50, reason: "Đối thủ phổ biến, mình thiếu cover", lift: "+5 đơn" },
    { mech: "HARVEST", kw: "camera wifi doscom", match: "Exact", bid: "13,000đ", vol: 1400, click: 158, reason: "XUẤT SẮC: Brand kw + intent rõ", lift: "+11 đơn" },
  ],
  CAMERA_VIDEO_CALL: [
    { mech: "HARVEST", kw: "camera gọi video 2 chiều cho bố mẹ", match: "Phrase", bid: "8,500đ", vol: 5500, click: 66, reason: "Tier 1 emotional intent rõ", lift: "+7 đơn" },
    { mech: "LONG-TAIL", kw: "camera trò chuyện với con nhỏ ở nhà từ xa", match: "Exact", bid: "5,000đ", vol: 240, click: 5, reason: "Long-tail family intent", lift: "+2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "camera nói chuyện 2 chiều cho người già", match: "Phrase", bid: "7,000đ", vol: 3000, click: 36, reason: "Đối thủ chạy phổ biến", lift: "+4 đơn" },
    { mech: "HARVEST", kw: "camera video call doscom da8.1", match: "Exact", bid: "15,000đ", vol: 800, click: 90, reason: "XUẤT SẮC: Brand kw + product code", lift: "+8 đơn" },
  ],
  NOMA: [
    { mech: "HARVEST", kw: "thiết bị chăm sóc xe noma", match: "Phrase", bid: "7,000đ", vol: 2400, click: 29, reason: "Tier 1 brand intent", lift: "+3 đơn" },
    { mech: "LONG-TAIL", kw: "khăn lau xe siêu sạch noma a002", match: "Exact", bid: "4,000đ", vol: 180, click: 4, reason: "Long-tail brand SKU rõ", lift: "+1-2 đơn" },
    { mech: "COMPETITOR FLAG", kw: "tẩy ố kính ô tô không bám vân", match: "Phrase", bid: "5,500đ", vol: 1800, click: 22, reason: "Đối thủ flag, mình thiếu", lift: "+2 đơn" },
    { mech: "HARVEST", kw: "noma 911 chính hãng", match: "Exact", bid: "12,000đ", vol: 600, click: 67, reason: "XUẤT SẮC: Brand kw + intent mua rõ", lift: "+5 đơn" },
  ],
};

function buildFewShotKeywordRows(group) {
  const groupLabel = GROUP_LABELS[group] || "nhóm hiện tại";
  const seeds = SEED_KEYWORDS[group];
  if (!seeds) {
    // ALL hoặc nhóm lạ → để placeholder, AI tự fill
    return `| 1 | HARVEST | Add | ${groupLabel} | "[keyword thuộc ${groupLabel}]" | Phrase | 9,000đ | 8,100 | 113 | Search term có conversion | +10 đơn |
| 2 | LONG-TAIL | Add | ${groupLabel} | "[keyword long-tail thuộc ${groupLabel}]" | Exact | 4,000đ | 320 | 4 | Long-tail intent rõ | +2 đơn |
| 3 | COMPETITOR FLAG | Add | ${groupLabel} | "[keyword đối thủ thuộc ${groupLabel}]" | Phrase | 7,500đ | 4,500 | 54 | Đối thủ chạy mình chưa có | +5 đơn |
| 4 | HARVEST | Add | ${groupLabel} | "[brand keyword thuộc ${groupLabel}]" | Exact | 16,000đ | 1,800 | 200 | XUẤT SẮC: Brand kw | +12 đơn |`;
  }
  return seeds.map((s, i) =>
    `| ${i + 1} | ${s.mech} | Add | ${groupLabel} | "${s.kw}" | ${s.match} | ${s.bid} | ${s.vol.toLocaleString("en-US")} | ${s.click} | ${s.reason} | ${s.lift} |`
  ).join("\n");
}

// Classify SP code (KV inventory) → group
function classifyByName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "OTHER";
  // Match keyword-style trước (cho ad text dài chứa "máy dò D1 ...")
  if (/máy\s*dò|may\s*do|phát hiện thiết bị|dò\s*nghe lén|dò\s*định vị/i.test(n)) return "MAY_DO";
  if (/gọi\s*2.*chiều|video\s*call|trò chuyện|nhìn.*con/i.test(n)) return "CAMERA_VIDEO_CALL";
  if (/máy\s*ghi\s*âm|ghi âm|recorder/i.test(n)) return "GHI_AM";
  if (/định\s*vị|dinh\s*vi|gps|tracker/i.test(n) && !/dò.*định vị/.test(n)) return "DINH_VI";
  if (/chống\s*ghi\s*âm|nhiễu sóng|chống nghe lén/i.test(n)) return "CHONG_GHI_AM";
  if (/noma|a002|khăn|tẩy ố|chăm sóc xe/i.test(n)) return "NOMA";
  if (/không.*wifi|năng lượng mặt trời|nlmt|camera.*4g|camera.*sim/i.test(n)) return "CAMERA_4G";
  // Match SKU-style (cho KV inventory với prefix code)
  if (/^da\s*8\.1|\bda\s*8\.1\b/.test(n)) return "CAMERA_VIDEO_CALL";
  if (/^da\d|\bda\d/.test(n)) {
    if (/4g|sim|nlmt|năng lượng/.test(n)) return "CAMERA_4G";
    const g4 = ["da1 pro 4g","da1 zoomx6","da1 pro","da2","da3 pro 4g","da5.1","da6","da6.1","da6.2"];
    for (const c of g4) if (n.includes(c)) return "CAMERA_4G";
    return "CAMERA_WIFI";
  }
  if (/^dr\d|\bdr\d/.test(n)) return "GHI_AM";
  if (/^di\d|\bdi\d/.test(n)) return "CHONG_GHI_AM";
  if (/^dv\d|\bdv\d|^dt\d|\bdt\d/.test(n)) return "DINH_VI";
  if (/^d\d|\bd\d/.test(n)) return "MAY_DO";  // last fallback for "D1", "D8 Pro"
  return "OTHER";
}

// Classify search term theo intent
const ST_PATTERNS = {
  CAMERA_VIDEO_CALL: /(gọi.*2.*chiều|video.*call|trò chuyện|ông.*bà|nhìn.*con|gọi điện 2)/i,
  CAMERA_4G: /(không.*wifi|không cần wifi|năng lượng mặt trời|nlmt|4g|sim|ngoài trời)/i,
  CAMERA_WIFI: /(camera.*wifi|cam.*nhà|camera.*phòng|camera ip|camera trong nhà)/i,
  MAY_DO: /(dò.*nghe lén|dò.*camera|máy dò|phát hiện thiết bị|dò.*sóng|dò.*định vị)/i,
  GHI_AM: /(máy.*ghi.*âm|ghi âm|recorder|thiết bị ghi)/i,
  DINH_VI: /(định vị|gps|theo dõi.*xe|theo dõi.*con|tracker)/i,
  CHONG_GHI_AM: /(chống.*ghi.*âm|nhiễu sóng|chống nghe lén|bảo mật.*họp)/i,
  NOMA: /(noma|chăm sóc.*xe|tẩy.*ố|tẩy.*kính|đèn pha|nhựa.*xe)/i,
};

function classifySearchTerm(term) {
  const t = String(term || "").toLowerCase();
  for (const [g, pat] of Object.entries(ST_PATTERNS)) {
    if (pat.test(t)) return g;
  }
  return "OTHER";
}

// Skill summary compact
const SKILL_SUMMARY = {
  parent: `# DOSCOM GOOGLE ADS — TỔNG QUAN
Mục tiêu: Lợi nhuận ≥30% (KHÔNG dùng ROAS)
Profit = Doanh thu − VAT 10% − Giá vốn − Chi phí QC
Trần CPA Search = 0.6 × Bán − Vốn − VAT
Trần CPA Display = 0.5 × Bán − Vốn − VAT
8 nhóm chấm điểm: Tracking 25% · Profit/SP 22% · Lãng phí 13% · RSA 12% · Cấu trúc kw 10% · Trang đích 8% · Budget 5% · Compliance 5%
Loại: 85+=A, 70-84=B, 55-69=C, 40-54=D, <40=F`,

  keyword: `# KEYWORD AUDIT + SUGGEST
Tier 1 Cốt lõi (KHÔNG pause): máy dò nghe lén, camera giấu, ghi âm, định vị, NOMA
Tier 2 Kế cận: liên quan nhưng không chính
Tier 3 Không liên quan: pause mạnh
Cổng kiểm định: số đơn dự kiến < 3 → KHÔNG pause
7 nhóm chấm điểm: QS 20% · Match 15% · CVR/CPA 20% · Cấu trúc 15% · Brand 10% · Cannibalization 10% · ST Health 10%
5 cơ chế suggest: HARVEST, REPLACE DYING, LONG-TAIL, COMPETITOR FLAG, SEASONAL`,

  gdn: `# GDN/PMAX AUDIT + SUGGEST BANNER
Trần CPA Display chặt 0.5x
6 nhóm: Asset 25% · PMax Rating 20% · Placement 20% · Targeting 15% · Measurement 10% · Cấu trúc 10%
5 cơ chế suggest banner: TOP PERFORMER REPLICATION, REPLACE LOSER (brief đầy đủ), FILL ASPECT RATIO GAP, A/B CHALLENGER, SEASONAL
Brief banner: size, layout vùng, color hex, copy, CTA, hypothesis, cost dựng (~80K AI / 300K designer)`,

  headline: `# HEADLINE AUDIT + SUGGEST
USP catalog 8 nhóm SP Doscom (USP cụ thể, không cliché)
- DA8.1 (video call): Gọi 2 chiều, ông bà bố mẹ, không smartphone, HD
- Camera 4G: Không wifi, không hồng ngoại, quay đêm, pin 10-90 ngày
- Camera WiFi: Pin lâu, 4K, lưu cloud
- Máy dò: Phát hiện định vị/quay lén/nghe lén
- Máy ghi âm: Pin 30h, nhỏ, ghi 1 chạm, lưu 500h
- Định vị: Không dây, mini, real-time, 5m, pin 20 ngày
- Chống ghi âm: Nhiễu sóng, phòng VIP
- NOMA: Chuẩn Mỹ, DIY, HSD 3 năm
7 công thức: AIDA, FAB, PAS, BAB, Hook-Value-CTA, 4Cs, SLAP
6 nhóm chấm điểm: Số lượng 15% · Công thức 20% · USP 20% · CTA+Trust 15% · Tránh cliché 15% · Chính tả+Strength 15%
5 cơ chế: REPLICATE WINNER, REPLACE LOSER, FILL FORMULA GAP, USP-DRIVEN, SEASONAL
Cliché TUYỆT ĐỐI tránh: "tốt nhất", "rẻ nhất", "số 1", "uy tín #1", "hoàn tiền 100%", "click ngay"`,
};

// Tat ca mode chay MODEL_FAST (Llama 3.1 8B) - nhanh, it timeout
const MODE_CONFIG = {
  audit_account:      { skills: ["parent"], data: ["context", "spend", "revenue", "inventory"], model: MODEL_FAST },
  audit_account_json: { skills: ["parent"], data: ["context", "spend", "revenue", "inventory"], model: MODEL_FAST, json_output: true },
  audit_keyword:      { skills: ["keyword"], data: ["context", "search_terms", "spend", "inventory"], model: MODEL_FAST },
  audit_gdn:          { skills: ["gdn"], data: ["context", "ads", "placement", "spend", "inventory"], model: MODEL_FAST },
  audit_headline:     { skills: ["headline"], data: ["ads", "context", "inventory"], model: MODEL_FAST },
  suggest_keyword:    { skills: ["keyword"], data: ["search_terms", "context", "inventory"], model: MODEL_FAST },
  suggest_headline:   { skills: ["headline"], data: ["ads", "context", "inventory"], model: MODEL_FAST },
  suggest_banner:     { skills: ["gdn"], data: ["ads", "placement", "inventory"], model: MODEL_FAST },
  ask:                { skills: ["parent", "keyword", "gdn", "headline"], data: ["context", "spend", "revenue", "inventory"], model: MODEL_FAST },
};

// Suggest modes dùng KV cache 24h — bấm lại trong ngày trả kết quả cũ, đảm bảo nhất quán.
// User bấm "Làm mới" (force_refresh=true) để re-generate.
const SUGGEST_MODES = new Set(["suggest_keyword", "suggest_headline", "suggest_banner"]);
const CACHE_TTL_SECONDS = 86400; // 24 giờ
// Bump khi đổi prompt/post-process để invalidate KV entries cũ (cache cũ chứa output có heading).
const CACHE_VERSION = "v4";

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

// Llama 3.1 8B prompt-following yếu: hay tách output thành nhiều bảng nhỏ với heading
// "### 1. HARVEST - ...", "### 2. LONG-TAIL - ..." dù prompt yêu cầu 1 bảng. Hàm này post-process:
//   1. Bỏ tất cả markdown heading + dòng chú thích (### ..., ## ..., **N. WORD**, etc.)
//   2. Gộp tất cả data row (| ... |) từ mọi bảng nhỏ vào 1 bảng duy nhất
//   3. Re-number cột # liên tục 1..N (không reset theo từng bảng nhỏ)
// Áp dụng cho mode suggest_keyword. Luôn strip heading kể cả khi không detect được bảng.
function mergeKeywordTables(text) {
  if (!text || typeof text !== "string") return text;
  const lines = text.split("\n");
  let headerLine = null;
  let separatorLine = null;
  const dataRows = [];
  // Fallback: giữ lại các dòng table-like nếu header chuẩn không detect được
  const tableLikeRows = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // BULLETPROOF: chỉ giữ những dòng bắt đầu và kết thúc bằng "|" (table-related).
    // Mọi thứ khác (heading H1-H6, **bold**, plain text, list, paragraph, code fence, ...)
    // đều bị skip — bất kể format AI sinh ra.
    if (!line.startsWith("|") || !line.endsWith("|")) continue;

    // Table separator: | --- | --- |
    if (/^\|[\s\-|:]+\|$/.test(line)) {
      if (!separatorLine) separatorLine = line;
      continue;
    }

    // Header row: cell #1 là "#" + có chữ "Cơ chế" hoặc "Co che"
    const isHeader = /^\|\s*#\s*\|/.test(line) && /Cơ chế|Co che/i.test(line);
    if (isHeader) {
      if (!headerLine) headerLine = line;
      continue;
    }

    // Data row chuẩn: cell #1 là số
    if (/^\|\s*\d+\s*\|/.test(line)) {
      dataRows.push(line);
      continue;
    }

    // Fallback: header lạ hoặc data row không bắt đầu bằng số → vẫn giữ làm table-like
    tableLikeRows.push(line);
  }

  // Path A: Đầy đủ header + separator + numeric data rows → gộp + renumber
  if (headerLine && separatorLine && dataRows.length > 0) {
    let counter = 1;
    const renumbered = dataRows.map(row =>
      row.replace(/^\|\s*\d+\s*\|/, `| ${counter++} |`)
    );
    return [headerLine, separatorLine, ...renumbered].join("\n");
  }

  // Path B: Có separator + ít nhất 1 row table-like (kể cả header lạ) → return chỉ phần bảng
  // → strip heading H1-H6, bold, paragraph chú thích bên ngoài
  if (separatorLine && (dataRows.length > 0 || tableLikeRows.length > 0)) {
    const allRows = [...tableLikeRows, ...dataRows];
    if (headerLine) return [headerLine, separatorLine, ...allRows].join("\n");
    if (allRows.length >= 2) return [allRows[0], separatorLine, ...allRows.slice(1)].join("\n");
  }

  // Path C: Không detect được bảng — chỉ strip heading/bold/list mà giữ phần còn lại
  const stripped = lines.filter(raw => {
    const line = raw.trim();
    if (!line) return false;
    if (/^#{1,6}\s/.test(line)) return false;          // ### heading
    if (/^\*\*\d+\.\s/.test(line)) return false;        // **1. WORD - ...**
    if (/^\d+\.\s+\*\*/.test(line)) return false;       // 1. **WORD** - ...
    return true;
  });
  return stripped.join("\n");
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function fetchJson(origin, path, cookieHeader) {
  try {
    const r = await fetch(new URL(path, origin).toString(), { headers: { Cookie: cookieHeader || "" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchInventoryCompact(env, group) {
  try {
    const list = await env.INVENTORY.list({ limit: 1000 });
    const items = [];
    await Promise.all(list.keys.slice(0, 200).map(async (k) => {
      try {
        const v = await env.INVENTORY.get(k.name, { type: "json" });
        if (v && v.gia_nhap_vnd > 0) {
          const g = classifyByName(k.name);
          if (group === "ALL" || g === group) {
            items.push({ code: k.name.slice(0, 60), group: g, cost: v.gia_nhap_vnd, price: v.gia_ban_vnd, status: v.trang_thai });
          }
        }
      } catch {}
    }));
    return items.slice(0, 80);
  } catch { return []; }
}

function compactSearchTerms(j, topN, group) {
  if (!j || !j.term_aggregates) return null;
  let arr = Object.entries(j.term_aggregates)
    .map(([term, s]) => ({ term, group: classifySearchTerm(term), clicks: s.clicks_30d, conv: s.conversions_30d, cpc: s.cpc_30d, ctr: s.ctr_30d, spend: s.spend_30d }));
  if (group !== "ALL") arr = arr.filter(x => x.group === group);
  arr = arr.sort((a, b) => (b.conv * 1000 + b.clicks) - (a.conv * 1000 + a.clicks)).slice(0, topN);
  return { date_range: j.date_range, group_filter: group, top: arr, total_in_group: arr.length };
}

// Map category Windsor.ai (vd "GHIAM") -> Doscom group (vd "GHI_AM")
const WINDSOR_CAT_MAP = {
  "GHIAM": "GHI_AM",
  "MAYDO": "MAY_DO",
  "DINHVI": "DINH_VI",
  "CAMCALL": "CAMERA_VIDEO_CALL",
  "OTHER_DI": "CHONG_GHI_AM",
  "OTHER_SIM": "CAMERA_4G",
  "OTHER_CAM": null,
};
function mapWindsorCategory(cat, campaign) {
  if (!cat) return "OTHER";
  if (WINDSOR_CAT_MAP[cat]) return WINDSOR_CAT_MAP[cat];
  if (cat === "OTHER_CAM") {
    const c = (campaign || "").toLowerCase();
    if (/4g|sim|nlmt|nang luong|năng lượng/.test(c)) return "CAMERA_4G";
    return "CAMERA_WIFI";
  }
  return cat;
}

function classifyByCode(code) {
  const c = String(code || "").toUpperCase().trim();
  if (!c) return "OTHER";
  if (/^DA8\.1/.test(c)) return "CAMERA_VIDEO_CALL";
  if (/^DR\d/.test(c)) return "GHI_AM";
  if (/^DI\d/.test(c)) return "CHONG_GHI_AM";
  if (/^DV\d|^DT\d/.test(c)) return "DINH_VI";
  if (/^DA(1 PRO 4G|1 ZOOMX6|2|3 PRO 4G|5\.1|6|6\.1|6\.2)/.test(c)) return "CAMERA_4G";
  if (/^DA\d/.test(c)) return "CAMERA_WIFI";
  if (/^D\d/.test(c)) return "MAY_DO";
  if (/NOMA|A002/.test(c)) return "NOMA";
  return "OTHER";
}

function inTimeRange(dateStr, timeRange) {
  if (!timeRange || !timeRange.start || !timeRange.end) return true;
  return dateStr >= timeRange.start && dateStr <= timeRange.end;
}

function compactRevenue(j, group, timeRange) {
  if (!j || !j.products) return null;
  const products = j.products;
  const byGroup = {};
  for (const [code, p] of Object.entries(products)) {
    const grp = classifyByCode(code);
    if (!byGroup[grp]) byGroup[grp] = { revenue: 0, orders: 0, units: 0, products: [] };
    let revenue = 0, orders = 0, units = 0;
    if (timeRange) {
      for (const [d, v] of Object.entries(p.by_date || {})) if (inTimeRange(d, timeRange)) revenue += Number(v || 0);
      for (const [d, v] of Object.entries(p.orders_by_date || {})) if (inTimeRange(d, timeRange)) orders += Number(v || 0);
      for (const [d, v] of Object.entries(p.units_by_date || {})) if (inTimeRange(d, timeRange)) units += Number(v || 0);
    } else {
      revenue = Number(p.total || 0);
      orders = Number(p.orders || 0);
      units = Number(p.units || 0);
    }
    byGroup[grp].revenue += revenue;
    byGroup[grp].orders += orders;
    byGroup[grp].units += units;
    if (revenue > 0) {
      byGroup[grp].products.push({ code, revenue: Math.round(revenue), orders, units });
    }
  }
  const totalRev = Object.values(byGroup).reduce((a, b) => a + b.revenue, 0);
  if (group === "ALL") {
    const summary = {};
    for (const [g, v] of Object.entries(byGroup)) {
      summary[g] = { revenue: Math.round(v.revenue), orders: v.orders, units: v.units };
    }
    return {
      window_label: timeRange ? (timeRange.start + " -> " + timeRange.end) : "90d (no filter)",
      by_doscom_group: summary,
      total_revenue: Math.round(totalRev),
    };
  }
  const g = byGroup[group] || { revenue: 0, orders: 0, units: 0, products: [] };
  return {
    window_label: timeRange ? (timeRange.start + " -> " + timeRange.end) : "90d (no filter)",
    group_filter: group,
    revenue: Math.round(g.revenue),
    orders: g.orders,
    units: g.units,
    top_products: g.products.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

function compactSpend(j, group, timeRange) {
  if (!j) return null;
  const byGroup = {};
  for (const r of (j.campaigns_raw || [])) {
    if (!inTimeRange(r.date, timeRange)) continue;
    const grp = mapWindsorCategory(r.category, r.campaign);
    if (!byGroup[grp]) byGroup[grp] = { spend: 0, clicks: 0, impressions: 0, campaigns: {} };
    byGroup[grp].spend += Number(r.spend || 0);
    byGroup[grp].clicks += Number(r.clicks || 0);
    byGroup[grp].impressions += Number(r.impressions || 0);
    if (!byGroup[grp].campaigns[r.campaign]) {
      byGroup[grp].campaigns[r.campaign] = { spend: 0, clicks: 0, impressions: 0 };
    }
    byGroup[grp].campaigns[r.campaign].spend += Number(r.spend || 0);
    byGroup[grp].campaigns[r.campaign].clicks += Number(r.clicks || 0);
    byGroup[grp].campaigns[r.campaign].impressions += Number(r.impressions || 0);
  }
  const totalSpend = Object.values(byGroup).reduce((a, b) => a + b.spend, 0);
  if (group === "ALL") {
    const summary = {};
    for (const [g, v] of Object.entries(byGroup)) {
      summary[g] = {
        spend: Math.round(v.spend),
        clicks: v.clicks,
        impressions: v.impressions,
        cpc: v.clicks > 0 ? Math.round(v.spend / v.clicks) : 0,
        ctr_pct: v.impressions > 0 ? +(v.clicks / v.impressions * 100).toFixed(2) : 0,
      };
    }
    return {
      window_label: timeRange ? (timeRange.start + " -> " + timeRange.end) : "90d (no filter)",
      total_spend: Math.round(totalSpend),
      by_doscom_group: summary,
    };
  }
  const g = byGroup[group] || { spend: 0, clicks: 0, impressions: 0, campaigns: {} };
  const topCamps = Object.entries(g.campaigns)
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 8)
    .map(([name, v]) => ({
      campaign: name,
      spend: Math.round(v.spend),
      clicks: v.clicks,
      impressions: v.impressions,
      cpc: v.clicks > 0 ? Math.round(v.spend / v.clicks) : 0,
      ctr_pct: v.impressions > 0 ? +(v.clicks / v.impressions * 100).toFixed(2) : 0,
    }));
  return {
    window_label: timeRange ? (timeRange.start + " -> " + timeRange.end) : "90d (no filter)",
    group_filter: group,
    group_spend: Math.round(g.spend),
    group_clicks: g.clicks,
    group_impressions: g.impressions,
    group_cpc: g.clicks > 0 ? Math.round(g.spend / g.clicks) : 0,
    group_ctr_pct: g.impressions > 0 ? +(g.clicks / g.impressions * 100).toFixed(2) : 0,
    top_campaigns_in_group: topCamps,
    total_spend_all_groups: Math.round(totalSpend),
  };
}

function compactAds(j, topN, group) {
  if (!j) return null;
  const dict = j.ad_aggregates || {};
  const fmtAgg = j.format_aggregates || {};
  const all = Object.entries(dict).map(([id, v]) => ({
    id,
    ad_name: (v.ad_name || "").slice(0, 40),
    campaign: v.campaign,
    ad_group: v.ad_group_name,
    format: v.ad_format,
    cat: mapWindsorCategory(v.category, v.campaign),
    spend: v.spend_30d || 0,
    clicks: v.clicks_30d || 0,
    impr: v.impressions_30d || 0,
    ctr: v.ctr_30d || 0,
    cpc: v.cpc_30d || 0,
    days: v.active_days_30d || 0,
  }));
  let ads = all;
  let filteredCount = null;
  if (group !== "ALL") {
    ads = all.filter(a => a.cat === group);
    filteredCount = ads.length;
    if (ads.length === 0) ads = all.slice(0, 5);  // fallback
  }
  ads.sort((a, b) => b.spend - a.spend);
  return {
    date_range: j.date_range,
    group_filter: group,
    total_all: all.length,
    total_in_group: filteredCount,
    format_breakdown: { DISPLAY_BANNER: fmtAgg.DISPLAY_BANNER?.count || 0, RSA: fmtAgg.RSA?.count || 0, OTHER: fmtAgg.OTHER?.count || 0 },
    sample: ads.slice(0, topN),
  };
}

function compactPlacement(j, topN, group, perCampaignByName) {
  if (!j) return null;
  const dict = j.placement_aggregates || {};
  const nw = j.network_aggregates || {};
  const all = Object.entries(dict).map(([url, v]) => ({
    url: url.slice(0, 80),
    spend: v.spend_30d || 0,
    clicks: v.clicks_30d || 0,
    impr: v.impressions_30d || 0,
    ctr: v.ctr_30d || 0,
    type: v.placement_type,
    network: v.ad_network_type,
    campaigns: v.campaigns || [],
  }));
  let list = all;
  let filteredCount = null;
  if (group !== "ALL" && perCampaignByName) {
    // Tìm campaigns thuộc nhóm SP từ context.per_campaign
    const groupCampaigns = new Set();
    for (const [name, info] of Object.entries(perCampaignByName)) {
      if (info && info.category === group) groupCampaigns.add(name);
    }
    if (groupCampaigns.size > 0) {
      list = all.filter(p => p.campaigns.some(c => groupCampaigns.has(c)));
      filteredCount = list.length;
      if (list.length === 0) list = all.slice(0, 5);
    }
  }
  list.sort((a, b) => b.spend - a.spend);
  return {
    date_range: j.date_range,
    group_filter: group,
    total_all: all.length,
    total_in_group: filteredCount,
    network_split: { CONTENT: nw.CONTENT?.spend_30d || 0, SEARCH: nw.SEARCH?.spend_30d || 0 },
    top_spend: list.slice(0, topN),
  };
}

function buildSystemPrompt(skills, group, jsonMode) {
  const groupNote = group !== "ALL" ? `\n\n⚠ FOCUS: Chỉ phân tích nhóm SP "${GROUP_LABELS[group]}". Bỏ qua các SP khác.` : "";
  if (jsonMode) {
    return [
      "Bạn là chuyên gia phân tích Google Ads cho Doscom Holdings.",
      "🚨 BẮT BUỘC: Output PHẢI là JSON object hợp lệ. KHÔNG markdown, KHÔNG **bold**, KHÔNG ## heading, KHÔNG text giải thích trước/sau JSON.",
      "🚨 Bắt đầu output bằng dấu { và kết thúc bằng }. Không có ký tự nào khác.",
      "Mọi giá trị string trong JSON dùng tiếng Việt có dấu.",
      "Mọi số liệu DỰA TRÊN DATA trong context — KHÔNG bịa. Thiếu data thì điểm thấp + note 'Thiếu data'.",
      groupNote,
      "",
      "═══ RULE & SKILL ═══",
      skills.join("\n\n"),
    ].join("\n");
  }
  return [
    "Bạn là chuyên gia phân tích Google Ads cho Doscom Holdings.",
    "Trả lời 100% TIẾNG VIỆT có dấu, dùng dấu phẩy ngàn cho số tiền (vd 1,250,000đ).",
    "Phong cách: thẳng thắn, có bảng so sánh, ngắn gọn, không lan man.",
    "Mọi số liệu DỰA TRÊN DATA cụ thể trong context — KHÔNG bịa.",
    "Nếu thiếu data → ghi rõ 'Thiếu dữ liệu'.",
    "Mỗi action đề xuất phải có: cụ thể (làm gì), đo được (đ tiết kiệm/tăng), ưu tiên (cao/trung/thấp).",
    groupNote,
    "",
    "═══ RULE & SKILL ═══",
    skills.join("\n\n"),
  ].join("\n");
}

function buildUserPrompt(mode, question, dataContext, group, timeRange) {
  const parts = [`MODE: ${mode}`, `GROUP FILTER: ${GROUP_LABELS[group]}`];
  if (timeRange && timeRange.start && timeRange.end) {
    parts.push(`⚠ TIME RANGE FOCUS: ${timeRange.label || (timeRange.start + ' → ' + timeRange.end)}`);
    parts.push(`  → CHỈ phân tích spend/revenue/đơn trong khoảng từ ${timeRange.start} đến ${timeRange.end}.`);
    parts.push(`  → Nếu trong context có data ngoài khoảng này, BỎ QUA.`);
  }
  if (question) parts.push(`USER QUESTION: ${question}`);
  parts.push("");
  parts.push("═══ DATA CONTEXT ═══");
  parts.push(JSON.stringify(dataContext, null, 1));
  parts.push("");
  parts.push("═══ OUTPUT FORMAT (markdown) ═══");
  const groupSuffix = group !== "ALL" ? ` cho ${GROUP_LABELS[group]}` : "";
  switch (mode) {
    case "audit_account":
      parts.push(`# Audit Tổng quan${groupSuffix}\n## Tổng điểm /100 — Loại A-F\n## Tóm tắt 1 dòng\n## Top 5 Quick Win (cụ thể, đ tiết kiệm)\n## Cảnh báo nguy hiểm\n## Phân tích 8 nhóm chấm điểm`);
      break;
    case "audit_account_json":
      parts.push(`🎯 BẠN LÀ Sarah — Senior Google Ads Auditor 10 năm kinh nghiệm tại agency US, chuyên audit account Việt Nam. Bạn nổi tiếng vì PHÂN TÍCH TỪNG NHÓM RIÊNG, không bao giờ để score=0 hay copy-paste.

🚨 OUTPUT BẮT BUỘC: 1 JSON object hợp lệ. Bắt đầu bằng { kết thúc bằng }. KHÔNG markdown, KHÔNG heading, KHÔNG text bao quanh.

🚨 BẮT BUỘC chấm 8/8 nhóm với score 1-100. CẤM 0. CẤM > 3 nhóm cùng score.

═══ CHAIN-OF-THOUGHT ═══
Trước khi sinh JSON, mentally trả lời:
1. Tracking: Tổng spend = ? Tổng revenue Pancake = ? Match rate ~ ?% → score
2. Profit: Margin = (Revenue - Cost - VAT - Spend) / Revenue. >30%=80, 0-30%=50, lỗ=20-40
3. Waste: CTR top campaigns? CPC tối đa? Có campaign CPC > 3x trung bình → 30
4. RSA: bao nhiêu ad? mỗi ad bao nhiêu headline? Diversity → score
5. KW Structure: search terms phân tier 1/2/3 ratio? Tier 3 nhiều = lãng phí → 30-50
6. Landing: 50 mặc định + note "cần GA"
7. Budget: spend nhóm cao nhất / tổng. >70% = quá tập trung → 30. <40% mỗi nhóm = cân = 70+
8. Compliance: 70 mặc định nếu không có flag

═══ FEW-SHOT EXAMPLE ═══
INPUT giả định: spend=20M, revenue=50M, group="MAY_DO", CTR avg=2.3%, CPC avg=8K
OUTPUT mẫu (JSON, không markdown):
{"total_score":58,"grade":"C","summary":"Lãi gross 30M (60%) tốt nhưng CTR 2.3% trung bình, có 2 campaign Tier 3 ngốn 25% spend lãng phí","breakdown":{"tracking":{"score":75,"weight":25,"note":"Có conv tracking, match Pancake 85%"},"profit":{"score":80,"weight":22,"note":"Margin 60% tốt, vượt mục tiêu 30%"},"waste":{"score":40,"weight":13,"note":"2 campaign Tier 3 ngốn 25% spend mà 0 đơn"},"rsa":{"score":55,"weight":12,"note":"Có 8 ad, đa số 5 headline, cần thêm USP"},"kw_structure":{"score":50,"weight":10,"note":"Tier 1 chỉ 40% spend, Tier 3 30% — cần tái phân bổ"},"landing":{"score":50,"weight":8,"note":"Cần data GA/heatmap"},"budget":{"score":65,"weight":5,"note":"Phân bổ tạm OK, máy dò 60% spend"},"compliance":{"score":70,"weight":5,"note":"Không có policy flag"}},"top_findings":["Pause 2 campaign Tier 3 lỗ 5M/tháng (CPC 12K, 0 đơn 30d)","Tăng bid Tier 1 từ 8K → 10K (max), dự kiến +10 đơn","Add 5 headline USP cho RSA Camera giấu — boost CTR ước +30%"]}

═══ QUY TẮC ═══
- summary: PHẢI có ít nhất 2 con số cụ thể (đ, %, tên SP/campaign).
- mỗi note ≥ 8 từ, có số liệu cụ thể nếu có data.
- top_findings: 3 finding khác nhau, có action + số tiền + tên kw/campaign.
- Grade: 85+=A, 70-84=B, 55-69=C, 40-54=D, <40=F.
- total_score = round(sum(score×weight)/100). KIỂM TRA lại sau khi tính.
- Nếu thiếu data thật sự → score = 35 (KHÔNG 0) + note "Thiếu data X".

NHẮC LẠI: (1) JSON hợp lệ. (2) 8 nhóm score 1-100. (3) >3 nhóm CẤM cùng score. (4) summary + note + findings có số liệu cụ thể.`);
      break;
    case "audit_keyword":
      parts.push(`# Audit Từ khoá${groupSuffix}\n## Phân bậc Tier 1/2/3 (số kw, % chi)\n## Top 10 từ khoá lỗ\n## Top 10 search term ngon (HARVEST candidates)\n## Top 5 Quick Win`);
      break;
    case "audit_gdn":
      parts.push(`# Audit GDN/PMax${groupSuffix}\n## Tổng điểm 6 nhóm\n## Asset disapproved\n## Placement lãng phí\n## Top 5 Quick Win`);
      break;
    case "audit_headline":
      parts.push(`# Audit Headline${groupSuffix}\n## Tổng điểm 6 nhóm\n## Headline rate Thấp + cliché\n## USP chưa cover\n## Top 5 Quick Win`);
      break;
    case "suggest_keyword": {
      const _groupLabel = GROUP_LABELS[group] || "nhóm hiện tại";
      const _fewShotRows = buildFewShotKeywordRows(group);
      parts.push(`# Đề xuất Từ khoá MỚI${groupSuffix}

🎯 BẠN LÀ Sarah — Senior Google Ads Strategist. Bạn nổi tiếng vì đề xuất KHÔNG đồng đều — mỗi keyword có bid + cơ chế + match RIÊNG dựa trên data.

🚨 RÀNG BUỘC NHÓM SẢN PHẨM (BẮT BUỘC, ƯU TIÊN CAO NHẤT):
- TẤT CẢ 12-15 keyword đề xuất PHẢI thuộc nhóm "${_groupLabel}" (${group}).
- Cột "Ad Group" của TẤT CẢ rows = "${_groupLabel}". KHÔNG được khác nhóm.
- CẤM TUYỆT ĐỐI keyword về sản phẩm khác:
  • Đang làm "Máy dò" → CẤM keyword về máy ghi âm, định vị, camera, chống ghi âm, NOMA
  • Đang làm "Máy ghi âm" → CẤM keyword về máy dò, định vị, camera, chống ghi âm, NOMA
  • Đang làm "Định vị" → CẤM keyword về máy dò, ghi âm, camera, chống ghi âm, NOMA
  • Tương tự cho 8 nhóm — keyword PHẢI liên quan trực tiếp tới SP của nhóm này
- Nếu thấy ví dụ trong few-shot có keyword thuộc nhóm khác → BỎ QUA, chỉ học cấu trúc, KHÔNG copy keyword sai nhóm.
- Hiện tại nhóm = "${_groupLabel}". TẤT CẢ keyword phải xoay quanh chủ đề này.

═══ QUY TẮC BID (CỰC KỲ QUAN TRỌNG) ═══
Doscom hiện max bid = 10,000đ/click. CHỈ keyword "XUẤT SẮC" mới được phá trần lên 10-30K.

⚠ KEYWORD THƯỜNG (90% đề xuất): Bid 3,000 - 10,000đ/click
  - Tier 1 thường: 6,000 - 10,000đ
  - Tier 2: 3,000 - 7,000đ
  - Tier 3 long-tail: 1,000 - 4,000đ

⚠ KEYWORD XUẤT SẮC (chỉ 10% đề xuất, max 3 hàng/15 hàng): Bid 10,000 - 30,000đ
  Điều kiện PHẢI thỏa MỌI:
  1. Có data search_term với conversion thật (>1 đơn 30 ngày qua) HOẶC
  2. Brand keyword (chứa "doscom", "noma") HOẶC
  3. Exact match + intent cực mạnh + LP đã optimize ("máy dò nghe lén giá rẻ chính hãng")
  → BẮT BUỘC ghi rõ trong "Lý do" tại sao xuất sắc + đính kèm số liệu

CẤM bid > 30,000đ tuyệt đối.
CẤM bid đồng đều (mọi keyword cùng số).

═══ QUY TẮC MATCH ═══
- Broad: tỉ lệ ~30% đề xuất, kw rộng intent yếu
- Phrase: ~40%, kw có cụm cố định
- Exact: ~30%, intent mạnh + chuyển đổi cao

═══ QUY TẮC CƠ CHẾ (đa dạng) ═══
1. HARVEST — search term đã có conversion, ưu tiên cao
2. REPLACE DYING — kw cũ CTR thấp, đề xuất kw mới thay
3. LONG-TAIL — biến thể dài, ngách hẹp, CPC rẻ
4. COMPETITOR FLAG — kw đối thủ chạy mà mình chưa có
5. SEASONAL — kw theo mùa (Tết, hè, lễ)

15 hàng PHẢI mix ít nhất 4/5 cơ chế (mỗi cơ chế ≥ 2 hàng).

═══ QUY TẮC ƯỚC LƯỢNG LƯỢT TÌM KIẾM/THÁNG ═══
Dựa vào data impressions/clicks hiện có trong search_terms + kiến thức thị trường Việt Nam:
- Keyword rộng phổ biến (camera, máy dò): 5,000 - 50,000 lượt/tháng
- Keyword trung bình (camera giấu, ghi âm mini): 1,000 - 10,000 lượt/tháng
- Keyword long-tail ngách (thiết bị dò camera ẩn trong khách sạn): 100 - 1,000 lượt/tháng
- Brand keyword (doscom, noma 911): 500 - 5,000 lượt/tháng
Nếu có data impressions từ search term → ước lượng dựa trên tỷ lệ impression share (~10-30% thị phần) → volume = impressions / share × 30.
Nếu không có data → ước lượng bằng kiến thức thị trường. Ghi rõ nguồn ước tính.

═══ QUY TẮC ƯỚC LƯỢNG CLICK DỰ KIẾN/THÁNG ═══
Click dự kiến = Lượt tìm/tháng × CTR ước tính × Impression Share (IS) ước tính.

CTR ước tính theo match type + bid tier:
- Exact + bid 6-10K: CTR 5-8% (intent rõ, ad relevant cao)
- Exact + bid 10-30K (XUẤT SẮC): CTR 8-12% (top-1 position)
- Phrase + bid 5-10K: CTR 3-5%
- Phrase + bid <5K: CTR 1.5-3%
- Broad + bid 3-7K: CTR 1-2%
- Long-tail (Phrase/Exact, low competition): CTR 5-10% (ít cạnh tranh)
- Brand keyword: CTR 10-20% (tự nhiên cao)

Impression Share (IS) ước tính theo bid:
- Bid <50% trung bình thị trường (3-5K cho kw thường): IS 10-25%
- Bid bằng thị trường (6-10K): IS 30-50%
- Bid XUẤT SẮC (>10K, top position): IS 60-85%

CÔNG THỨC: Click/tháng = Lượt tìm × CTR × IS (làm tròn).
VÍ DỤ CÔNG THỨC (chỉ minh họa cách tính, KHÔNG phải gợi ý keyword):
- (Phrase, 9K): 8,100 × 4% × 35% ≈ 113 click/tháng
- (Exact long-tail, 4K): 320 × 7% × 20% ≈ 4 click/tháng
- (Exact brand XUẤT SẮC, 18K): 2,800 × 15% × 75% ≈ 315 click/tháng

LƯU Ý: Nếu IS × CTR × Volume < 1 → ghi "<1" (không round 0).

═══ FEW-SHOT EXAMPLE — TẤT CẢ ĐỀU NHÓM "${_groupLabel}" (output thực phải 12-15 dòng cùng nhóm này, KHÔNG copy keyword mà học cấu trúc) ═══
${_fewShotRows}

═══ FORMAT OUTPUT (BẮT BUỘC) ═══
Trả về CHÍNH XÁC 1 (MỘT) bảng markdown duy nhất với 12-15 hàng.
KHÔNG tách thành nhiều bảng nhỏ. KHÔNG thêm heading/tiêu đề trước hoặc giữa bảng.
KHÔNG viết câu giới thiệu trước bảng. Bảng phải bắt đầu NGAY ở hàng đầu tiên của output.
Cột # đánh số liên tục 1, 2, 3, ..., 15 (không reset).

Cấu trúc bảng (header + separator + 12-15 data rows):
| # | Cơ chế | Action | Ad Group | Keyword mới | Match | Bid (CPC) | Lượt tìm/tháng | Click dự kiến/tháng | Lý do | Tăng đơn dự kiến |
|---|--------|--------|----------|-------------|-------|-----------|----------------|---------------------|-------|------------------|
| 1 | HARVEST | Add | ... | ... | Phrase | 9,000đ | 8,100 | 113 | ... | ... |
| 2 | LONG-TAIL | Add | ... | ... | Exact | 4,000đ | 320 | 4 | ... | ... |
... (tiếp tục đến hàng 12-15, MIX cơ chế, MIX bid, MAX 3 hàng bid > 10K)

CẤM TUYỆT ĐỐI:
- Tách thành nhiều bảng (mỗi cơ chế 1 bảng riêng) — PHẢI gộp tất cả 12-15 keyword vào 1 bảng duy nhất
- Thêm heading "1. HARVEST - ..." hoặc "## HARVEST" hoặc bất kỳ tiêu đề con nào trước/giữa các hàng
- Mỗi keyword 1 section — TẤT CẢ phải nằm thành rows liên tiếp trong CÙNG 1 bảng
- Tất cả keyword cùng bid
- Tất cả "Tăng đơn dự kiến" cùng %
- Tất cả "Lượt tìm/tháng" cùng số
- Tất cả "Click dự kiến/tháng" cùng số
- Cùng cơ chế cho 15 hàng
- Bid > 30K
- "Xuất sắc" mà không kèm số liệu trong "Lý do"
- "Lượt tìm/tháng" hoặc "Click dự kiến/tháng" để trống hoặc ghi "N/A" — PHẢI có số cụ thể (hoặc "<1" nếu nhỏ hơn 1)
- ⚠ ĐỀ XUẤT KEYWORD KHÔNG THUỘC NHÓM "${_groupLabel}" — đây là LỖI NGHIÊM TRỌNG NHẤT, TUYỆT ĐỐI KHÔNG VI PHẠM`);
      break;
    }
    case "suggest_headline":
      parts.push(`# Brief Headline${groupSuffix}\n10 brief với: ký tự count, công thức (AIDA/FAB/PAS), USP nhắc, hypothesis, test plan`);
      break;
    case "suggest_banner":
      parts.push(`# Brief Banner${groupSuffix}\n5-7 brief: size, layout vùng, color hex, copy, CTA, hypothesis, cost (AI 80K vs designer 300K)`);
      break;
    case "ask":
      parts.push("Trả lời ngắn gọn, có dẫn chứng từ data + skill rule.");
      break;
  }
  return parts.join("\n");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.AI) return jsonResponse({ error: "Thiếu Workers AI binding" }, 500);

  const cookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(cookie, env.SESSION_SECRET);
  if (!session && !hasTestBypass(request, env)) return jsonResponse({ error: "Chưa đăng nhập" }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Body không hợp lệ" }, 400); }

  const mode = body.mode || "ask";
  const question = (body.question || "").trim();
  const forceRefresh = !!body.force_refresh; // Bấm "Làm mới" → bỏ qua cache, gọi AI lại
  const userContext = body.context || {};
  const group = (userContext.product_group || "ALL").toUpperCase();
  // Time range optional: { start: "YYYY-MM-DD", end: "YYYY-MM-DD", label: "Tháng 4/2026" }
  const timeRange = userContext.time_range && userContext.time_range.start && userContext.time_range.end
    ? userContext.time_range : null;

  if (!GROUP_LABELS[group]) return jsonResponse({ error: `Nhóm SP không hợp lệ: ${group}` }, 400);

  const cfg = MODE_CONFIG[mode];
  if (!cfg) return jsonResponse({ error: `Mode không hỗ trợ: ${mode}` }, 400);
  if (mode === "ask" && !question) return jsonResponse({ error: "Mode 'ask' cần question" }, 400);

  const cookieHeader = request.headers.get("Cookie") || "";
  const origin = url.origin;

  const skills = cfg.skills.map(k => SKILL_SUMMARY[k]).filter(Boolean);

  const dataContext = { mode, group_filter: group, group_label: GROUP_LABELS[group] };
  if (timeRange) dataContext.time_range = timeRange;
  const tasks = [];
  if (cfg.data.includes("context")) tasks.push(fetchJson(origin, "/data/google-ads-context.json", cookieHeader).then(j => { if (j) dataContext.context = { date_range: j.date_range, total_campaigns: (j.campaigns_raw || []).length }; }));
  if (cfg.data.includes("spend")) tasks.push(fetchJson(origin, "/data/google-ads-spend.json", cookieHeader).then(j => dataContext.spend = compactSpend(j, group, timeRange)));
  if (cfg.data.includes("revenue")) tasks.push(fetchJson(origin, "/data/product-revenue.json", cookieHeader).then(j => dataContext.revenue = compactRevenue(j, group, timeRange)));
  if (cfg.data.includes("search_terms")) tasks.push(fetchJson(origin, "/data/google-ads-search-terms.json", cookieHeader).then(j => dataContext.search_terms = compactSearchTerms(j, 30, group)));
  if (cfg.data.includes("ads")) tasks.push(fetchJson(origin, "/data/google-ads-ads.json", cookieHeader).then(j => dataContext.ads = compactAds(j, 15, group)));
  let _perCampaignFromCtx = null;
  if (cfg.data.includes("placement")) {
    // Placement filter cần per_campaign từ context — fetch trước
    const ctxJson = await fetchJson(origin, "/data/google-ads-context.json", cookieHeader);
    if (ctxJson) _perCampaignFromCtx = ctxJson.per_campaign || null;
    tasks.push(fetchJson(origin, "/data/google-ads-placement.json", cookieHeader).then(j => dataContext.placement = compactPlacement(j, 15, group, _perCampaignFromCtx)));
  }
  if (cfg.data.includes("inventory") && env.INVENTORY) tasks.push(fetchInventoryCompact(env, group).then(items => dataContext.inventory = items));

  await Promise.all(tasks);
  const systemPrompt = buildSystemPrompt(skills, group, !!cfg.json_output);
  const userPrompt = buildUserPrompt(mode, question, dataContext, group, timeRange);

  // ── Cache KV cho suggest modes (24h, cùng ngày = cùng kết quả) ──
  const isSuggest = SUGGEST_MODES.has(mode);
  const todayVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const cacheKey = isSuggest ? `cache:${CACHE_VERSION}:${mode}:${group}:${todayVN}` : null;

  if (isSuggest && !forceRefresh && env.INVENTORY) {
    try {
      const cached = await env.INVENTORY.get(cacheKey, { type: "json" });
      if (cached && cached.response) {
        return jsonResponse({
          ok: true,
          mode,
          group,
          group_label: GROUP_LABELS[group],
          model: cfg.model,
          response: cached.response,
          parsed_json: cached.parsed_json || null,
          skills_used: cfg.skills,
          data_used: cfg.data,
          cached: true,
          cached_at: cached.cached_at,
          cache_note: `Kết quả đã lưu từ ${cached.cached_at}. Bấm "Làm mới" để tạo đề xuất mới.`,
          _enrichment: cached.enrichment || null,
        });
      }
    } catch { /* KV read fail → tiếp tục gọi AI */ }
  }

  // ── Stage B: Enrich candidates với Google Suggest + Trends + own data ──
  // Chỉ apply cho suggest_keyword. Các mode khác bỏ qua.
  let enrichedData = null;
  if (mode === "suggest_keyword" && SEED_KEYWORDS[group]) {
    const seeds = SEED_KEYWORDS[group].map(s => s.kw).slice(0, 5);
    try {
      enrichedData = await buildEnrichedCandidates(seeds, dataContext.search_terms || []);
    } catch { enrichedData = null; }
  }

  let aiResult;
  try {
    // Suggest modes: temperature=0 → deterministic (cùng data = cùng kết quả)
    // Audit modes: temperature=0.1-0.3 → cho phép biến đổi nhẹ
    const temperature = isSuggest ? 0 : (cfg.json_output ? 0.1 : 0.3);

    // Augment userPrompt với enriched candidates (nếu có)
    let finalUserPrompt = userPrompt;
    if (enrichedData && enrichedData.candidates.length > 0) {
      const candidatesBlock = enrichedData.candidates.map((c, i) => {
        const vol = c.volume != null ? c.volume.toLocaleString("en-US") : "?";
        const trend = c.trendsScore != null ? `, trends=${c.trendsScore}/100` : "";
        return `${i + 1}. "${c.keyword}" — vol≈${vol} (${c.source}, ${c.confidence})${trend}`;
      }).join("\n");
      const anchorInfo = enrichedData.anchor
        ? `Anchor: "${enrichedData.anchor.keyword}" vol=${enrichedData.anchor.volume.toLocaleString("en-US")} score=${enrichedData.anchor.score}`
        : "Anchor: không tìm được";
      finalUserPrompt = userPrompt + `

═══ CANDIDATES TỪ GOOGLE SUGGEST + TRENDS (data thật, ưu tiên dùng) ═══
${anchorInfo}
Trends API: ${enrichedData.trendsAttempted ? "OK" : "fallback"}
Số candidate: ${enrichedData.candidates.length}

${candidatesBlock}

🎯 BẮT BUỘC: Chọn 12-15 keyword TỪ LIST TRÊN (ưu tiên confidence=high trước, sau đó medium).
   Cột "Lượt tìm/tháng" trong bảng PHẢI lấy số "vol" tương ứng ở list này — KHÔNG tự đoán.
   Nếu list không đủ 12 keyword → bổ sung thêm bằng kiến thức + ghi rõ trong "Lý do" là "ước lượng".`;
    }

    const aiParams = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: finalUserPrompt },
      ],
      temperature,
      max_tokens: cfg.json_output ? 1500 : 2500,
    };
    // NOTE: bỏ response_format vì Llama 3.1 8B Fast trên Cloudflare Workers AI
    // có thể không support hoặc throw exception. Prompt đã đủ chặt + parser robust.
    // if (cfg.json_output) aiParams.response_format = { type: "json_object" };
    aiResult = await env.AI.run(cfg.model, aiParams);
  } catch (e) {
    return jsonResponse({ error: "Lỗi gọi Workers AI: " + e.message }, 502);
  }

  let rawResp = aiResult.response || aiResult.result || "";
  // Post-process: gộp nhiều bảng nhỏ thành 1 bảng + remove heading (chỉ áp dụng suggest_keyword)
  let _debugMerge = null;
  if (mode === "suggest_keyword" && rawResp) {
    const _before = rawResp;
    rawResp = mergeKeywordTables(rawResp);
    _debugMerge = {
      merge_applied: true,
      raw_chars: _before.length,
      raw_separators: (_before.match(/^\|[\s\-|:]+\|$/gm) || []).length,
      raw_data_rows: (_before.match(/^\|\s*\d+\s*\|/gm) || []).length,
      final_chars: rawResp.length,
      final_separators: (rawResp.match(/^\|[\s\-|:]+\|$/gm) || []).length,
      final_data_rows: (rawResp.match(/^\|\s*\d+\s*\|/gm) || []).length,
    };
  }
  let parsedJson = null;
  if (cfg.json_output && rawResp) {
    // Strategy: thử nhiều cách parse JSON từ AI output
    let cleaned = String(rawResp).trim();

    // Bước 1: Bỏ code fence nếu có
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (fenced) cleaned = fenced[1].trim();

    // Bước 2: Tìm JSON object {...} balanced đầu tiên
    function extractJsonObject(s) {
      const start = s.indexOf("{");
      if (start === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      }
      return null;
    }
    const jsonStr = extractJsonObject(cleaned) || cleaned;

    try {
      parsedJson = JSON.parse(jsonStr);
    } catch (e) {
      // Fallback: thử parse cleaned trực tiếp
      try {
        parsedJson = JSON.parse(cleaned);
      } catch (e2) {
        parsedJson = {
          _parse_error: e.message,
          _raw_excerpt: rawResp.slice(0, 500),
          _attempted: jsonStr.slice(0, 300),
        };
      }
    }

    // === B: Validation — fix AI lười (score=0, bỏ qua nhóm) ===
    if (parsedJson && !parsedJson._parse_error && mode === "audit_account_json") {
      const REQUIRED_KEYS = ["tracking", "profit", "waste", "rsa", "kw_structure", "landing", "budget", "compliance"];
      const WEIGHTS = { tracking: 25, profit: 22, waste: 13, rsa: 12, kw_structure: 10, landing: 8, budget: 5, compliance: 5 };
      if (!parsedJson.breakdown) parsedJson.breakdown = {};
      let fixed_count = 0;
      const scoreCounts = {};
      for (const key of REQUIRED_KEYS) {
        if (!parsedJson.breakdown[key]) parsedJson.breakdown[key] = {};
        const item = parsedJson.breakdown[key];
        const score = Number(item.score) || 0;
        if (score < 1) {
          item.score = 35;
          item.note = (item.note || "") + " [Auto-fix: AI để score=0, đặt mặc định 35]";
          fixed_count++;
        } else if (score > 100) {
          item.score = 100;
        }
        item.weight = WEIGHTS[key];
        scoreCounts[item.score] = (scoreCounts[item.score] || 0) + 1;
      }
      // Detect lười: > 3 nhóm cùng score
      const lazyScore = Object.entries(scoreCounts).find(([s, n]) => n > 3);
      if (lazyScore) {
        parsedJson._lazy_warning = `⚠ AI có thể lười: ${lazyScore[1]}/8 nhóm cùng score=${lazyScore[0]}. Bấm 'Chấm lại' để có kết quả chi tiết hơn.`;
      }
      // Detect note rỗng/quá ngắn (< 8 ký tự)
      let emptyNotes = 0;
      for (const key of REQUIRED_KEYS) {
        const note = String(parsedJson.breakdown[key].note || "").trim();
        if (note.length < 8) emptyNotes++;
      }
      if (emptyNotes >= 4) {
        parsedJson._lazy_warning = (parsedJson._lazy_warning || "") + ` ${emptyNotes}/8 note rỗng — AI không phân tích sâu.`;
      }
      // Recalc total_score
      let total = 0;
      for (const key of REQUIRED_KEYS) {
        total += parsedJson.breakdown[key].score * WEIGHTS[key];
      }
      parsedJson.total_score = Math.round(total / 100);
      // Recalc grade
      const t = parsedJson.total_score;
      parsedJson.grade = t >= 85 ? "A" : t >= 70 ? "B" : t >= 55 ? "C" : t >= 40 ? "D" : "F";
      if (fixed_count > 0) {
        parsedJson._validation_note = `Đã auto-fix ${fixed_count}/8 nhóm bị AI để score=0. Total + grade đã recalc.`;
      }
    }
  }

  // ── Lưu cache KV cho suggest modes ──
  if (isSuggest && cacheKey && env.INVENTORY && rawResp) {
    const nowVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    try {
      await env.INVENTORY.put(cacheKey, JSON.stringify({
        response: rawResp,
        parsed_json: parsedJson,
        cached_at: nowVN,
        enrichment: enrichedData ? {
          candidates_count: enrichedData.candidates.length,
          anchor: enrichedData.anchor || null,
          trends_attempted: enrichedData.trendsAttempted,
          sample_top5: enrichedData.candidates.slice(0, 5).map(c => ({
            keyword: c.keyword, volume: c.volume, source: c.source, confidence: c.confidence,
          })),
        } : null,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* KV write fail → không sao, lần sau gọi AI lại */ }
  }

  return jsonResponse({
    ok: true,
    mode,
    group,
    group_label: GROUP_LABELS[group],
    model: cfg.model,
    response: rawResp,
    parsed_json: parsedJson,
    skills_used: cfg.skills,
    data_used: cfg.data,
    cached: false,
    _debug_merge: _debugMerge,
    _enrichment: enrichedData ? {
      candidates_count: enrichedData.candidates.length,
      anchor: enrichedData.anchor || null,
      trends_attempted: enrichedData.trendsAttempted,
      sample_top5: enrichedData.candidates.slice(0, 5).map(c => ({
        keyword: c.keyword,
        volume: c.volume,
        source: c.source,
        confidence: c.confidence,
      })),
    } : null,
  });
}

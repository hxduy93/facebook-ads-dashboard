// Brand detection cho Doscom + NOMA trong AI response.
// Detect:
//   - mentioned (boolean): brand có được nhắc đến không
//   - position (1-5): vị trí xuất hiện đầu tiên (1 = đầu response = quan trọng nhất)
//   - sentiment (positive/neutral/negative): qua keyword đơn giản trong context ±100 chars
//   - brand_url_cited: AI có cite URL của brand không
//   - competitor_mentions: dict competitor → số lần nhắc

// Doscom SKU patterns — match cả tên brand + product codes
const DOSCOM_PATTERNS = [
  /\bdoscom\b/gi,
  // Camera: DA1, DA1 Pro Wifi, DA3.1, DA3.1 Pro, DA8.1 Pro Zoom X6, DA1 Pro 4G...
  /\bda\d+(\.\d+)?(\s*pro)?(\s*(wifi|4g|zoom\s*x?\d+))?\b/gi,
  // Máy dò: D1, D1 Pro, D8 Pro, D9
  /\bd\d+(\s*pro)?\b/gi,
  // Máy dò phi tuyến: DP1, DP2
  /\bdp[12]\b/gi,
  // Chống ghi âm: DI1, DI1 Pro, DI1 Plus, DI7...
  /\bdi\d+(\s*(pro|plus))?\b/gi,
  // Máy ghi âm: DR1, DR4 Pro, DR4 Plus, DR7 Pro...
  /\bdr\d+(\s*(pro|plus))?\b/gi,
  // Định vị: DV1, DV1.1, DV1 Mini, DV1 Pro...
  /\bdv\d+(\.\d+)?(\s*(mini|pro))?\b/gi,
  // Thẻ định vị: DT1-DT5
  /\bdt[1-5]\b/gi,
  // Chuông cửa: DE1, DE3
  /\bde[13]\b/gi,
];

// NOMA patterns — brand name + 8 SKU
const NOMA_PATTERNS = [
  /\bnoma\b/gi,
  /\bnoma\s*(911|620|250|922|890|310|955|692)\b/gi,
];

// Brand-owned domains
const BRAND_DOMAINS = ["doscom.vn", "noma-autocare.vn", "noma.vn"];

// Competitors to track
const COMPETITORS = [
  // Doscom competitors (security/surveillance)
  "aquarius", "spyfinder", "k18", "k68",
  "imou", "ezviz", "tp-link", "tapo", "yi camera",
  "sony recorder", "olympus",
  // NOMA competitors (auto care)
  "3m", "meguiar", "turtle wax", "chemical guys",
  "sonax", "soft99", "liqui moly",
];

const POSITIVE_WORDS = [
  "tốt", "hiệu quả", "chất lượng", "uy tín", "đáng tin",
  "khuyến nghị", "recommend", "best", "tin cậy", "chính hãng",
];

const NEGATIVE_WORDS = [
  "kém", "tệ", "không tốt", "lỗi", "hỏng",
  "không nên", "tránh", "bad", "poor", "lừa đảo",
];

export function detectMentions(engineResponse) {
  const text = engineResponse?.response_text || "";
  const citations = engineResponse?.citations || [];

  const doscomIdx = findFirstMatchIndex(text, DOSCOM_PATTERNS);
  const nomaIdx   = findFirstMatchIndex(text, NOMA_PATTERNS);

  const doscomMentioned = doscomIdx >= 0;
  const nomaMentioned   = nomaIdx >= 0;

  const brandUrlCited = citations.some(c =>
    BRAND_DOMAINS.some(d => (c?.url || "").toLowerCase().includes(d))
  );

  const competitorMentions = {};
  for (const comp of COMPETITORS) {
    const escaped = comp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    const matches = text.match(re);
    if (matches?.length) competitorMentions[comp] = matches.length;
  }

  return {
    doscom_mentioned: doscomMentioned,
    doscom_position:  doscomMentioned ? rankPosition(doscomIdx, text.length) : 999,
    doscom_sentiment: doscomMentioned ? detectSentiment(text, doscomIdx)     : null,
    noma_mentioned:   nomaMentioned,
    noma_position:    nomaMentioned   ? rankPosition(nomaIdx, text.length)   : 999,
    noma_sentiment:   nomaMentioned   ? detectSentiment(text, nomaIdx)       : null,
    brand_url_cited:  brandUrlCited,
    competitor_mentions: competitorMentions,
  };
}

function findFirstMatchIndex(text, patterns) {
  let first = -1;
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m && (first === -1 || m.index < first)) first = m.index;
  }
  return first;
}

// 1-5 buckets theo vị trí xuất hiện trong response
// (1 = nhắc trong 20% đầu = top-of-mind, 5 = cuối response)
function rankPosition(index, totalLength) {
  if (totalLength === 0) return 999;
  const ratio = index / totalLength;
  if (ratio < 0.2) return 1;
  if (ratio < 0.4) return 2;
  if (ratio < 0.6) return 3;
  if (ratio < 0.8) return 4;
  return 5;
}

function detectSentiment(text, idx) {
  const start = Math.max(0, idx - 100);
  const end   = Math.min(text.length, idx + 100);
  const ctx   = text.slice(start, end).toLowerCase();
  const pos   = POSITIVE_WORDS.filter(w => ctx.includes(w)).length;
  const neg   = NEGATIVE_WORDS.filter(w => ctx.includes(w)).length;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

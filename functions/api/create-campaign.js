/**
 * Cloudflare Pages Function: POST /api/create-campaign
 * -----------------------------------------------------
 * Full end-to-end campaign creation from the dashboard form.
 *
 * Request (multipart/form-data):
 *   - config         JSON string (campaign + adset + ads metadata)
 *   - video_0, video_1, ...   Video files (one per ad that has a video)
 *   - image_0, image_1, ...   Image files (one per ad that has an image)
 *
 * Creates, in order:
 *   1. Uploads videos/images to the ad account (per ad)
 *   2. Campaign (PAUSED)
 *   3. AdSet   (PAUSED, with promoted_object + targeting)
 *   4. AdCreative + Ad (PAUSED) for each ad in config.ads
 *
 * Response: { success, campaign_id, adset_id, ads:[{ad_id,creative_id,video_id|image_hash}], ads_manager_url }
 * On error: { success: false, step, error, partial:{...} } — partial so caller can clean up.
 *
 * Env: FB_ACCESS_TOKEN (Meta Marketing API, scopes ads_management + pages_manage_ads + business_management)
 */

const FB_API_VERSION = "v20.0";
const GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

// ───────────────────────── helpers ─────────────────────────

async function fbGet(endpoint, params, token) {
  const qs = new URLSearchParams(params || {});
  qs.append("access_token", token);
  const r = await fetch(`${GRAPH}${endpoint}?${qs}`, { signal: AbortSignal.timeout(30000) });
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON response (status ${r.status})` } }));
  if (!r.ok || data.error) {
    throw new Error((data.error && data.error.message) || `HTTP ${r.status}`);
  }
  return data;
}

async function fbPost(endpoint, body, token) {
  // body can be FormData (for file uploads) or URLSearchParams / object
  let init;
  if (body instanceof FormData) {
    body.append("access_token", token);
    init = { method: "POST", body };
  } else {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      params.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    params.append("access_token", token);
    init = {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    };
  }
  const r = await fetch(`${GRAPH}${endpoint}`, { ...init, signal: AbortSignal.timeout(60000) });
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON response (status ${r.status})` } }));
  if (!r.ok || data.error) {
    const msg = (data.error && data.error.error_user_msg) || (data.error && data.error.message) || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// Derive the promoted_object for OFFSITE_CONVERSIONS/SALES campaigns
function buildPromotedObject(cfg) {
  if (!cfg.pixel_id) return null;
  // Event type inference — user can override via config.promoted_event
  let evt = cfg.promoted_event;
  if (!evt) {
    if (cfg.optimization_goal === "OFFSITE_CONVERSIONS") {
      evt = cfg.objective === "OUTCOME_SALES" ? "PURCHASE" : "COMPLETE_REGISTRATION";
    } else if (cfg.optimization_goal === "VALUE") {
      evt = "PURCHASE";
    }
  }
  const po = { pixel_id: cfg.pixel_id };
  if (evt) po.custom_event_type = evt;
  return po;
}

// Default targeting — Vietnam 18-65, all genders
function buildTargeting(cfg) {
  return cfg.targeting || {
    geo_locations: { countries: ["VN"] },
    age_min: 18,
    age_max: 65,
  };
}

// Normalize any date-ish string → Meta-compatible ISO with VN timezone (+07:00).
// Accepts: "2026-04-17" (date only) | "2026-04-17T10:30" (datetime-local)
//        | "2026-04-17T10:30:00" (no tz) | full ISO with tz (pass through)
function toMetaDatetime(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (s.length === 10) return `${s}T00:00:00+07:00`;      // date only → midnight VN
  if (s.length === 16) return `${s}:00+07:00`;             // datetime-local → add seconds+tz
  if (s.length === 19 && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return `${s}+07:00`;
  return s;                                                 // already has tz
}

// Upload a video file to the ad account. Returns video_id.
async function uploadVideo(accountId, file, token) {
  const fd = new FormData();
  fd.append("source", file, file.name);
  const data = await fbPost(`/act_${accountId}/advideos`, fd, token);
  return data.id;
}

// Poll video processing status — FB cần video.status.video_status = "ready"
// trước khi dùng trong ad creative, nếu không sẽ trả error
// "Hệ thống vẫn đang xử lý video này".
// Video 18MB thường ready trong 15-45s. Poll mỗi 3s, max 90s.
async function waitForVideoReady(videoId, token, maxWaitMs = 90000, pollIntervalMs = 3000) {
  const start = Date.now();
  let lastStatus = "unknown";
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fbGet(`/${videoId}`, { fields: "status" }, token);
      const status = data.status || {};
      const vs = status.video_status || status.processing_progress || "unknown";
      lastStatus = vs;
      if (vs === "ready") return true;
      if (vs === "error") {
        throw new Error(`FB báo video lỗi xử lý: ${JSON.stringify(status)}`);
      }
      // Còn "processing" → tiếp tục poll
    } catch (e) {
      // Lỗi tạm thời (vd 404 vì video chưa kịp index) → tiếp tục poll
      if (String(e.message).includes("FB báo video lỗi")) throw e;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Video chưa ready sau ${maxWaitMs/1000}s (status cuối: ${lastStatus}). Thử lại sau 1-2 phút hoặc nén video xuống < 10MB.`);
}

// Wait for Meta to generate thumbnails after video upload, then return a URL.
// Meta takes 5–30s to auto-generate thumbnails depending on video length.
async function waitForVideoThumbnail(videoId, token, maxWaitMs = 25000, pollIntervalMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fbGet(`/${videoId}/thumbnails`, { fields: "uri,is_preferred" }, token);
      const list = (data && data.data) || [];
      if (list.length > 0) {
        const preferred = list.find((t) => t.is_preferred) || list[0];
        if (preferred && preferred.uri) return preferred.uri;
      }
    } catch (e) {
      // Ignore transient errors while video is still processing
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error("Thumbnail chưa sinh xong sau 25s — video có thể quá lớn. Thử upload video ngắn hơn (< 1 phút) hoặc nén lại.");
}

// Upload an image file. Returns image_hash.
async function uploadImage(accountId, file, token) {
  const fd = new FormData();
  fd.append("filename", file, file.name);
  const data = await fbPost(`/act_${accountId}/adimages`, fd, token);
  const images = data.images || {};
  const first = images[Object.keys(images)[0]];
  if (!first || !first.hash) throw new Error("Image upload succeeded but no hash returned");
  return first.hash;
}

// Build object_story_spec for creative based on media type & destination
// NOTE: Link đích (ad.link) được GIỮ NGUYÊN. UTM params được gửi riêng qua
// adcreative.url_tags (set trong onRequestPost bên dưới) — Meta tự append vào
// mọi click URL. Tương đương field "Thông số URL" trong Ads Manager UI.
function buildStorySpec({ pageId, ad, videoId, videoThumbnailUrl, imageHash, destinationType }) {
  const cta = { type: ad.cta || "LEARN_MORE", value: {} };
  if (ad.link) cta.value.link = ad.link;

  if (videoId) {
    if (!videoThumbnailUrl) {
      throw new Error("Thumbnail required for video ad — waitForVideoThumbnail() failed");
    }
    return {
      page_id: pageId,
      video_data: {
        video_id: videoId,
        image_url: videoThumbnailUrl, // REQUIRED by Meta — auto-generated after upload
        message: ad.ad_copy || "",
        title: ad.headline || "",
        call_to_action: cta,
        link_description: ad.description || "",
      },
    };
  }
  if (imageHash) {
    return {
      page_id: pageId,
      link_data: {
        image_hash: imageHash,
        link: ad.link || "https://doscom.vn",
        message: ad.ad_copy || "",
        name: ad.headline || "",
        description: ad.description || "",
        call_to_action: cta,
      },
    };
  }
  throw new Error("Ad must have either a video or image");
}

// ───────────────────────── main handler ─────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.FB_ACCESS_TOKEN;

  if (!token) {
    return json({ success: false, step: "init", error: "FB_ACCESS_TOKEN not configured on Cloudflare env" }, 500);
  }

  let cfg;
  const filesByAd = {}; // { 0: { video: File, image: File }, 1: {...} }
  try {
    const form = await request.formData();
    const configStr = form.get("config");
    if (!configStr) throw new Error("Missing 'config' field in form data");
    cfg = JSON.parse(configStr);

    // Collect video/image files per ad index
    for (const [key, val] of form.entries()) {
      const mv = key.match(/^video_(\d+)$/);
      const mi = key.match(/^image_(\d+)$/);
      if (mv && val instanceof File && val.size > 0) {
        const idx = parseInt(mv[1], 10);
        (filesByAd[idx] = filesByAd[idx] || {}).video = val;
      } else if (mi && val instanceof File && val.size > 0) {
        const idx = parseInt(mi[1], 10);
        (filesByAd[idx] = filesByAd[idx] || {}).image = val;
      }
    }
  } catch (e) {
    return json({ success: false, step: "parse_form", error: String(e.message || e) }, 400);
  }

  // Validate required fields
  const required = ["account_id", "page_id", "objective", "optimization_goal", "billing_event"];
  for (const f of required) {
    if (!cfg[f]) return json({ success: false, step: "validate", error: `Missing field: ${f}` }, 400);
  }
  if (!Array.isArray(cfg.ads) || cfg.ads.length === 0) {
    return json({ success: false, step: "validate", error: "config.ads must be a non-empty array" }, 400);
  }

  const accountIdRaw = String(cfg.account_id).replace(/^act_/, "");
  const partial = {};

  try {
    // ── Step 1: Upload all media ────────────────────────────────
    const uploaded = {}; // idx → { video_id?, image_hash? }
    for (let i = 0; i < cfg.ads.length; i++) {
      const files = filesByAd[i] || {};
      uploaded[i] = {};
      if (files.video) {
        uploaded[i].video_id = await uploadVideo(accountIdRaw, files.video, token);
      } else if (files.image) {
        uploaded[i].image_hash = await uploadImage(accountIdRaw, files.image, token);
      } else {
        throw new Error(`Ad #${i + 1} thiếu video hoặc ảnh`);
      }
    }
    partial.uploaded = uploaded;

    // ── Step 2: Create Campaign ─────────────────────────────────
    // Budget level: "campaign" (CBO) → budget on campaign, adset inherits.
    //               "adset"    (ABO) → budget on adset (default).
    // launch_status: "ACTIVE" starts running immediately, "PAUSED" for review
    const launchStatus = cfg.launch_status === "ACTIVE" ? "ACTIVE" : "PAUSED";
    const isCBO = cfg.budget_level === "campaign";
    const campaignBody = {
      name: cfg.campaign_name || `${cfg.objective}-${Date.now()}`,
      objective: cfg.objective,
      status: launchStatus,
      buying_type: cfg.buying_type || "AUCTION",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: isCBO,
    };
    if (isCBO) {
      if (cfg.budget_type === "lifetime") {
        campaignBody.lifetime_budget = cfg.budget_amount;
      } else {
        campaignBody.daily_budget = cfg.budget_amount;
      }
      // CBO requires a bid_strategy on campaign too
      campaignBody.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
    }
    const campRes = await fbPost(`/act_${accountIdRaw}/campaigns`, campaignBody, token);
    partial.campaign_id = campRes.id;

    // ── Step 3: Create AdSet ────────────────────────────────────
    const adsetBody = {
      name: cfg.adset_name || cfg.campaign_name,
      campaign_id: partial.campaign_id,
      optimization_goal: cfg.optimization_goal,
      billing_event: cfg.billing_event,
      status: launchStatus,
      destination_type: cfg.destination_type || "WEBSITE",
      targeting: buildTargeting(cfg),
    };
    // Budget on adset only when ABO
    if (!isCBO) {
      adsetBody.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      if (cfg.budget_type === "lifetime") {
        adsetBody.lifetime_budget = cfg.budget_amount;
      } else {
        adsetBody.daily_budget = cfg.budget_amount;
      }
    }
    // Schedule
    const startIso = toMetaDatetime(cfg.start_time);
    const endIso   = toMetaDatetime(cfg.end_time);
    if (startIso) adsetBody.start_time = startIso;
    if (endIso)   adsetBody.end_time   = endIso;

    // Attribution window (cfg.attribution_spec is already the Meta-API array format)
    if (Array.isArray(cfg.attribution_spec) && cfg.attribution_spec.length > 0) {
      adsetBody.attribution_spec = cfg.attribution_spec;
    }

    // Pacing (standard | no_pacing) — Meta wants an array
    if (cfg.pacing_type) {
      adsetBody.pacing_type = [cfg.pacing_type];
    }

    const po = buildPromotedObject(cfg);
    if (po) adsetBody.promoted_object = po;

    const adsetRes = await fbPost(`/act_${accountIdRaw}/adsets`, adsetBody, token);
    partial.adset_id = adsetRes.id;

    // ── Step 4: Create Creative + Ad for each ad in config ───────
    partial.ads = [];
    for (let i = 0; i < cfg.ads.length; i++) {
      const ad = cfg.ads[i];
      const media = uploaded[i];

      // Video ads need: (1) status=ready (xử lý xong) (2) thumbnail
      // FB sẽ reject ad creation nếu video còn 'processing' với lỗi
      // "Hệ thống vẫn đang xử lý video này" → phải đợi ready trước.
      let videoThumbnailUrl = null;
      if (media.video_id) {
        await waitForVideoReady(media.video_id, token);
        videoThumbnailUrl = await waitForVideoThumbnail(media.video_id, token);
      }

      const storySpec = buildStorySpec({
        pageId: cfg.page_id,
        ad,
        videoId: media.video_id,
        videoThumbnailUrl,
        imageHash: media.image_hash,
        destinationType: cfg.destination_type,
      });

      // Build adcreative body — attach url_tags if ad has UTM params.
      // url_tags format: "utm_source=X&utm_medium=Y&..." (no leading ?).
      // Meta sẽ tự append vào mọi outbound click URL.
      const creativeBody = {
        name: `${ad.ad_name || `Ad ${i + 1}`} — creative`,
        object_story_spec: storySpec,
      };
      if (ad.url_tags && typeof ad.url_tags === "string" && ad.url_tags.trim()) {
        creativeBody.url_tags = ad.url_tags.trim();
      }
      const creativeRes = await fbPost(`/act_${accountIdRaw}/adcreatives`, creativeBody, token);

      const adRes = await fbPost(`/act_${accountIdRaw}/ads`, {
        name: ad.ad_name || `${cfg.campaign_name} - Ad ${i + 1}`,
        adset_id: partial.adset_id,
        creative: { creative_id: creativeRes.id },
        status: launchStatus,
      }, token);

      partial.ads.push({
        ad_id: adRes.id,
        creative_id: creativeRes.id,
        video_id: media.video_id || null,
        image_hash: media.image_hash || null,
      });
    }

    return json({
      success: true,
      campaign_id: partial.campaign_id,
      adset_id: partial.adset_id,
      ads: partial.ads,
      ads_manager_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountIdRaw}&selected_campaign_ids=${partial.campaign_id}`,
    });
  } catch (e) {
    // Figure out which step failed based on what's been populated in `partial`
    let step;
    if (!partial.uploaded) {
      step = "upload_media";
    } else if (!partial.campaign_id) {
      step = "create_campaign";
    } else if (!partial.adset_id) {
      step = "create_adset";
    } else {
      // campaign + adset exist → failing inside creative/ad loop or thumbnail wait
      step = "create_ads";
    }
    return json({
      success: false,
      step,
      error: String(e.message || e),
      partial,
    }, 502);
  }
}

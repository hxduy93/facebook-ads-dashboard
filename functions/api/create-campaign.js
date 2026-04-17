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

// Upload a video file to the ad account. Returns video_id.
async function uploadVideo(accountId, file, token) {
  const fd = new FormData();
  fd.append("source", file, file.name);
  const data = await fbPost(`/act_${accountId}/advideos`, fd, token);
  return data.id;
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
function buildStorySpec({ pageId, ad, videoId, imageHash, destinationType }) {
  const cta = { type: ad.cta || "LEARN_MORE", value: {} };
  if (ad.link) cta.value.link = ad.link_with_utm || ad.link;

  if (videoId) {
    return {
      page_id: pageId,
      video_data: {
        video_id: videoId,
        message: ad.ad_copy || "",
        title: ad.headline || "",
        call_to_action: cta,
        // image_url optional thumbnail — Meta auto-generates from video
        link_description: ad.description || "",
      },
    };
  }
  if (imageHash) {
    return {
      page_id: pageId,
      link_data: {
        image_hash: imageHash,
        link: ad.link_with_utm || ad.link || "https://doscom.vn",
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
    const campRes = await fbPost(`/act_${accountIdRaw}/campaigns`, {
      name: cfg.campaign_name || `${cfg.objective}-${Date.now()}`,
      objective: cfg.objective,
      status: "PAUSED",
      buying_type: cfg.buying_type || "AUCTION",
      special_ad_categories: [],
    }, token);
    partial.campaign_id = campRes.id;

    // ── Step 3: Create AdSet ────────────────────────────────────
    const adsetBody = {
      name: cfg.adset_name || cfg.campaign_name,
      campaign_id: partial.campaign_id,
      optimization_goal: cfg.optimization_goal,
      billing_event: cfg.billing_event,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      destination_type: cfg.destination_type || "WEBSITE",
      targeting: buildTargeting(cfg),
    };
    if (cfg.budget_type === "lifetime") {
      adsetBody.lifetime_budget = cfg.budget_amount;
    } else {
      adsetBody.daily_budget = cfg.budget_amount;
    }
    if (cfg.start_time) {
      // Append VN timezone if just a date
      adsetBody.start_time = cfg.start_time.length <= 10
        ? `${cfg.start_time}T00:00:00+07:00`
        : cfg.start_time;
    }
    if (cfg.end_time) {
      adsetBody.end_time = cfg.end_time.length <= 10
        ? `${cfg.end_time}T23:59:59+07:00`
        : cfg.end_time;
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

      const storySpec = buildStorySpec({
        pageId: cfg.page_id,
        ad,
        videoId: media.video_id,
        imageHash: media.image_hash,
        destinationType: cfg.destination_type,
      });

      const creativeRes = await fbPost(`/act_${accountIdRaw}/adcreatives`, {
        name: `${ad.ad_name || `Ad ${i + 1}`} — creative`,
        object_story_spec: storySpec,
      }, token);

      const adRes = await fbPost(`/act_${accountIdRaw}/ads`, {
        name: ad.ad_name || `${cfg.campaign_name} - Ad ${i + 1}`,
        adset_id: partial.adset_id,
        creative: { creative_id: creativeRes.id },
        status: "PAUSED",
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
    // Figure out which step failed based on partial state
    let step = "upload_media";
    if (partial.campaign_id && !partial.adset_id) step = "create_adset";
    else if (partial.adset_id && partial.ads === undefined) step = "create_ads";
    else if (partial.uploaded && !partial.campaign_id) step = "create_campaign";
    return json({
      success: false,
      step,
      error: String(e.message || e),
      partial,
    }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

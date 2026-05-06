/**
 * Cloudflare Pages Function: POST /api/fb-upload-media
 * ------------------------------------------------------
 * Tách phần upload + wait video ra khỏi /api/create-campaign để tránh
 * Cloudflare 30s timeout. Endpoint này chỉ làm:
 *   1. Upload 1 file (video hoặc ảnh) lên FB ad account
 *   2. Nếu video → poll status đến khi ready + lấy thumbnail
 *   3. Trả về { video_id, thumbnail_url } hoặc { image_hash }
 *
 * Time budget: tối đa ~30s. Phù hợp 1 video < 30MB.
 *
 * Request (multipart/form-data):
 *   - file        File (video/* hoặc image/*)
 *   - account_id  String (act_xxx hoặc xxx)
 *   - kind        "video" | "image" (optional, infer từ MIME nếu không có)
 *
 * Response:
 *   - Video: { ok, kind: "video", video_id, thumbnail_url }
 *   - Image: { ok, kind: "image", image_hash }
 *   - Error: { ok: false, step, error }
 */

const FB_API_VERSION = "v20.0";
const GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function fbGet(endpoint, params, token) {
  const qs = new URLSearchParams(params || {});
  qs.append("access_token", token);
  const r = await fetch(`${GRAPH}${endpoint}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON (status ${r.status})` } }));
  if (!r.ok || data.error) throw new Error(data.error?.message || `HTTP ${r.status}`);
  return data;
}

async function fbPost(endpoint, body, token) {
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
  const data = await r.json().catch(() => ({ error: { message: `Non-JSON (status ${r.status})` } }));
  if (!r.ok || data.error) {
    throw new Error(data.error?.error_user_msg || data.error?.message || `HTTP ${r.status}`);
  }
  return data;
}

async function uploadVideo(accountId, file, token) {
  const fd = new FormData();
  fd.append("source", file, file.name);
  const data = await fbPost(`/act_${accountId}/advideos`, fd, token);
  return data.id;
}

async function uploadImage(accountId, file, token) {
  const fd = new FormData();
  fd.append("filename", file, file.name);
  const data = await fbPost(`/act_${accountId}/adimages`, fd, token);
  const images = data.images || {};
  const first = images[Object.keys(images)[0]];
  if (!first || !first.hash) throw new Error("Image upload OK nhưng không có hash trả về");
  return first.hash;
}

// Poll FB cho đến khi video.status.video_status = "ready". Endpoint riêng nên có
// thể chờ lâu hơn (22s) so với create-campaign cũ.
async function waitForVideoReady(videoId, token, maxWaitMs = 22000, pollIntervalMs = 2500) {
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
    } catch (e) {
      if (String(e.message).includes("FB báo video lỗi")) throw e;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Video chưa ready sau ${maxWaitMs/1000}s (status: ${lastStatus}). Đợi 30-60s rồi thử lại — video sẽ ready và lần này nhanh.`);
}

async function waitForVideoThumbnail(videoId, token, maxWaitMs = 6000, pollIntervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fbGet(`/${videoId}/thumbnails`, { fields: "uri,is_preferred" }, token);
      const list = (data && data.data) || [];
      if (list.length > 0) {
        const preferred = list.find((t) => t.is_preferred) || list[0];
        if (preferred && preferred.uri) return preferred.uri;
      }
    } catch (e) { /* transient, ignore */ }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error("Thumbnail chưa sinh xong. Video có thể quá dài — thử video < 1 phút.");
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.FB_ACCESS_TOKEN;
  if (!token) return json({ ok: false, step: "init", error: "FB_ACCESS_TOKEN chưa cấu hình" }, 500);

  let file, accountId, kind;
  try {
    const form = await request.formData();
    file = form.get("file");
    accountId = String(form.get("account_id") || "").replace(/^act_/, "");
    kind = String(form.get("kind") || "").toLowerCase();
    if (!file || !(file instanceof File) || file.size === 0) {
      return json({ ok: false, step: "parse", error: "Thiếu file upload" }, 400);
    }
    if (!accountId) {
      return json({ ok: false, step: "parse", error: "Thiếu account_id" }, 400);
    }
    if (!kind) {
      kind = (file.type || "").startsWith("video") ? "video"
           : (file.type || "").startsWith("image") ? "image"
           : "";
    }
    if (!["video", "image"].includes(kind)) {
      return json({ ok: false, step: "parse", error: `Kind không hợp lệ: '${kind}'. MIME: ${file.type}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, step: "parse", error: String(e.message || e) }, 400);
  }

  let step = "upload";
  try {
    if (kind === "image") {
      const image_hash = await uploadImage(accountId, file, token);
      return json({ ok: true, kind: "image", image_hash });
    }
    // video flow
    const video_id = await uploadVideo(accountId, file, token);
    step = "wait_ready";
    await waitForVideoReady(video_id, token);
    step = "wait_thumbnail";
    const thumbnail_url = await waitForVideoThumbnail(video_id, token);
    return json({ ok: true, kind: "video", video_id, thumbnail_url });
  } catch (e) {
    return json({
      ok: false,
      step,
      error: String(e.message || e),
    }, 502);
  }
}

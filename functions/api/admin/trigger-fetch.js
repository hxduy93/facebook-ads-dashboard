// POST /api/admin/trigger-fetch — Trigger GitHub Actions workflows on demand
//
// Dispatches 3 workflows song song:
//   1. fetch-fb-ads.yml          — FB Ads insights (chi tiêu Facebook)
//   2. fetch-google-ads.yml      — Google Ads spend (chi tiêu Google)
//   3. fetch-pancake.yml         — Pancake revenue (doanh thu FB + Google trên Pancake)
//
// Yêu cầu env vars (set trong Cloudflare Pages dashboard):
//   GITHUB_TOKEN  — Fine-grained PAT, scope: Actions(write) + Contents(read)
//                   Tạo ở https://github.com/settings/personal-access-tokens/new
//   GITHUB_REPO   — "owner/repo" (vd: "hxduy93/facebook-ads-dashboard")
//
// Auth: yêu cầu session + role_level >= 40 (TP Marketing trở lên).

import { verifySession } from "../../_middleware.js";
import { getEmployeeFromEmail, requireLevel } from "../../lib/rbac.js";

const SESSION_COOKIE = "doscom_session";

const WORKFLOWS = [
  { file: "fetch-fb-ads.yml",     label: "Chi tiêu Facebook Ads" },
  { file: "fetch-google-ads.yml", label: "Chi tiêu Google Ads"  },
  { file: "fetch-pancake.yml",    label: "Doanh thu Pancake POS" },
];

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

async function dispatchWorkflow(token, repo, workflowFile, ref = "main") {
  // GitHub API: POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
  // Trả 204 No Content nếu thành công, error JSON nếu fail.
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "doscom-dashboard",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref }),
  });
  if (r.status === 204) return { ok: true };
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  return { ok: false, status: r.status, message: body?.message || `HTTP ${r.status}` };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Auth ──────────────────────────────────────────────
  const sessionCookie = getCookie(request, SESSION_COOKIE);
  const session = await verifySession(sessionCookie, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: "Chưa đăng nhập" }, 401);

  const employee = await getEmployeeFromEmail(env, session.email);
  if (!employee) return jsonResponse({ error: "Email chưa đăng ký trong ERP" }, 403);
  if (!requireLevel(employee, 40)) {
    return jsonResponse({ error: "Cần quyền Trưởng phòng trở lên (level ≥ 40)" }, 403);
  }

  // ── Config check ──────────────────────────────────────
  const token = env.GITHUB_TOKEN;
  const repo  = env.GITHUB_REPO;
  if (!token || !repo) {
    return jsonResponse({
      error: "Chưa cấu hình GITHUB_TOKEN / GITHUB_REPO trong Cloudflare Pages env",
      hint: "Vào Cloudflare Pages → Settings → Environment Variables, thêm 2 biến: GITHUB_TOKEN (PAT) và GITHUB_REPO (vd: hxduy93/facebook-ads-dashboard)",
    }, 500);
  }

  // ── Dispatch song song ────────────────────────────────
  const results = await Promise.all(
    WORKFLOWS.map(async w => {
      const r = await dispatchWorkflow(token, repo, w.file);
      return { workflow: w.file, label: w.label, ...r };
    })
  );

  const allOk = results.every(r => r.ok);
  const okCount = results.filter(r => r.ok).length;

  return jsonResponse({
    ok: allOk,
    triggered_by: session.email,
    triggered_at: new Date().toISOString(),
    summary: `${okCount}/${WORKFLOWS.length} workflows dispatched`,
    repo,
    results,
    note: "Workflows chạy ~30-90s. Refresh trang sau 90s để xem data mới.",
    actions_url: `https://github.com/${repo}/actions`,
  }, allOk ? 200 : 502);
}

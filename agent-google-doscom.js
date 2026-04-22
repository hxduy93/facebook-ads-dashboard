// Agent Google Doscom v4.0 — Adapter for JSON schema v2.0 (top_actions + score_breakdown + deep_dives)
console.log("[AgentPage] JS v4.0 loaded");

var REPORT = null;
var CAT_VN = {
  "KEYWORD": "Từ khóa",
  "CREATIVE": "Quảng cáo/Banner",
  "BUDGET": "Ngân sách",
  "PLACEMENT": "Vị trí hiển thị",
  "TREND": "Xu hướng",
  "BIDDING": "Đấu giá",
  "STRUCTURE": "Cấu trúc",
  "TRACKING": "Tracking"
};
var RISK_VN = { "low": "Rủi ro thấp", "medium": "Rủi ro TB", "high": "Rủi ro cao" };
var STATUS_VN = { "OK": "Tốt", "WARN": "Cần chú ý", "CRITICAL": "Nghiêm trọng", "DATA_GAP": "Thiếu dữ liệu" };

function fmtVND(n) {
  if (n == null || n === 0) return "0";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "tỷ";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "tr";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return Math.round(n).toLocaleString("vi-VN");
}
function fmtInt(n) { return n == null ? "-" : n.toLocaleString("vi-VN"); }
function fmtPct(n, d) { if (d == null) d = 2; return n == null ? "-" : (n * 100).toFixed(d) + "%"; }
function fmtFloat(n, d) { if (d == null) d = 2; return n == null ? "-" : Number(n).toFixed(d); }
function esc(s) {
  if (s == null) return "";
  return String(s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split("\"").join("&quot;");
}
function mdBold(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

// Simple markdown -> HTML cho raw_markdown section
function mdToHtml(md) {
  if (!md) return "";
  var lines = md.split("\n");
  var out = [], inList = false, inTable = false, tableRows = [];
  function flushList() { if (inList) { out.push("</ul>"); inList = false; } }
  function flushTable() {
    if (inTable && tableRows.length) {
      var head = tableRows[0];
      var body = tableRows.slice(2);
      var th = head.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("");
      var tbodyHtml = body.map(function (r) {
        return "<tr>" + r.map(function (c) { return "<td>" + mdBold(c) + "</td>"; }).join("") + "</tr>";
      }).join("");
      out.push('<div class="tbl-wrap"><table class="compact-tbl"><thead><tr>' + th + '</tr></thead><tbody>' + tbodyHtml + "</tbody></table></div>");
    }
    inTable = false; tableRows = [];
  }
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (/^\|.*\|\s*$/.test(L)) {
      flushList();
      inTable = true;
      tableRows.push(L.split("|").slice(1, -1).map(function (x) { return x.trim(); }));
      continue;
    } else { flushTable(); }
    if (/^#{1,6}\s/.test(L)) {
      flushList();
      var lvl = L.match(/^#+/)[0].length;
      var txt = L.replace(/^#+\s/, "");
      out.push("<h" + Math.min(lvl + 2, 6) + ">" + mdBold(txt) + "</h" + Math.min(lvl + 2, 6) + ">");
    } else if (/^\s*[-*]\s/.test(L)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + mdBold(L.replace(/^\s*[-*]\s/, "")) + "</li>");
    } else if (L.trim() === "") {
      flushList();
      out.push("");
    } else {
      flushList();
      out.push("<p>" + mdBold(L) + "</p>");
    }
  }
  flushList(); flushTable();
  return out.join("\n");
}

function load() {
  fetch("data/google-ads-daily-report.json?v=" + Date.now())
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (r) {
      REPORT = r;
      try { render(r); }
      catch (e) { console.error(e); showError("Lỗi render: " + e.message); }
    })
    .catch(function (e) { showError("Không tải dữ liệu: " + esc(e.message)); });
}

function showError(m) {
  document.getElementById("main").innerHTML =
    '<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2;margin-top:16px">' +
    '<h3 style="color:#991b1b">Lỗi</h3><div>' + m + '</div></div>';
}

function scrollToEl(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("highlight-bg");
  setTimeout(function () { el.classList.remove("highlight-bg"); }, 2000);
}

function switchSearchTab(key, ev) {
  var tabs = document.querySelectorAll(".st-tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
  if (ev && ev.target) ev.target.classList.add("active");
  document.getElementById("st-content").innerHTML = renderSearchSub(REPORT.search_term_deep_dive || {}, key);
}

function toggleRaw() {
  var el = document.getElementById("raw-md-body");
  var btn = document.getElementById("raw-md-toggle");
  if (!el) return;
  if (el.style.display === "none" || el.style.display === "") {
    el.style.display = "block"; btn.innerText = "Ẩn báo cáo gốc";
  } else {
    el.style.display = "none"; btn.innerText = "Xem báo cáo gốc (markdown)";
  }
}

function render(r) {
  var g = r.grade || "F";
  var score = r.score || 0;
  var ta = r.top_actions || [];
  var totalSaving = 0;
  for (var i = 0; i < ta.length; i++) totalSaving += (ta[i].estimated_saving_vnd || 0);
  var warns = r.warnings || [];

  var h = "";

  // Summary grid - 4 cards
  h += '<section class="grid-summary">';
  h += '<div class="card card-score bg-' + g + '">' +
       '<div class="metric-label" style="color:rgba(255,255,255,.8)">Điểm số</div>' +
       '<div class="metric-value">' + score + '<span style="font-size:18px;opacity:.8">/100</span></div>' +
       '<div style="font-size:14px;font-weight:600;margin-top:4px">Xếp hạng ' + g + '</div></div>';
  h += '<div class="card">' +
       '<div class="metric-label">Tiết kiệm tiềm năng</div>' +
       '<div class="metric-value text-green">' + fmtVND(totalSaving) + 'đ</div>' +
       '<div class="metric-sub">cộng dồn 5 top actions</div></div>';
  h += '<div class="card">' +
       '<div class="metric-label">Hành động cần làm</div>' +
       '<div class="metric-value">' + ta.length + '</div>' +
       '<div class="metric-sub">ưu tiên theo priority 1→5</div></div>';
  h += '<div class="card">' +
       '<div class="metric-label">Cảnh báo</div>' +
       '<div class="metric-value text-red">' + warns.length + '</div>' +
       '<div class="metric-sub">vấn đề cần chú ý</div></div>';
  h += '</section>';

  // Headline + Verdict
  var pd = r.period || {};
  var ga = r.ga_account || {};
  h += '<section class="block card">';
  h += '<p style="font-weight:600;font-size:15px;color:#111827">' + esc(r.headline || "") + '</p>';
  h += '<p class="text-sm" style="margin-top:8px;color:#374151;line-height:1.6">' + esc(r.verdict || "") + '</p>';
  h += '<p class="text-xs" style="color:#9ca3af;margin-top:10px">' +
       'Cập nhật: <strong>' + esc(r.generated_at) + '</strong> · ' +
       'Kỳ 30d: <strong>' + esc(pd.start) + ' → ' + esc(pd.end) + '</strong> · ' +
       'Tài khoản: <strong>' + esc(ga.name || "-") + '</strong> (' + esc(ga.id || "-") + ') · ' +
       'Model: <strong>' + esc(r.model || "-") + '</strong>' +
       '</p>';
  h += '</section>';

  // Top Actions
  h += '<section class="block card">';
  h += '<h2>Top ' + ta.length + ' hành động ưu tiên</h2>';
  h += '<p class="text-xs text-gray" style="margin-bottom:12px">Sắp xếp theo priority. Saving VND (tiết kiệm đồng VN) là ước tính 30d nếu áp dụng.</p>';
  for (var ai = 0; ai < ta.length; ai++) {
    var a = ta[ai];
    var pcls = a.priority <= 2 ? "priority-high" : (a.priority === 3 ? "priority-medium" : "priority-low");
    var rcls = a.risk === "high" ? "badge-high" : (a.risk === "medium" ? "badge-medium" : "badge-low");
    h += '<div class="action-box ' + pcls + '" id="action-' + a.priority + '">';
    h += '<div class="title">' +
         '<span class="badge badge-high" style="margin-right:6px">#' + a.priority + '</span>' +
         '<span class="pill">' + esc(CAT_VN[a.category] || a.category) + '</span> ' +
         esc(a.action) + '</div>';
    h += '<div class="detail"><strong>Lý do:</strong> ' + esc(a.reason) + '</div>';
    h += '<div class="save">';
    h += 'Tiết kiệm ước tính: <strong>' + fmtVND(a.estimated_saving_vnd) + 'đ/30d</strong>';
    h += ' · <span class="badge ' + rcls + '">' + esc(RISK_VN[a.risk] || a.risk) + '</span>';
    h += ' · Thời gian làm: <strong>' + esc(a.time_cost) + '</strong>';
    h += '</div></div>';
  }
  h += '</section>';

  // Score breakdown - 10 dimensions
  var sb = r.score_breakdown || [];
  if (sb.length) {
    h += '<section class="block card">';
    h += '<h2>Chấm điểm chi tiết ' + sb.length + ' tiêu chí</h2>';
    h += '<p class="text-xs text-gray" style="margin-bottom:12px">Mỗi tiêu chí (dimension) được chấm so với max. Tổng = điểm tài khoản. Lưu ý: đây là chấm nội bộ Doscom, không phải Google Ads Quality Score chính thức.</p>';
    h += '<div class="tbl-wrap"><table><thead><tr>' +
         '<th>Tiêu chí</th>' +
         '<th class="t-center">Điểm</th>' +
         '<th class="t-center">Trạng thái</th>' +
         '<th>Ghi chú</th>' +
         '</tr></thead><tbody>';
    for (var si = 0; si < sb.length; si++) {
      var s = sb[si];
      var scls = s.status === "CRITICAL" ? "badge-high" :
                 (s.status === "WARN" ? "badge-medium" :
                  (s.status === "DATA_GAP" ? "badge-low" : "pill-green"));
      var pctScore = s.max ? (s.score / s.max) : 0;
      var barCol = pctScore >= 0.8 ? "#10b981" : (pctScore >= 0.5 ? "#f59e0b" : "#ef4444");
      h += '<tr>';
      h += '<td class="font-bold">' + esc(s.dimension) + '</td>';
      h += '<td class="t-center"><div style="display:flex;align-items:center;gap:6px;justify-content:center">' +
           '<span class="mono">' + s.score + '/' + s.max + '</span>' +
           '<div style="width:60px;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">' +
           '<div style="width:' + (pctScore * 100) + '%;height:100%;background:' + barCol + '"></div>' +
           '</div></div></td>';
      h += '<td class="t-center"><span class="badge ' + scls + '">' + esc(STATUS_VN[s.status] || s.status) + '</span></td>';
      h += '<td class="text-sm">' + esc(s.note) + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table></div></section>';
  }

  // Search Terms deep dive
  var std = r.search_term_deep_dive || {};
  var hasSearchDD = (std.top_converting && std.top_converting.length) ||
                    (std.top_waste && std.top_waste.length) ||
                    (std.negative_gap && std.negative_gap.length);
  if (hasSearchDD) {
    h += '<section class="block card">';
    h += '<h2>Phân tích Search Terms (từ khóa tìm kiếm thực)</h2>';
    h += '<div class="cat-tabs">';
    h += '<button class="cat-tab st-tab active" onclick="switchSearchTab(\'top_converting\',event)">Top chuyển đổi (có conv - conversion)</button>';
    h += '<button class="cat-tab st-tab" onclick="switchSearchTab(\'top_waste\',event)">Top lãng phí (0 conv, spend cao)</button>';
    h += '<button class="cat-tab st-tab" onclick="switchSearchTab(\'negative_gap\',event)">Gap negative (cần exclude)</button>';
    h += '</div>';
    h += '<div id="st-content">' + renderSearchSub(std, "top_converting") + '</div>';
    h += '</section>';
  }

  // Placement + Banner deep dive
  var pbd = r.placement_banner_deep_dive || {};
  h += '<section class="block card">';
  h += '<h2>Phân tích Placement & Banner (GDN - Google Display Network)</h2>';
  if (pbd.network_breakdown_summary) {
    h += '<div style="background:#eff6ff;border-left:4px solid #2563eb;padding:10px 12px;border-radius:6px;margin-bottom:12px">';
    h += '<p class="text-sm">' + esc(pbd.network_breakdown_summary) + '</p>';
    h += '</div>';
  }
  var twp = pbd.top_waste_placements || [];
  if (twp.length) {
    h += '<h3>Placement lãng phí cần loại trừ (Exclude)</h3>';
    h += '<div class="tbl-wrap"><table><thead><tr>' +
         '<th>#</th><th>Placement (URL/site)</th><th class="t-center">Loại</th>' +
         '<th class="t-right">Spend 30d</th><th class="t-right">Click</th><th class="t-right">CTR</th>' +
         '<th class="t-right">Saving nếu exclude</th>' +
         '</tr></thead><tbody>';
    for (var pi = 0; pi < twp.length; pi++) {
      var p = twp[pi];
      h += '<tr>';
      h += '<td class="text-gray">' + (pi + 1) + '</td>';
      h += '<td><span class="mono">' + esc(p.placement) + '</span></td>';
      h += '<td class="t-center"><span class="pill">' + esc(p.placement_type || "-") + '</span></td>';
      h += '<td class="t-right">' + fmtVND(p.spend_30d) + 'đ</td>';
      h += '<td class="t-right">' + fmtInt(p.clicks_30d) + '</td>';
      h += '<td class="t-right ' + ((p.ctr_30d || 0) < 0.005 ? "text-red font-bold" : "") + '">' + fmtPct(p.ctr_30d) + '</td>';
      h += '<td class="t-right text-green font-bold">' + fmtVND(p.saving_if_excluded_vnd) + 'đ</td>';
      h += '</tr>';
    }
    h += '</tbody></table></div>';
  }
  var wb = pbd.worst_banners || [];
  if (wb.length) {
    h += '<h3 style="margin-top:16px">Banner yếu nhất (CTR thấp, spend có)</h3>';
    h += '<div class="tbl-wrap"><table><thead><tr>' +
         '<th>#</th><th>Ad ID</th><th>Banner name</th><th>Campaign</th>' +
         '<th class="t-right">Spend</th><th class="t-right">Impr</th>' +
         '<th class="t-right">Click</th><th class="t-right">CTR</th>' +
         '</tr></thead><tbody>';
    for (var bi = 0; bi < wb.length; bi++) {
      var b = wb[bi];
      h += '<tr>';
      h += '<td class="text-gray">' + (bi + 1) + '</td>';
      h += '<td><span class="mono text-xs">' + esc(b.ad_id) + '</span></td>';
      h += '<td class="font-bold">' + esc(b.ad_name) + '</td>';
      h += '<td class="truncate" title="' + esc(b.campaign) + '">' + esc(b.campaign) + '</td>';
      h += '<td class="t-right">' + fmtVND(b.spend_30d) + 'đ</td>';
      h += '<td class="t-right">' + fmtInt(b.impressions_30d) + '</td>';
      h += '<td class="t-right ' + (!b.clicks_30d ? "text-red font-bold" : "") + '">' + fmtInt(b.clicks_30d) + '</td>';
      h += '<td class="t-right ' + ((b.ctr_30d || 0) < 0.005 ? "text-red font-bold" : "") + '">' + fmtPct(b.ctr_30d) + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table></div>';
  }
  h += '</section>';

  // Pause candidates
  var pc = r.pause_candidates || [];
  if (pc.length) {
    h += '<section class="block card">';
    h += '<h2>Chiến dịch đề xuất tạm dừng (Pause candidates)</h2>';
    h += '<div class="tbl-wrap"><table><thead><tr>' +
         '<th>Campaign</th><th class="t-center">Category</th>' +
         '<th class="t-right">Spend 30d</th><th class="t-right">CTR</th>' +
         '<th class="t-right">Trend 7d</th><th>Lý do</th>' +
         '</tr></thead><tbody>';
    for (var ci = 0; ci < pc.length; ci++) {
      var c = pc[ci];
      var tcls = (c.trend_7d_pct || 0) < -20 ? "text-red font-bold" : ((c.trend_7d_pct || 0) < 0 ? "text-red" : "text-green");
      h += '<tr>';
      h += '<td class="font-bold">' + esc(c.campaign) + '</td>';
      h += '<td class="t-center"><span class="pill">' + esc(c.category) + '</span></td>';
      h += '<td class="t-right">' + fmtVND(c.spend_30d) + 'đ</td>';
      h += '<td class="t-right">' + fmtPct(c.ctr_30d) + '</td>';
      h += '<td class="t-right ' + tcls + '">' + fmtFloat(c.trend_7d_pct, 1) + '%</td>';
      h += '<td class="text-sm">' + esc(c.reason) + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table></div></section>';
  }

  // Warnings & Evidence
  if (warns.length) {
    h += '<section class="block card" style="background:#fef2f2;border-left:4px solid #dc2626">';
    h += '<h2 style="color:#991b1b">Cảnh báo (' + warns.length + ')</h2>';
    h += '<ul style="margin-left:16px;font-size:13px;margin-top:6px;line-height:1.6">';
    for (var wi = 0; wi < warns.length; wi++) h += '<li style="margin-bottom:6px">' + esc(warns[wi]) + '</li>';
    h += '</ul></section>';
  }
  var ev = r.evidence || [];
  if (ev.length) {
    h += '<section class="block card" style="background:#eff6ff">';
    h += '<h2>Dữ liệu dẫn chứng (Evidence)</h2>';
    h += '<ul style="margin-left:16px;font-size:13px;margin-top:6px;line-height:1.6">';
    for (var ei = 0; ei < ev.length; ei++) h += '<li style="margin-bottom:6px">' + esc(ev[ei]) + '</li>';
    h += '</ul></section>';
  }

  // Raw Markdown - collapsed
  if (r.raw_markdown) {
    h += '<section class="block card">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h += '<h2>Báo cáo gốc (markdown)</h2>';
    h += '<button id="raw-md-toggle" class="scroll-btn" onclick="toggleRaw()">Xem báo cáo gốc (markdown)</button>';
    h += '</div>';
    h += '<div id="raw-md-body" style="display:none;border-top:1px solid #e5e7eb;padding-top:12px;max-height:600px;overflow:auto">';
    h += '<div class="md-body">' + mdToHtml(r.raw_markdown) + '</div>';
    h += '</div>';
    h += '</section>';
  }

  // Footer
  h += '<div class="footer">' +
       'Agent Google Doscom v' + (r.version || "2.0") + ' (renderer v4.0) · ' +
       'Báo cáo từ pipeline ' + esc(r.model || "-") + ' · ' +
       'Cập nhật ' + esc(r.generated_at) +
       '</div>';

  document.getElementById("main").innerHTML = h;
}

function renderSearchSub(std, key) {
  var items = std[key] || [];
  if (!items.length) return '<p class="text-gray text-sm">Không có dữ liệu.</p>';
  var h = '<div class="tbl-wrap"><table><thead><tr>';
  if (key === "top_converting") {
    h += '<th>#</th><th>Search term</th><th class="t-center">Match type</th>' +
         '<th class="t-right">Spend 30d</th><th class="t-right">Click</th>' +
         '<th class="t-right">Conv</th><th class="t-right">CTR</th>' +
         '<th>Đề xuất</th>';
  } else if (key === "top_waste") {
    h += '<th>#</th><th>Search term</th><th class="t-center">Match type</th>' +
         '<th class="t-right">Spend 30d</th><th class="t-right">Click</th>' +
         '<th class="t-right">CTR</th><th>Campaigns dính</th><th>Đề xuất</th>';
  } else {
    h += '<th>#</th><th>Search term</th><th class="t-center">Match type</th>' +
         '<th class="t-right">Spend 30d</th><th class="t-right">Click</th>' +
         '<th>Campaigns dính</th><th class="t-right">Saving nếu exclude</th>';
  }
  h += '</tr></thead><tbody>';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var mt = (it.match_types || []).join(", ");
    h += '<tr>';
    h += '<td class="text-gray">' + (i + 1) + '</td>';
    h += '<td class="font-bold">' + esc(it.search_term) + '</td>';
    h += '<td class="t-center"><span class="pill">' + esc(mt || "-") + '</span></td>';
    h += '<td class="t-right">' + fmtVND(it.spend_30d) + 'đ</td>';
    h += '<td class="t-right">' + fmtInt(it.clicks_30d) + '</td>';
    if (key === "top_converting") {
      h += '<td class="t-right text-green font-bold">' + fmtFloat(it.conversions_30d, 2) + '</td>';
      h += '<td class="t-right">' + fmtPct(it.ctr_30d) + '</td>';
      h += '<td class="text-sm">' + esc(it.recommendation || "-") + '</td>';
    } else if (key === "top_waste") {
      h += '<td class="t-right ' + ((it.ctr_30d || 0) < 0.005 ? "text-red" : "") + '">' + fmtPct(it.ctr_30d) + '</td>';
      var cmps = (it.campaigns || []).slice(0, 2).join(", ") + ((it.campaigns || []).length > 2 ? " (+" + ((it.campaigns || []).length - 2) + ")" : "");
      h += '<td class="text-xs truncate" title="' + esc((it.campaigns || []).join(", ")) + '">' + esc(cmps) + '</td>';
      h += '<td class="text-sm">' + esc(it.recommendation || "-") + '</td>';
    } else {
      var cmps2 = (it.campaigns || []).slice(0, 2).join(", ") + ((it.campaigns || []).length > 2 ? " (+" + ((it.campaigns || []).length - 2) + ")" : "");
      h += '<td class="text-xs truncate" title="' + esc((it.campaigns || []).join(", ")) + '">' + esc(cmps2) + '</td>';
      h += '<td class="t-right text-green font-bold">' + fmtVND(it.saving_if_excluded_vnd) + 'đ</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  return h;
}

// Init
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", load);
} else {
  load();
}

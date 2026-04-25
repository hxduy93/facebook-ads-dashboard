// Inventory dashboard — quản lý kho Doscom với edit trực tiếp
// Lưu trữ: Cloudflare KV qua /api/inventory
// Quyền sửa: chỉ admin email (server-side check)
console.log("[Inventory] v1.0 loaded");

var ADMIN_EMAIL = "hxduy93@gmail.com";  // sẽ được override bởi response server
var INVENTORY = [];        // toàn bộ data từ KV
var EDITED = {};           // {code: {field: newValue}} — pending changes
var IS_ADMIN = false;
var CURRENT_USER = "";

// ── Utilities ───────────────────────────────────────────
function fmtVND(n) {
  if (n == null) return "-";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "tr";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return Math.round(n).toLocaleString("vi-VN");
}
function fmtInt(n) { return n == null ? "0" : Math.round(n).toLocaleString("vi-VN"); }
function esc(s) {
  if (s == null) return "";
  return String(s).split("&").join("&amp;").split("<").join("&lt;")
    .split(">").join("&gt;").split('"').join("&quot;");
}

// Phân nhóm SP theo prefix mã (cùng logic classify_sku Python)
var WIFI_CODES = ["da1 pro wifi","da3","da3.1","da3.2","da3.3","da4","da3 pro","da5","da6.1 wifi","da7","da9"];
var G4_CODES = ["da1 pro 4g","da1 zoomx6","da1 pro","da2","da3 pro 4g","da5.1","da6","da6.1","da6.2"];

function classifyGroup(code) {
  if (!code) return "OTHER";
  var n = code.toLowerCase().trim();
  if (n.indexOf("noma") >= 0 || n.indexOf("a002") >= 0 || n.indexOf("khăn") >= 0) return "NOMA";
  if (/^da\s*8\.1/.test(n)) return "CAMERA_VIDEO_CALL";
  if (/^da\d/.test(n)) {
    if (n.indexOf("4g") >= 0 || n.indexOf("sim") >= 0) return "CAMERA_4G";
    for (var i=0;i<G4_CODES.length;i++){ if(n.indexOf(G4_CODES[i])===0) return "CAMERA_4G"; }
    return "CAMERA_WIFI";
  }
  if (/^dr\d/.test(n)) return "GHI_AM";
  if (/^di\d/.test(n)) return "CHONG_GHI_AM";
  if (/^dv\d/.test(n) || /^dt\d/.test(n)) return "DINH_VI";
  if (/^d\d/.test(n)) return "MAY_DO";
  return "OTHER";
}

var GROUP_LABELS = {
  MAY_DO: "Máy dò",
  CAMERA_WIFI: "Camera wifi",
  CAMERA_4G: "Camera 4G",
  CAMERA_VIDEO_CALL: "Camera gọi 2 chiều",
  GHI_AM: "Máy ghi âm",
  CHONG_GHI_AM: "Chống ghi âm",
  DINH_VI: "Định vị",
  NOMA: "NOMA",
  OTHER: "Khác",
};

// ── Toast ───────────────────────────────────────────────
function toast(msg, type) {
  type = type || "info";
  var el = document.getElementById("toast");
  el.className = "toast " + type;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(function() { el.classList.remove("show"); }, 3500);
}

// ── Get current user email từ cookie session ───────────
function getCurrentUserFromCookie() {
  var m = document.cookie.match(/doscom_session=([^;]+)/);
  if (!m) return "";
  try {
    var token = m[1];
    var emailB64 = token.split(".")[0];
    var email = atob(emailB64.replace(/-/g, "+").replace(/_/g, "/"));
    return email.toLowerCase();
  } catch (e) { return ""; }
}

// ── Load data ───────────────────────────────────────────
async function loadInventory() {
  try {
    var resp = await fetch("/api/inventory?v=" + Date.now());
    if (!resp.ok) {
      var errData = await resp.json().catch(function(){ return null; });
      throw new Error(errData && errData.error ? errData.error : "HTTP " + resp.status);
    }
    var data = await resp.json();
    INVENTORY = data.items || [];
    if (data.admin_email) ADMIN_EMAIL = data.admin_email.toLowerCase();
    CURRENT_USER = getCurrentUserFromCookie();
    IS_ADMIN = CURRENT_USER === ADMIN_EMAIL;
    renderInfoBar();
    renderTable();
    updateStats();
  } catch (e) {
    document.getElementById("table-wrap").innerHTML =
      '<div class="empty"><strong>Lỗi tải dữ liệu:</strong> ' + esc(e.message) +
      '<br><small>Có thể KV chưa được bind. Hoặc bạn cần Import từ Misa lần đầu để có dữ liệu.</small></div>';
    toast("Lỗi: " + e.message, "error");
  }
}

// ── Render info bar (admin / view only) ────────────────
function renderInfoBar() {
  var bar = document.getElementById("info-bar");
  var userInfo = document.getElementById("user-info");
  userInfo.textContent = CURRENT_USER ? "Đăng nhập: " + CURRENT_USER : "";
  if (IS_ADMIN) {
    bar.className = "info-bar admin";
    bar.innerHTML = "✓ <strong>Bạn có quyền sửa giá.</strong> Click vào ô số để sửa, bấm Lưu để cập nhật.";
  } else {
    bar.className = "info-bar viewonly";
    bar.innerHTML = "⚠ <strong>Bạn chỉ có quyền XEM.</strong> Quyền sửa giá thuộc về " + esc(ADMIN_EMAIL) + ".";
  }
}

// ── Filter logic ────────────────────────────────────────
function getFiltered() {
  var search = document.getElementById("search-input").value.toLowerCase().trim();
  var statusFilter = document.getElementById("filter-status").value;
  var groupFilter = document.getElementById("filter-group").value;

  return INVENTORY.filter(function(item) {
    if (search) {
      var hay = (item.code + " " + (item.ten_day_du||"")).toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    if (statusFilter !== "all") {
      var ts = item.trang_thai || "";
      if (statusFilter === "active" && !ts.startsWith("Đang")) return false;
      if (statusFilter === "stop" && !ts.startsWith("Ngừng")) return false;
      if (statusFilter === "test" && !ts.startsWith("Hàng test")) return false;
    }
    if (groupFilter !== "all") {
      if (classifyGroup(item.code) !== groupFilter) return false;
    }
    return true;
  });
}

// ── Render table ────────────────────────────────────────
function renderTable() {
  var items = getFiltered();
  var wrap = document.getElementById("table-wrap");

  if (!items.length) {
    if (!INVENTORY.length) {
      wrap.innerHTML = '<div class="empty">' +
        '<strong>Kho chưa có dữ liệu.</strong><br><small>Bấm "📥 Import từ Misa" để load lần đầu từ file kho-tong.xlsx.</small>' +
        '</div>';
    } else {
      wrap.innerHTML = '<div class="empty">Không có SP nào khớp bộ lọc.</div>';
    }
    return;
  }

  var disabled = IS_ADMIN ? "" : "disabled";
  var h = '<table><thead><tr>';
  h += '<th style="min-width:120px">Mã</th>';
  h += '<th style="min-width:240px">Tên đầy đủ</th>';
  h += '<th>Nhóm</th>';
  h += '<th class="t-right" style="min-width:120px">Giá nhập (VND)</th>';
  h += '<th class="t-right" style="min-width:120px">Giá bán (VND)</th>';
  h += '<th class="t-right" style="min-width:80px">Tồn kho</th>';
  h += '<th style="min-width:140px">Trạng thái</th>';
  h += '<th>Cập nhật</th>';
  h += '</tr></thead><tbody>';

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var code = it.code;
    var grp = classifyGroup(code);
    var grpLabel = GROUP_LABELS[grp] || grp;
    var edit = EDITED[code] || {};
    var name = edit.ten_day_du !== undefined ? edit.ten_day_du : (it.ten_day_du || code);
    var giaNhap = edit.gia_nhap_vnd !== undefined ? edit.gia_nhap_vnd : (it.gia_nhap_vnd || 0);
    var giaBan = edit.gia_ban_vnd !== undefined ? edit.gia_ban_vnd : (it.gia_ban_vnd || 0);
    var ton = edit.ton_kho !== undefined ? edit.ton_kho : (it.ton_kho || 0);
    var status = edit.trang_thai !== undefined ? edit.trang_thai : (it.trang_thai || "Đang kinh doanh");
    var updatedAt = it.updated_at ? new Date(it.updated_at).toLocaleDateString("vi-VN") + " · " + (it.updated_by || "?") : "—";

    var nhCls = edit.gia_nhap_vnd !== undefined ? " changed" : "";
    var bnCls = edit.gia_ban_vnd !== undefined ? " changed" : "";
    var tkCls = edit.ton_kho !== undefined ? " changed" : "";
    var stCls = edit.trang_thai !== undefined ? " changed" : "";

    var statusBadge;
    if (status.startsWith("Đang")) statusBadge = "badge-active";
    else if (status.startsWith("Ngừng")) statusBadge = "badge-stop";
    else statusBadge = "badge-test";

    h += '<tr>';
    h += '<td class="code">' + esc(code) + '</td>';
    h += '<td class="name" title="' + esc(name) + '">' + esc(name) + '</td>';
    h += '<td><span class="badge" style="background:#dbeafe;color:#1e40af">' + esc(grpLabel) + '</span></td>';
    h += '<td class="t-right"><input type="number" class="inline-edit' + nhCls +
         '" value="' + giaNhap + '" data-code="' + esc(code) + '" data-field="gia_nhap_vnd" ' + disabled + '></td>';
    h += '<td class="t-right"><input type="number" class="inline-edit' + bnCls +
         '" value="' + giaBan + '" data-code="' + esc(code) + '" data-field="gia_ban_vnd" ' + disabled + '></td>';
    h += '<td class="t-right"><input type="number" class="inline-edit' + tkCls +
         '" value="' + ton + '" data-code="' + esc(code) + '" data-field="ton_kho" ' + disabled + '></td>';
    h += '<td><select class="inline-edit' + stCls + '" data-code="' + esc(code) + '" data-field="trang_thai" ' + disabled + '>';
    h += '<option value="Đang kinh doanh"' + (status.startsWith("Đang") ? " selected" : "") + '>Đang kinh doanh</option>';
    h += '<option value="Ngừng kinh doanh"' + (status.startsWith("Ngừng") ? " selected" : "") + '>Ngừng kinh doanh</option>';
    h += '<option value="Hàng test"' + (status.startsWith("Hàng") ? " selected" : "") + '>Hàng test</option>';
    h += '</select></td>';
    h += '<td class="muted" style="font-size:11px">' + esc(updatedAt) + '</td>';
    h += '</tr>';
  }
  h += '</tbody></table>';
  wrap.innerHTML = h;

  // Attach handlers
  if (IS_ADMIN) {
    var inputs = wrap.querySelectorAll(".inline-edit");
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener("change", onCellEdit);
      inputs[j].addEventListener("input", onCellEdit);
    }
  }
}

// ── Cell edit handler ──────────────────────────────────
function onCellEdit(e) {
  var el = e.target;
  var code = el.getAttribute("data-code");
  var field = el.getAttribute("data-field");
  var newVal = el.tagName === "SELECT" ? el.value : el.value;
  if (field !== "trang_thai" && field !== "ten_day_du") {
    newVal = Number(newVal) || 0;
  }
  // Lookup original
  var orig = INVENTORY.find(function(x) { return x.code === code; });
  if (!orig) return;
  var origVal = orig[field];
  if (field === "ton_kho") origVal = Number(origVal) || 0;
  if (field === "gia_nhap_vnd" || field === "gia_ban_vnd") origVal = Number(origVal) || 0;

  if (!EDITED[code]) EDITED[code] = {};
  if (newVal === origVal) {
    delete EDITED[code][field];
    if (Object.keys(EDITED[code]).length === 0) delete EDITED[code];
    el.classList.remove("changed");
  } else {
    EDITED[code][field] = newVal;
    el.classList.add("changed");
  }
  updateSaveBar();
}

// ── Save bar ────────────────────────────────────────────
function updateSaveBar() {
  var count = Object.keys(EDITED).length;
  var bar = document.getElementById("save-bar");
  document.getElementById("save-count").textContent = count;
  if (count > 0) bar.classList.add("visible");
  else bar.classList.remove("visible");
  document.getElementById("stat-edited").textContent = count;
}

// ── Stats ───────────────────────────────────────────────
function updateStats() {
  var statsEl = document.getElementById("stats");
  if (!INVENTORY.length) { statsEl.style.display = "none"; return; }
  statsEl.style.display = "flex";
  document.getElementById("stat-total").textContent = INVENTORY.length;
  var active = 0, stop = 0, stockValue = 0;
  for (var i = 0; i < INVENTORY.length; i++) {
    var it = INVENTORY[i];
    var st = it.trang_thai || "";
    if (st.startsWith("Đang")) active++;
    else if (st.startsWith("Ngừng")) stop++;
    stockValue += (Number(it.gia_nhap_vnd) || 0) * (Number(it.ton_kho) || 0);
  }
  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-stop").textContent = stop;
  document.getElementById("stat-stock-value").textContent = fmtVND(stockValue) + "đ";
  document.getElementById("stat-edited").textContent = Object.keys(EDITED).length;
}

// ── Save changes to KV ──────────────────────────────────
async function saveChanges() {
  if (!Object.keys(EDITED).length) return;
  var btn = document.getElementById("btn-save");
  btn.disabled = true; btn.textContent = "Đang lưu...";

  var items = [];
  for (var code in EDITED) {
    items.push(Object.assign({ code: code }, EDITED[code]));
  }

  try {
    var resp = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items }),
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    toast("Đã lưu " + data.updated + " SP thành công ✓", "success");
    EDITED = {};
    await loadInventory();
  } catch (e) {
    toast("Lỗi: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "💾 Lưu thay đổi";
  }
}

// ── Reset edits ─────────────────────────────────────────
function resetEdits() {
  if (!Object.keys(EDITED).length) return;
  if (!confirm("Hoàn tác " + Object.keys(EDITED).length + " thay đổi chưa lưu?")) return;
  EDITED = {};
  renderTable();
  updateSaveBar();
}

// ── Import từ Misa ──────────────────────────────────────
async function importFromMisa() {
  if (!IS_ADMIN) { toast("Bạn không có quyền import", "error"); return; }
  if (!confirm("Đọc file Misa và thêm các SP MỚI vào kho?\n\n(SP đã có trong kho sẽ GIỮ NGUYÊN giá hiện tại)")) return;

  var btn = document.getElementById("btn-import");
  btn.disabled = true; btn.textContent = "Đang import...";

  try {
    var resp = await fetch("/api/inventory/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    toast("Import xong: thêm mới " + data.added + " SP, giữ nguyên " + data.kept + " SP", "success");
    await loadInventory();
  } catch (e) {
    toast("Lỗi import: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "📥 Import từ Misa";
  }
}

// ── Add SP mới thủ công ─────────────────────────────────
async function addProduct() {
  if (!IS_ADMIN) { toast("Bạn không có quyền thêm SP", "error"); return; }
  var code = prompt("Mã sản phẩm (ví dụ: D11, NOMA 999):");
  if (!code) return;
  code = code.trim().toLowerCase();
  var name = prompt("Tên đầy đủ:") || code;
  var giaNhap = prompt("Giá nhập (VND, chỉ số):", "0");
  var giaBan = prompt("Giá bán (VND, chỉ số):", "0");
  var ton = prompt("Số lượng tồn kho:", "0");

  try {
    var resp = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        add: true, code: code,
        ten_day_du: name,
        gia_nhap_vnd: giaNhap, gia_ban_vnd: giaBan, ton_kho: ton,
        trang_thai: "Đang kinh doanh",
      }),
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    toast("Đã thêm SP " + code, "success");
    await loadInventory();
  } catch (e) {
    toast("Lỗi: " + e.message, "error");
  }
}

// ── Init ────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", function() {
  document.getElementById("btn-save").addEventListener("click", saveChanges);
  document.getElementById("btn-reset").addEventListener("click", resetEdits);
  document.getElementById("btn-import").addEventListener("click", importFromMisa);
  document.getElementById("btn-add").addEventListener("click", addProduct);
  document.getElementById("search-input").addEventListener("input", function() { renderTable(); });
  document.getElementById("filter-status").addEventListener("change", function() { renderTable(); });
  document.getElementById("filter-group").addEventListener("change", function() { renderTable(); });

  loadInventory();
});

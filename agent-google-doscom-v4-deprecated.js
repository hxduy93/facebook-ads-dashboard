// Agent Google Doscom v4.1 — Dynamic compute + custom date range (2026-04-24)
// Doanh thu: JS compute từ REVDATA.web_items_flat cho bất kỳ date range
// Chi phí:   JS compute từ GSPEND.campaigns_raw cho bất kỳ date range
// Không phụ thuộc period key có sẵn trong backend → hỗ trợ custom
console.log("[AgentPage] JS v4.1 loaded");
var REPORT=null, REVDATA=null, GACTX=null, GSPEND=null, INVENTORY_KV=null, currentCat=null, selectedPeriod="last_30d", sortStates={};
var customStart=null, customEnd=null;

// 9 nhóm chuẩn Doscom (thứ tự hiển thị)
var CAT_ORDER = [
  {key:"MAY_DO",            label:"Máy dò"},
  {key:"CAMERA_WIFI",       label:"Camera wifi"},
  {key:"CAMERA_4G",         label:"Camera 4G"},
  {key:"CAMERA_VIDEO_CALL", label:"Camera gọi video 2 chiều"},
  {key:"GHI_AM",            label:"Máy ghi âm"},
  {key:"CHONG_GHI_AM",      label:"Chống ghi âm"},
  {key:"DINH_VI",           label:"Định vị"},
  {key:"NOMA",              label:"NOMA"},
  {key:"OTHER",             label:"Khác"},
];
var REC_VN={"KEEP":"Giữ nguyên","SCALE":"Tăng bid","ADD_NEGATIVE":"Thêm negative","PAUSE":"Tạm dừng","REPLACE":"Thay banner","REVIEW":"Xem lại","MONITOR":"Theo dõi","UU_TIEN":"Ưu tiên","THEO_DOI":"Theo dõi","CAI_THIEN":"Cải thiện","GIU":"Giữ","NEN_LOAI_TRU":"Nên loại trừ"};
var MATCH_VN={"BROAD":"Rộng","EXACT":"Chính xác","PHRASE":"Cụm","NEAR_PHRASE":"Gần cụm","UNKNOWN":"-"};
var STATUS_VN={"NONE":"Chưa xử lý","ADDED":"Đã thêm","EXCLUDED":"Đã loại trừ"};

function fmtVND(n){if(n==null||n===0)return "0";if(Math.abs(n)>=1e6)return (n/1e6).toFixed(1)+"tr";if(Math.abs(n)>=1e3)return (n/1e3).toFixed(0)+"K";return Math.round(n).toLocaleString("vi-VN")}
function fmtInt(n){return n==null?"-":n.toLocaleString("vi-VN")}
function fmtPct(n,d){if(d==null)d=2;return n==null?"-":(n*100).toFixed(d)+"%"}
function fmtChange(pct){if(pct==null)return '<span class="text-gray">-</span>';var cls=pct>0?"text-green":(pct<0?"text-red":"text-gray");var s=pct>0?"+":"";var a=pct>0?"▲":(pct<0?"▼":"●");return '<span class="'+cls+' font-bold">'+a+" "+s+pct.toFixed(1)+"%</span>"}
function esc(s){if(s==null)return "";return String(s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split("\"").join("&quot;")}
function mdBold(s){return esc(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")}
function trn(s,d){if(!s)return "-";return s.split("/").map(function(p){return d[p]||p}).join(" / ")}

function sortTable(tblId, colIdx, type){
  var tbl=document.getElementById(tblId);
  if(!tbl) return;
  var tbody=tbl.querySelector("tbody");
  var rows=Array.prototype.slice.call(tbody.querySelectorAll("tr"));
  var key=tblId+"_"+colIdx;
  var asc=sortStates[key]!=="asc";
  sortStates[key]=asc?"asc":"desc";
  rows.sort(function(a,b){
    var av=a.cells[colIdx]?a.cells[colIdx].innerText.trim():"";
    var bv=b.cells[colIdx]?b.cells[colIdx].innerText.trim():"";
    if(type==="num"){
      var an=parseFloat(av.replace(/[^\d.-]/g,""))||0;
      var bn=parseFloat(bv.replace(/[^\d.-]/g,""))||0;
      return asc?an-bn:bn-an;
    }
    return asc?av.localeCompare(bv,"vi"):bv.localeCompare(av,"vi");
  });
  for(var i=0;i<rows.length;i++)tbody.appendChild(rows[i]);
  // Update arrow on headers
  var heads=tbl.querySelectorAll("th");
  for(var j=0;j<heads.length;j++){heads[j].innerHTML=heads[j].innerHTML.replace(/ [▲▼]$/,"")}
  if(heads[colIdx]) heads[colIdx].innerHTML+=asc?" ▲":" ▼";
}

function load(){
  // Fetch 4 file: daily-report (AI) + product-revenue (POS) + google-ads-context + google-ads-spend (raw)
  var v = Date.now();
  var p1 = fetch("data/google-ads-daily-report.json?v="+v).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status+" daily-report"); return r.json();});
  var p2 = fetch("data/product-revenue.json?v="+v).then(function(r){if(!r.ok)return null; return r.json();}).catch(function(){return null;});
  var p3 = fetch("data/google-ads-context.json?v="+v).then(function(r){if(!r.ok)return null; return r.json();}).catch(function(){return null;});
  var p4 = fetch("data/google-ads-spend.json?v="+v).then(function(r){if(!r.ok)return null; return r.json();}).catch(function(){return null;});
  // Inventory KV (giá user đã sửa thủ công, ưu tiên hơn Misa)
  var p6 = fetch("/api/inventory?v="+v).then(function(r){if(!r.ok)return null; return r.json();}).catch(function(){return null;});
  Promise.all([p1,p2,p3,p4,p6]).then(function(results){
    REPORT=results[0];
    REVDATA=results[1];
    GACTX=results[2];
    GSPEND=results[3];
    INVENTORY_KV=results[4];  // {items: [{code, gia_nhap_vnd, gia_ban_vnd, ton_kho, trang_thai}]}
    // Build map nhanh code → item từ KV
    if(INVENTORY_KV && INVENTORY_KV.items){
      window.__INV_MAP = {};
      for(var i=0;i<INVENTORY_KV.items.length;i++){
        window.__INV_MAP[INVENTORY_KV.items[i].code.toLowerCase()] = INVENTORY_KV.items[i];
      }
    }
    try{render(REPORT);}catch(e){console.error(e);showError("Lỗi: "+e.message);}
  }).catch(function(e){showError("Không tải: "+esc(e.message));});
}

// ── Classify campaign (mirror Python classify_campaign_v2) ─────────────────
function classifyCampaign(name){
  if(!name) return "OTHER";
  var n = name.toLowerCase();
  if(n.indexOf("gọi 2 chiều")>=0 || n.indexOf("goi 2 chieu")>=0 || n.indexOf("2 chiều")>=0) return "CAMERA_VIDEO_CALL";
  if(n.indexOf("4g")>=0 || n.indexOf("nlmt")>=0 || n.indexOf("năng lượng")>=0) return "CAMERA_4G";
  if(n.indexOf("wifi")>=0 || n.indexOf("cam mini")>=0 || n.indexOf("camera mini")>=0) return "CAMERA_WIFI";
  if(n.indexOf("chống ghi âm")>=0 || n.indexOf("chong ghi am")>=0) return "CHONG_GHI_AM";
  if(n.indexOf("ghi âm")>=0 || n.indexOf("ghi am")>=0) return "GHI_AM";
  if(n.indexOf("dò nghe lén")>=0 || n.indexOf("do nghe len")>=0 || n.indexOf("máy dò")>=0 || n.indexOf("may do")>=0 || n.indexOf("tb dò")>=0) return "MAY_DO";
  var nStripped = n.replace("máy", "");
  if(n.indexOf("định vị")>=0 || n.indexOf("dinh vi")>=0 || n.indexOf("tbđv")>=0 || n.indexOf("tbdv")>=0
     || n.indexOf("gps")>=0 || n.indexOf("- đv")>=0 || n.indexOf("-đv")>=0 || nStripped.indexOf(" đv")>=0) return "DINH_VI";
  if(n.indexOf("noma")>=0) return "NOMA";
  return "OTHER";
}

// ── Dynamic compute từ flat items (web_items_flat) ────────────────────────
// items: [{d, oid, n, q, r, c}]
function computeBreakdownFromFlat(items, start, end){
  if(!items || !items.length) return null;
  var cats = {};
  for(var i=0;i<CAT_ORDER.length;i++){
    cats[CAT_ORDER[i].key] = {
      label: CAT_ORDER[i].label, revenue:0, orders:{}, units:0
    };
  }
  var totRev=0, totOrders={};
  for(var i=0;i<items.length;i++){
    var it = items[i];
    if(!(it.d >= start && it.d <= end)) continue;
    var c = cats[it.c] || cats.OTHER;
    c.revenue += it.r;
    c.orders[it.oid] = 1;
    c.units += it.q;
    totRev += it.r;
    totOrders[it.oid] = 1;
  }
  var out = {};
  for(var k in cats){
    var c = cats[k];
    out[k] = {label:c.label, revenue:Math.round(c.revenue), orders:Object.keys(c.orders).length, units:c.units};
  }
  return {total_revenue:Math.round(totRev), total_orders:Object.keys(totOrders).length, categories:out};
}

function computeTopFromFlat(items, start, end, topN){
  if(!items || !items.length) return null;
  var agg = {};
  var totRev=0, totOrders={};
  for(var i=0;i<items.length;i++){
    var it = items[i];
    if(!(it.d >= start && it.d <= end)) continue;
    if(!agg[it.n]) agg[it.n] = {product:it.n, revenue:0, orders:{}, units:0};
    agg[it.n].revenue += it.r;
    agg[it.n].orders[it.oid] = 1;
    agg[it.n].units += it.q;
    totRev += it.r;
    totOrders[it.oid] = 1;
  }
  var arr = [];
  for(var k in agg){ var a = agg[k]; arr.push({product:a.product, revenue:Math.round(a.revenue), orders:Object.keys(a.orders).length, units:a.units}); }
  arr.sort(function(a,b){return b.revenue - a.revenue;});
  return {total_revenue:Math.round(totRev), total_orders:Object.keys(totOrders).length, top_products:arr.slice(0, topN||50), all_products:arr};
}

// ── Lookup giá vốn từ Inventory KV (kho tổng dashboard) — KHÔNG còn fallback Misa ──
function lookupCost(productName){
  var n = (productName||"").toLowerCase().trim();
  if(!n) return 0;
  if(!window.__INV_MAP) return 0;

  // 1) Direct match (toàn tên SP)
  if(window.__INV_MAP[n] && window.__INV_MAP[n].gia_nhap_vnd) {
    return Number(window.__INV_MAP[n].gia_nhap_vnd)||0;
  }

  // 2) Match qua SKU prefix trong KV (vd "DR8" trong tên dài)
  var prefixPatterns = [/\bda\s*8\.1\s*pro\b/, /\bda\s*8\.1\b/, /\bda\d+(?:\.\d+)?(?:\s*pro)?\b/,
    /\bdr\d+(?:\s*plus|\s*pro)?\b/, /\bdv\d+(?:\s*pro|\s*mini|\.\d+)?\b/, /\bdt\d+\b/,
    /\bdi\d+(?:\s*pro|\s*plus)?\b/, /\bd\d+(?:\.\d+)?(?:\s*pro)?\b/, /\bnoma\s*\d+/];
  for(var pi=0;pi<prefixPatterns.length;pi++){
    var pm = n.match(prefixPatterns[pi]);
    if(pm){
      var pk = pm[0].replace(/\s+/g," ").trim();
      if(window.__INV_MAP[pk] && window.__INV_MAP[pk].gia_nhap_vnd){
        return Number(window.__INV_MAP[pk].gia_nhap_vnd)||0;
      }
    }
  }

  // 3) Substring match: tìm KV code nào là substring của n (dài nhất thắng)
  var bestKey=null, bestLen=0;
  for(var ck in window.__INV_MAP){
    if(ck.length>2 && n.indexOf(ck)>=0 && window.__INV_MAP[ck].gia_nhap_vnd){
      if(ck.length>bestLen){bestKey=ck; bestLen=ck.length;}
    }
  }
  if(bestKey) return Number(window.__INV_MAP[bestKey].gia_nhap_vnd)||0;

  return 0;
}

// ── Group flat items thành đơn hàng (group by order_id) ──
function groupOrders(items, start, end){
  if(!items || !items.length) return [];
  var map = {};
  for(var i=0;i<items.length;i++){
    var it = items[i];
    if(!(it.d >= start && it.d <= end)) continue;
    if(!map[it.oid]){
      map[it.oid] = {order_id: it.oid, date: it.d, items: [], revenue: 0, categories: {}};
    }
    map[it.oid].items.push({name: it.n, qty: it.q, revenue: it.r, category: it.c});
    map[it.oid].revenue += it.r;
    map[it.oid].categories[it.c] = 1;
  }
  var arr = [];
  for(var k in map) arr.push(map[k]);
  arr.sort(function(a,b){
    if(a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.order_id||0) - (a.order_id||0);
  });
  return arr;
}

// Compute spend breakdown 9 nhóm từ campaigns_raw (GSPEND)
function computeSpendFromRaw(rows, start, end){
  if(!rows || !rows.length) return null;
  var cats = {};
  for(var i=0;i<CAT_ORDER.length;i++){
    cats[CAT_ORDER[i].key] = {label:CAT_ORDER[i].label, spend:0, clicks:0, impressions:0, campaigns:{}};
  }
  var totSpend=0, totClicks=0, totImps=0;
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    var d = r.date || "";
    if(!(d >= start && d <= end)) continue;
    var cat = classifyCampaign(r.campaign || "");
    var s = Number(r.spend||0), c = Number(r.clicks||0), im = Number(r.impressions||0);
    cats[cat].spend += s; cats[cat].clicks += c; cats[cat].impressions += im;
    cats[cat].campaigns[r.campaign || ""] = 1;
    totSpend += s; totClicks += c; totImps += im;
  }
  var out = {};
  for(var k in cats){
    var c = cats[k];
    var ctr = c.impressions>0 ? c.clicks/c.impressions : 0;
    var cpc = c.clicks>0 ? c.spend/c.clicks : 0;
    out[k] = {
      label: c.label, spend:Math.round(c.spend), clicks:c.clicks, impressions:c.impressions,
      ctr:ctr, cpc:Math.round(cpc), campaigns_count: Object.keys(c.campaigns).length,
    };
  }
  return {total_spend:Math.round(totSpend), total_clicks:totClicks, total_impressions:totImps, categories:out};
}

// ── Helpers POS-direct ──────────────────────────────────────
// Parse "2026-04-23 04:41 UTC" → Date UTC. Trả null nếu fail.
function parseGenAtUTC(s){
  if(!s) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+UTC$/.exec(s);
  if(!m) return null;
  return new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]));
}
function fmtVNDateTime(d){ // Date → "DD/MM HH:mm VN"
  if(!d) return "-";
  var vn = new Date(d.getTime() + 7*3600000);
  var pad = function(n){return n<10?"0"+n:""+n;};
  return pad(vn.getUTCDate())+"/"+pad(vn.getUTCMonth()+1)+" "+pad(vn.getUTCHours())+":"+pad(vn.getUTCMinutes())+" VN";
}
function toVNDateStr(d){ // Date → YYYY-MM-DD theo VN
  var vn = new Date(d.getTime() + 7*3600000);
  var pad = function(n){return n<10?"0"+n:""+n;};
  return vn.getUTCFullYear()+"-"+pad(vn.getUTCMonth()+1)+"-"+pad(vn.getUTCDate());
}
function vnDateNow(){
  return toVNDateStr(new Date());
}
function vnDateShift(daysDelta){
  // shift từ hôm nay (VN) ± daysDelta ngày
  var today = vnDateNow().split("-");
  var base = new Date(Date.UTC(+today[0],+today[1]-1,+today[2]));
  base.setUTCDate(base.getUTCDate()+daysDelta);
  var pad = function(n){return n<10?"0"+n:""+n;};
  return base.getUTCFullYear()+"-"+pad(base.getUTCMonth()+1)+"-"+pad(base.getUTCDate());
}
// Compute date_range DYNAMIC cho mỗi period, theo ngày VN hiện tại
// KHÔNG dựa vào daily-report.json (file đó có thể gen 1-2 ngày trước → sai ngày)
function computePeriodDates(key){
  var today = vnDateNow();  // YYYY-MM-DD
  var parts = today.split("-").map(Number);
  var y = parts[0], m = parts[1], d = parts[2];
  var base = new Date(Date.UTC(y, m-1, d));
  var pad = function(n){ return n<10?"0"+n:""+n; };
  function toStr(dt){ return dt.getUTCFullYear()+"-"+pad(dt.getUTCMonth()+1)+"-"+pad(dt.getUTCDate()); }
  function shift(n){ var x=new Date(base); x.setUTCDate(x.getUTCDate()+n); return toStr(x); }
  function mondayThisWeek(){
    var dow = base.getUTCDay();   // 0=Sun, 1=Mon, ..., 6=Sat
    var diff = (dow === 0) ? -6 : (1 - dow);
    return shift(diff);
  }
  function firstOfMonth(){ return y+"-"+pad(m)+"-01"; }
  function lastDayPrevMonth(){ var x=new Date(Date.UTC(y,m-1,0)); return toStr(x); }
  function firstOfPrevMonth(){ var x=new Date(Date.UTC(y,m-1,0)); return x.getUTCFullYear()+"-"+pad(x.getUTCMonth()+1)+"-01"; }

  switch(key){
    case "today":      return {start: today,              end: today};
    case "yesterday":  return {start: shift(-1),          end: shift(-1)};
    case "this_week":  return {start: mondayThisWeek(),   end: today};
    case "last_week":  {
      var mon = mondayThisWeek().split("-").map(Number);
      var mp = new Date(Date.UTC(mon[0], mon[1]-1, mon[2])); mp.setUTCDate(mp.getUTCDate()-7);
      var sp = new Date(mp); sp.setUTCDate(sp.getUTCDate()+6);
      return {start: toStr(mp), end: toStr(sp)};
    }
    case "this_month": return {start: firstOfMonth(),     end: today};
    case "last_month": return {start: firstOfPrevMonth(), end: lastDayPrevMonth()};
    case "last_7d":    return {start: shift(-6),          end: today};
    case "last_30d":   return {start: shift(-29),         end: today};
    case "last_90d":   return {start: shift(-89),         end: today};
    case "custom":     return {start: customStart || shift(-29), end: customEnd || today};
    default:           return {start: today,              end: today};
  }
}

function changeCustomDate(which, val){
  if(which === "start") customStart = val;
  else customEnd = val;
  if(selectedPeriod === "custom") renderTimeFilterSection(REPORT);
}

// Compute revenue cho 3 nguồn Web+Zalo+Hotline, range [start,end]
// 2026-04-24: LẤY TẤT CẢ status (không exclude hoàn/huỷ — bộ phận khác xử lý)
function computePosRevenue(rev, start, end){
  if(!rev || !rev.source_groups) return null;
  var SRC=["WEBSITE","ZALO_OA","HOTLINE"];
  var INCL=["delivered","returning","returned","canceled","other"];
  var total_r=0, total_o=0, bySrc={};
  for(var si=0; si<SRC.length; si++){
    var s=SRC[si], src=rev.source_groups[s]||{};
    var rsbd=src.order_revenue_by_status_by_date||{}, cbsd=src.order_count_by_status_by_date||{};
    var sr=0, so=0;
    for(var ii=0; ii<INCL.length; ii++){
      var st=INCL[ii];
      var rb=rsbd[st]||{}, cb=cbsd[st]||{};
      for(var d in rb) if(d>=start && d<=end){sr+=rb[d]; total_r+=rb[d];}
      for(var d2 in cb) if(d2>=start && d2<=end){so+=cb[d2]; total_o+=cb[d2];}
    }
    bySrc[s]={revenue:Math.round(sr), orders:so, label:src.label||s};
  }
  return {revenue:Math.round(total_r), orders:total_o, bySrc:bySrc};
}

function showError(m){document.getElementById("main").innerHTML='<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2"><h3 style="color:#991b1b">Lỗi</h3><div>'+m+'</div></div>';}

function scrollToEl(id){var el=document.getElementById(id);if(!el)return;el.scrollIntoView({behavior:"smooth",block:"start"});el.classList.add("highlight-bg");setTimeout(function(){el.classList.remove("highlight-bg");},2000);}

function switchCat(key,ev){
  currentCat=key;
  var tabs=document.querySelectorAll(".cat-tab");
  for(var i=0;i<tabs.length;i++)tabs[i].classList.remove("active");
  if(ev&&ev.target)ev.target.classList.add("active");
  // v4.1: ưu tiên merged cats (9 nhóm), fallback REPORT.categories
  var cat = (window.__CATS_MERGED && window.__CATS_MERGED[key]) || (REPORT.categories && REPORT.categories[key]) || {};
  document.getElementById("cat-content").innerHTML=renderCategory(cat,key);
}

function changePeriod(k){selectedPeriod=k;renderTimeFilterSection(REPORT);}

function compareFn(c,p){function pct(a,b){if(!b)return null;return (a-b)/b*100;}return{spend:pct(c.totals.spend,p.totals.spend),clicks:pct(c.totals.clicks,p.totals.clicks),ctr:pct(c.totals.ctr,p.totals.ctr),revenue:pct(c.totals.revenue,p.totals.revenue),orders:pct(c.totals.orders,p.totals.orders),roas:pct(c.totals.roas,p.totals.roas)};}


function _removedRenderYesterdayPanel_placeholder(r, rev){
  // [REMOVED 2026-04-23] User feedback: bỏ panel "Đánh giá doanh thu hôm qua",
  // merge data vào bộ lọc thời gian bên dưới để tránh trùng lặp. Xem git history.
  var yStr = vnDateShift(-1);
  var pStr = vnDateShift(-2); // hôm kia để so sánh

  // Data Pancake POS
  var cur = rev ? computePosRevenue(rev, yStr, yStr) : null;
  var prv = rev ? computePosRevenue(rev, pStr, pStr) : null;

  // Data Google Ads spend hôm qua từ daily-report.time_periods.yesterday
  // (Lưu ý: `today` trong daily-report đôi khi map với "hôm qua" vì report gen sáng — ưu tiên key yesterday)
  var tp = r.time_periods || {};
  var spendY = null, spendP = null;
  if(tp.yesterday && tp.yesterday.totals) spendY = tp.yesterday.totals.spend;
  // Không có "day_before_yesterday" — bỏ compare spend (chỉ hiển thị số)

  // Top SP hôm qua từ field mới top_products_website_by_period
  var topY = null;
  if(rev && rev.top_products_website_by_period && rev.top_products_website_by_period.yesterday){
    topY = rev.top_products_website_by_period.yesterday;
  }

  // Freshness guard: compare generated_at với 17:30 VN hôm qua
  var genDt = rev ? parseGenAtUTC(rev.generated_at) : null;
  var isStale = false, staleNote = "";
  if(genDt){
    // 17:30 VN hôm qua = UTC 10:30 của hôm qua
    var ym = yStr.split("-");
    var yStop = new Date(Date.UTC(+ym[0],+ym[1]-1,+ym[2], 10, 30));
    if(genDt < yStop){
      isStale = true;
      staleNote = "Dữ liệu POS cập nhật lúc "+fmtVNDateTime(genDt)+" — cron fetch có thể bị gián đoạn. Số hôm qua có thể chưa đủ.";
    }
  }

  function pct(a,b){ if(!b||b===0) return null; return (a-b)/b*100; }

  var h='<section class="block card" style="border-left:4px solid #2563eb;background:#eff6ff">';
  h+='<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;flex-wrap:wrap;gap:8px">';
  h+='<h2 style="margin:0">Đánh giá doanh thu hôm qua <span style="font-size:13px;font-weight:500;color:#6b7280">('+esc(yStr)+')</span></h2>';
  h+='<span class="text-xs text-gray">Nguồn: 3 filter POS — Website + Zalo OA + Hotline (loại DUY / PN staff)</span>';
  h+='</div>';

  if(!rev){
    h+='<div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;padding:10px 12px;font-size:12px;color:#7f1d1d">';
    h+='<strong>⚠ Không tải được product-revenue.json</strong> — panel này sẽ hiển thị khi cron fetch Pancake chạy xong.';
    h+='</div></section>';
    return h;
  }
  if(isStale){
    h+='<div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:12px">';
    h+='<strong>⚠ Dữ liệu POS trễ:</strong> '+esc(staleNote);
    h+='</div>';
  }

  // 4 card metric
  var revCh = (cur && prv) ? pct(cur.revenue, prv.revenue) : null;
  var ordCh = (cur && prv) ? pct(cur.orders, prv.orders) : null;
  var roas = (spendY && spendY>0 && cur) ? (cur.revenue/spendY) : null;
  var roasCls = roas==null ? "text-gray" : (roas>=3 ? "text-green" : (roas>=1 ? "" : "text-red"));

  function mb(label, val, chg, extra){
    return '<div style="background:white;border-radius:6px;padding:10px;border:1px solid #e5e7eb">'+
      '<div style="font-size:10px;color:#6b7280;text-transform:uppercase">'+label+'</div>'+
      '<div style="font-size:20px;font-weight:700;margin-top:4px'+(extra?' '+extra:'')+'">'+val+'</div>'+
      (chg?'<div style="font-size:11px;margin-top:2px">'+chg+' vs hôm kia</div>':'')+
      '</div>';
  }
  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
  h+=mb("Doanh thu hôm qua", cur?fmtVND(cur.revenue)+'đ':'-', cur && prv?fmtChange(revCh):null);
  h+=mb("Số đơn",            cur?fmtInt(cur.orders):'-',       cur && prv?fmtChange(ordCh):null);
  h+=mb("Chi Google Ads",    spendY==null?'-':fmtVND(spendY)+'đ', null);
  h+=mb("ROAS hôm qua",      roas==null?'-':roas.toFixed(2)+'x', '<span class="text-xs text-gray">Target 3x</span>', roasCls);
  h+='</div>';

  // Breakdown 3 nguồn
  if(cur){
    h+='<div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:10px;font-size:12px">';
    h+='<strong>Breakdown 3 nguồn:</strong> ';
    var srcDisplay=[["WEBSITE","Website"],["ZALO_OA","Zalo OA"],["HOTLINE","Hotline"]];
    var parts=[];
    for(var si=0;si<srcDisplay.length;si++){
      var k=srcDisplay[si][0], lb=srcDisplay[si][1], b=cur.bySrc[k]||{revenue:0,orders:0};
      parts.push(lb+': <strong>'+fmtVND(b.revenue)+'đ</strong> / <strong>'+b.orders+'</strong> đơn');
    }
    h+=parts.join(' · ');
    h+='</div>';
  }

  // Top SP hôm qua (tất cả SKU, không filter MAPPING)
  if(topY && topY.top_products && topY.top_products.length){
    h+='<div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px">';
    h+='<div style="font-size:12px;font-weight:600;margin-bottom:6px">Top sản phẩm hôm qua ('+topY.top_products.length+' SP)</div>';
    h+='<div class="tbl-wrap"><table class="compact-tbl"><thead><tr><th>#</th><th>Sản phẩm</th><th class="t-right">Doanh thu</th><th class="t-right">Đơn</th><th class="t-right">SL</th></tr></thead><tbody>';
    for(var ti=0;ti<topY.top_products.length;ti++){
      var p=topY.top_products[ti];
      h+='<tr><td class="text-gray">'+(ti+1)+'</td>';
      h+='<td class="text-xs"><span class="truncate" title="'+esc(p.product)+'" style="max-width:380px;display:inline-block">'+esc(p.product)+'</span></td>';
      h+='<td class="t-right text-green font-bold">'+fmtVND(p.revenue)+'đ</td>';
      h+='<td class="t-right">'+p.orders+'</td>';
      h+='<td class="t-right text-xs text-gray">'+p.units+'</td></tr>';
    }
    h+='</tbody></table></div></div>';
  }

  // Footer freshness
  h+='<p class="text-xs text-gray" style="margin:0">Dữ liệu POS cập nhật lúc <strong>'+esc(genDt?fmtVNDateTime(genDt):rev.generated_at||'-')+'</strong>. ';
  h+='Cron fetch mỗi 30 phút từ 09:00-17:30 VN. Chi Google Ads lấy từ JSON agent (kỳ '+esc((r.period||{}).start||'-')+' → '+esc((r.period||{}).end||'-')+').</p>';
  h+='</section>';
  return h;
}

function renderProductRanking(){
  if(!REPORT) return;
  var tp = REPORT.time_periods || {};
  var cur = tp[selectedPeriod];
  var prev = (cur && cur.compare_to) ? tp[cur.compare_to] : null;
  // Dynamic date range cho period hiện tại
  var curDates = computePeriodDates(selectedPeriod);
  var labelMap = {today:"Hôm nay",yesterday:"Hôm qua",this_week:"Tuần này",last_week:"Tuần trước",this_month:"Tháng này",last_month:"Tháng trước",last_7d:"7 ngày qua",last_30d:"30 ngày qua",last_90d:"90 ngày qua"};
  var curLabel = (cur && cur.label) || labelMap[selectedPeriod] || selectedPeriod;
  var prevLabel = (prev && prev.label) || (cur && cur.compare_to ? labelMap[cur.compare_to] : null);

  // v4.1: DYNAMIC compute từ flat items cho BẤT KỲ date range (kể cả custom)
  var tp_prods = [];
  if(REVDATA && REVDATA.web_items_flat){
    var dynTop = computeTopFromFlat(REVDATA.web_items_flat, curDates.start, curDates.end, 50);
    tp_prods = dynTop ? dynTop.top_products : [];
  }
  if(!tp_prods.length && REVDATA && REVDATA.top_products_website_by_period && REVDATA.top_products_website_by_period[selectedPeriod]){
    tp_prods = REVDATA.top_products_website_by_period[selectedPeriod].top_products || [];
  }
  if(!tp_prods.length){
    tp_prods = (cur && cur.top_products) || [];
  }
  // Map prev for compare
  var prev_map = {};
  if(prev && prev.top_products){ for(var pi=0;pi<prev.top_products.length;pi++) prev_map[prev.top_products[pi].product] = prev.top_products[pi]; }
  // Map category cho prod
  var catMap = {};
  (REPORT.products_ranking || []).forEach(function(p){ catMap[p.product] = p.category_name; });

  var h = '<h2>Xếp hạng Sản phẩm theo Doanh thu — Kỳ: '+esc(curLabel)+' ('+esc(curDates.start)+' → '+esc(curDates.end)+')</h2>';
  h += '<p class="text-xs text-gray" style="margin-bottom:6px">Nguồn: Website + Hotline + Zalo OA (loại DUY/PN staff). Thay đổi bộ lọc thời gian ở trên để xem kỳ khác.</p>';
  h += '<div class="tbl-wrap"><table id="tbl-prod"><thead><tr>';
  h += '<th>#</th><th>Sản phẩm</th><th>Nhóm</th><th class="t-right">Doanh thu</th>';
  h += '<th class="t-right">Đơn</th><th class="t-right">AOV</th>';
  if(prev) h += '<th class="t-right">Δ Doanh thu vs '+esc(prevLabel||'-')+'</th>';
  h += '</tr></thead><tbody>';
  for(var pi=0;pi<tp_prods.length;pi++){
    var p = tp_prods[pi];
    var pr_prev = prev_map[p.product];
    var ch = (pr_prev && pr_prev.revenue) ? ((p.revenue - pr_prev.revenue) / pr_prev.revenue * 100) : null;
    var aov = p.orders > 0 ? (p.revenue / p.orders) : 0;
    h += '<tr><td class="text-gray">'+(pi+1)+'</td>';
    h += '<td class="font-bold">'+esc(p.product)+'</td>';
    h += '<td><span class="pill">'+esc(catMap[p.product] || '-')+'</span></td>';
    h += '<td class="t-right text-green font-bold">'+fmtVND(p.revenue)+'đ</td>';
    h += '<td class="t-right">'+fmtInt(p.orders)+'</td>';
    h += '<td class="t-right text-xs text-gray">'+fmtVND(aov)+'đ</td>';
    if(prev) h += '<td class="t-right">'+fmtChange(ch)+'</td>';
    h += '</tr>';
  }
  if(!tp_prods.length) h += '<tr><td colspan="7" class="text-gray" style="text-align:center">Không có đơn hàng trong kỳ này.</td></tr>';
  h += '</tbody></table></div>';
  var container = document.getElementById('product-ranking-container');
  if(container) container.innerHTML = h;
}

function renderTimeFilterSection(r){
  var tp=r.time_periods||{};
  var cur=tp[selectedPeriod] || null;   // có thể null nếu daily-report thiếu period
  var prev=(cur && cur.compare_to) ? tp[cur.compare_to] : null;
  var cmp=(prev && cur)?compareFn(cur,prev):null;

  // ── Compute date_range DYNAMIC từ ngày VN hiện tại (không dựa vào daily-report cũ) ──
  // Fix bug: daily-report gen 22/04 → date_range trong đó bị lệch 1-2 ngày
  var curDates  = computePeriodDates(selectedPeriod);
  var prevDates = (cur && cur.compare_to) ? computePeriodDates(cur.compare_to) : null;

  // ── POS-direct revenue/orders cho period hiện tại (3 nguồn Web+Zalo+Hotline) ──
  var posCur  = REVDATA ? computePosRevenue(REVDATA, curDates.start, curDates.end) : null;
  var posPrev = (REVDATA && prevDates) ? computePosRevenue(REVDATA, prevDates.start, prevDates.end) : null;

  // Labels cho dropdown (từ daily-report nếu có, fallback hard-code)
  var labelMap = {
    today: "Hôm nay", yesterday: "Hôm qua",
    this_week: "Tuần này", last_week: "Tuần trước",
    this_month: "Tháng này", last_month: "Tháng trước",
    last_7d: "7 ngày qua", last_30d: "30 ngày qua", last_90d: "90 ngày qua",
  };

  var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
  h+='<h2 style="font-size:16px;font-weight:700">Bộ lọc thời gian</h2>';
  h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
  h+='<select onchange="changePeriod(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:white">';
  var ks=["today","yesterday","this_week","last_week","this_month","last_month","last_7d","last_30d","last_90d","custom"];
  var labelMap2 = Object.assign({}, labelMap, {custom: "Tuỳ chỉnh…"});
  for(var i=0;i<ks.length;i++){
    var sel=ks[i]===selectedPeriod?" selected":"";
    var lbl=(tp[ks[i]] && tp[ks[i]].label) || labelMap2[ks[i]] || ks[i];
    h+='<option value="'+ks[i]+'"'+sel+'>'+esc(lbl)+'</option>';
  }
  h+='</select>';
  // Khi chọn custom — show 2 date inputs
  if(selectedPeriod === "custom"){
    h+='<span class="text-xs text-gray">Từ</span>';
    h+='<input type="date" value="'+esc(customStart||curDates.start)+'" onchange="changeCustomDate(\'start\', this.value)" style="padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px">';
    h+='<span class="text-xs text-gray">Đến</span>';
    h+='<input type="date" value="'+esc(customEnd||curDates.end)+'" onchange="changeCustomDate(\'end\', this.value)" style="padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px">';
  }
  h+='</div></div>';
  var prevLbl = (cur && cur.compare_to) ? ((tp[cur.compare_to] && tp[cur.compare_to].label) || labelMap[cur.compare_to]) : null;
  h+='<p class="text-xs text-gray" style="margin-bottom:12px">Kỳ: <strong>'+esc(curDates.start)+' → '+esc(curDates.end)+'</strong>';
  if(prevDates && prevLbl) h+=' · So sánh với <strong>'+esc(prevLbl)+'</strong> ('+esc(prevDates.start)+' → '+esc(prevDates.end)+')';
  h+='</p>';

  // Fallback cho totals nếu daily-report thiếu period
  var t = (cur && cur.totals) ? cur.totals : {spend:0,clicks:0,impressions:0,ctr:0,cpc:0,revenue:0,orders:0,roas:0};
  // Ưu tiên spend từ GACTX spend_breakdown_by_period nếu có (nhưng date_range trong đó có thể cũ → không dùng)
  var effRevenue = posCur ? posCur.revenue : (t.revenue||0);
  var effOrders  = posCur ? posCur.orders  : (t.orders||0);
  var effRoas    = (t.spend && t.spend > 0) ? (effRevenue / t.spend) : 0;

  // Override cmp revenue/orders/roas theo POS nếu có
  if(cmp && posCur && posPrev && prev){
    function _pct(a,b){ if(!b||b===0) return null; return (a-b)/b*100; }
    var prevT = prev.totals || {spend:0};
    var prevRoas = (prevT.spend && prevT.spend > 0) ? (posPrev.revenue / prevT.spend) : 0;
    cmp.revenue = _pct(effRevenue, posPrev.revenue);
    cmp.orders  = _pct(effOrders,  posPrev.orders);
    cmp.roas    = _pct(effRoas,    prevRoas);
  }

  h+='<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">';
  function mb(l,v,c){return '<div style="background:#f9fafb;border-radius:6px;padding:10px"><div style="font-size:10px;color:#6b7280;text-transform:uppercase">'+l+'</div><div style="font-size:18px;font-weight:700;margin-top:4px">'+v+'</div>'+(c?'<div style="font-size:11px;margin-top:2px">'+c+'</div>':'')+'</div>';}
  h+=mb("Chi phí ads",fmtVND(t.spend)+'đ',cmp?fmtChange(cmp.spend):'');
  h+=mb("Click",fmtInt(t.clicks),cmp?fmtChange(cmp.clicks):'');
  h+=mb("CTR",fmtPct(t.ctr),cmp?fmtChange(cmp.ctr):'');
  h+=mb("Doanh thu",fmtVND(effRevenue)+'đ',cmp?fmtChange(cmp.revenue):'');
  h+=mb("Đơn hàng",fmtInt(effOrders),cmp?fmtChange(cmp.orders):'');
  h+=mb("ROAS",effRoas.toFixed(2)+'x',cmp?fmtChange(cmp.roas):'');
  h+='</div>';

  // Breakdown 3 nguồn (POS) — giúp trace khi có gap
  if(posCur){
    h+='<div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-top:8px;font-size:12px">';
    h+='<strong>Breakdown 3 nguồn POS:</strong> ';
    var srcDisplay=[["WEBSITE","Website"],["ZALO_OA","Zalo OA"],["HOTLINE","Hotline"]];
    var parts=[];
    for(var si=0;si<srcDisplay.length;si++){
      var skey=srcDisplay[si][0], lb=srcDisplay[si][1], b=posCur.bySrc[skey]||{revenue:0,orders:0};
      parts.push(lb+': <strong>'+fmtVND(b.revenue)+'đ</strong> / <strong>'+b.orders+'</strong> đơn');
    }
    h+=parts.join(' · ');
    h+='</div>';
  }
  // ── Bảng "Phân chia theo nhóm SP trong kỳ" — v4.1 DYNAMIC compute ──
  // Ưu tiên compute từ REVDATA.web_items_flat và GSPEND.campaigns_raw cho BẤT KỲ date range
  // Fallback về pre-computed period nếu flat data thiếu
  var revBreak = null, spendBreak = null;
  if(REVDATA && REVDATA.web_items_flat){
    revBreak = computeBreakdownFromFlat(REVDATA.web_items_flat, curDates.start, curDates.end);
  }
  if(!revBreak && REVDATA && REVDATA.category_breakdown_by_period){
    revBreak = REVDATA.category_breakdown_by_period[selectedPeriod];
  }
  if(GSPEND && GSPEND.campaigns_raw){
    spendBreak = computeSpendFromRaw(GSPEND.campaigns_raw, curDates.start, curDates.end);
  }
  if(!spendBreak && GACTX && GACTX.spend_breakdown_by_period){
    spendBreak = GACTX.spend_breakdown_by_period[selectedPeriod];
  }
  // ── Tính ads_avg per category: chi phí QC nhóm / số đơn thuộc nhóm ──
  var adsAvgPerCat = {};
  for(var ci=0;ci<CAT_ORDER.length;ci++){
    var k = CAT_ORDER[ci].key;
    var rc = revBreak && revBreak.categories ? revBreak.categories[k] : null;
    var sc = spendBreak && spendBreak.categories ? spendBreak.categories[k] : null;
    var ord = rc ? rc.orders : 0;
    var spd = sc ? sc.spend : 0;
    adsAvgPerCat[k] = ord > 0 ? spd / ord : 0;
  }

  // ── Compute giá vốn + lợi nhuận per category (dùng flat items) ──
  var catProfitMap = {};  // {cat: {cost, ads, profit}}
  for(var ci=0;ci<CAT_ORDER.length;ci++){ catProfitMap[CAT_ORDER[ci].key] = {cost:0, ads:0, profit:0}; }
  if(REVDATA && REVDATA.web_items_flat){
    var flat = REVDATA.web_items_flat;
    for(var i=0;i<flat.length;i++){
      var it = flat[i];
      if(!(it.d >= curDates.start && it.d <= curDates.end)) continue;
      var c = it.c || "OTHER";
      if(!catProfitMap[c]) catProfitMap[c] = {cost:0, ads:0, profit:0};
      catProfitMap[c].cost += lookupCost(it.n) * it.q;
    }
  }
  // Ads per category = ads_avg × số đơn nhóm (chính là tổng spend vì avg = spend/orders)
  // 2026-04-24: Lợi nhuận = Doanh thu − VAT 10% − Giá vốn − Chi phí QC
  var VAT_RATE = 0.10;
  for(var ci=0;ci<CAT_ORDER.length;ci++){
    var k = CAT_ORDER[ci].key;
    var sc = spendBreak && spendBreak.categories ? spendBreak.categories[k] : null;
    catProfitMap[k].ads = sc ? sc.spend : 0;
    var rc = revBreak && revBreak.categories ? revBreak.categories[k] : null;
    var rev = rc ? rc.revenue : 0;
    catProfitMap[k].vat = rev * VAT_RATE;
    catProfitMap[k].profit = rev - catProfitMap[k].vat - catProfitMap[k].cost - catProfitMap[k].ads;
  }

  // ── Bảng Phân chia theo nhóm SP: thêm cột "% LN" + ngưỡng mục tiêu 30% ──
  // Lợi nhuận = Doanh thu − VAT 10% − Giá vốn − Chi phí QC
  // Mục tiêu Doscom: % LN / Doanh thu ≥ 30% (đạt) / 15-30% (cảnh báo) / <15% (thất bại)
  var TARGET_PROFIT_PCT = 30;  // mục tiêu biên lợi nhuận 30%
  if(revBreak || spendBreak){
    h+='<h3 style="margin-top:16px;margin-bottom:8px;font-size:13px">Phân chia theo nhóm sản phẩm trong kỳ <span class="text-xs text-gray">(Lợi nhuận = Doanh thu − VAT 10% − Giá vốn − Chi phí QC · Mục tiêu: ≥30% Doanh thu)</span></h3>';
    h+='<div class="tbl-wrap"><table><thead><tr><th>Nhóm SP</th>';
    h+='<th class="t-right">Chi phí QC</th><th class="t-right">Click</th><th class="t-right">CTR</th>';
    h+='<th class="t-right">Doanh thu</th><th class="t-right">Đơn</th><th class="t-right">SL</th>';
    h+='<th class="t-right">VAT 10%</th><th class="t-right">Giá vốn</th><th class="t-right">Lợi nhuận</th>';
    h+='<th class="t-right">% LN</th>';
    h+='<th class="t-right">ROAS</th></tr></thead><tbody>';
    var totSpend=0, totClicks=0, totImps=0, totRev=0, totOrders=0, totUnits=0, totVat=0, totCost=0, totProfit=0;
    for(var ci=0;ci<CAT_ORDER.length;ci++){
      var co=CAT_ORDER[ci];
      var rc=revBreak && revBreak.categories ? revBreak.categories[co.key] : null;
      var sc=spendBreak && spendBreak.categories ? spendBreak.categories[co.key] : null;
      var pc=catProfitMap[co.key] || {cost:0, ads:0, vat:0, profit:0};
      var spend = sc ? sc.spend : 0;
      var clicks= sc ? sc.clicks : 0;
      var imps  = sc ? sc.impressions : 0;
      var ctr   = imps>0 ? clicks/imps : 0;
      var rev   = rc ? rc.revenue : 0;
      var orders= rc ? rc.orders : 0;
      var units = rc ? rc.units : 0;
      var vat   = pc.vat;
      var cost  = pc.cost;
      var profit= pc.profit;
      var roas  = spend>0 ? rev/spend : 0;
      if(spend===0 && rev===0 && orders===0) continue;
      var roasCls = roas>=3 ? "text-green font-bold" : (roas>=1 ? "" : (roas>0 ? "text-red" : "text-gray"));
      // Tỷ lệ LN / Doanh thu — đánh giá theo mục tiêu 30%
      // Đạt: ≥30% / Cảnh báo: 15-30% / Cần cải thiện: 0-15% / Lỗ: <0%
      var pctLN = rev > 0 ? (profit / rev * 100) : 0;
      var pctCls, pctIcon;
      if (rev === 0) { pctCls = "text-gray"; pctIcon = ""; }
      else if (pctLN >= TARGET_PROFIT_PCT) { pctCls = "text-green font-bold"; pctIcon = "🟢 "; }
      else if (pctLN >= 15) { pctCls = "text-orange font-bold"; pctIcon = "🟡 "; }
      else if (pctLN >= 0) { pctCls = "text-red"; pctIcon = "🔴 "; }
      else { pctCls = "text-red font-bold"; pctIcon = "🔴 "; }
      var profCls = profit>0 ? "text-green font-bold" : (profit<0 ? "text-red font-bold" : "text-gray");
      h+='<tr><td class="font-bold">'+esc(co.label)+'</td>';
      h+='<td class="t-right">'+fmtVND(spend)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(clicks)+'</td>';
      h+='<td class="t-right">'+fmtPct(ctr)+'</td>';
      h+='<td class="t-right text-green">'+fmtVND(rev)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(orders)+'</td>';
      h+='<td class="t-right text-xs text-gray">'+fmtInt(units)+'</td>';
      h+='<td class="t-right text-xs text-gray">'+fmtVND(Math.round(vat))+'đ</td>';
      h+='<td class="t-right">'+(cost>0 ? fmtVND(cost)+'đ' : '-')+'</td>';
      h+='<td class="t-right '+profCls+'">'+fmtVND(Math.round(profit))+'đ</td>';
      h+='<td class="t-right '+pctCls+'">'+pctIcon+(rev>0 ? pctLN.toFixed(1)+'%' : '-')+'</td>';
      h+='<td class="t-right '+roasCls+'">'+(roas>0 ? roas.toFixed(2)+'x' : '-')+'</td>';
      h+='</tr>';
      totSpend+=spend; totClicks+=clicks; totImps+=imps; totRev+=rev; totOrders+=orders; totUnits+=units; totVat+=vat; totCost+=cost; totProfit+=profit;
    }
    var totCtr = totImps>0 ? totClicks/totImps : 0;
    var totRoas= totSpend>0 ? totRev/totSpend : 0;
    var totPctLN = totRev > 0 ? (totProfit / totRev * 100) : 0;
    var totPctCls, totPctIcon;
    if (totRev === 0) { totPctCls = "text-gray"; totPctIcon = ""; }
    else if (totPctLN >= TARGET_PROFIT_PCT) { totPctCls = "text-green font-bold"; totPctIcon = "🟢 "; }
    else if (totPctLN >= 15) { totPctCls = "text-orange font-bold"; totPctIcon = "🟡 "; }
    else if (totPctLN >= 0) { totPctCls = "text-red"; totPctIcon = "🔴 "; }
    else { totPctCls = "text-red font-bold"; totPctIcon = "🔴 "; }
    var totProfCls = totProfit>0 ? "text-green font-bold" : (totProfit<0 ? "text-red font-bold" : "");
    h+='<tr style="background:#f9fafb;font-weight:700"><td>TỔNG</td>';
    h+='<td class="t-right">'+fmtVND(totSpend)+'đ</td>';
    h+='<td class="t-right">'+fmtInt(totClicks)+'</td>';
    h+='<td class="t-right">'+fmtPct(totCtr)+'</td>';
    h+='<td class="t-right text-green">'+fmtVND(totRev)+'đ</td>';
    h+='<td class="t-right">'+fmtInt(totOrders)+'</td>';
    h+='<td class="t-right text-xs text-gray">'+fmtInt(totUnits)+'</td>';
    h+='<td class="t-right text-xs text-gray">'+fmtVND(Math.round(totVat))+'đ</td>';
    h+='<td class="t-right">'+fmtVND(totCost)+'đ</td>';
    h+='<td class="t-right '+totProfCls+'">'+fmtVND(Math.round(totProfit))+'đ</td>';
    h+='<td class="t-right '+totPctCls+'">'+totPctIcon+(totRev>0 ? totPctLN.toFixed(1)+'%' : '-')+'</td>';
    h+='<td class="t-right">'+(totRoas>0 ? totRoas.toFixed(2)+'x' : '-')+'</td>';
    h+='</tr>';
    h+='</tbody></table></div>';

    // Banner cảnh báo dưới bảng — nếu tổng % LN không đạt mục tiêu 30%
    if(totRev > 0){
      var bannerBg, bannerBorder, bannerIcon, bannerMsg;
      if(totPctLN >= TARGET_PROFIT_PCT){
        bannerBg="#d1fae5"; bannerBorder="#10b981"; bannerIcon="🟢";
        bannerMsg="<strong>Đạt mục tiêu lợi nhuận!</strong> Tỷ lệ "+totPctLN.toFixed(1)+"% ≥ 30%. Tiếp tục duy trì.";
      } else if(totPctLN >= 15){
        bannerBg="#fef3c7"; bannerBorder="#f59e0b"; bannerIcon="🟡";
        var gap = TARGET_PROFIT_PCT - totPctLN;
        var gapVnd = Math.round(totRev * gap / 100);
        bannerMsg="<strong>Chưa đạt mục tiêu 30%.</strong> Hiện "+totPctLN.toFixed(1)+"%, thiếu "+gap.toFixed(1)+" điểm. Cần tăng lợi nhuận thêm "+fmtVND(gapVnd)+"đ hoặc giảm chi phí quảng cáo tương đương.";
      } else if(totPctLN >= 0){
        bannerBg="#fee2e2"; bannerBorder="#ef4444"; bannerIcon="🔴";
        bannerMsg="<strong>Lợi nhuận quá thấp.</strong> Chỉ "+totPctLN.toFixed(1)+"% — cần xem lại chi phí quảng cáo + chiến lược nhóm sản phẩm yếu nhất.";
      } else {
        bannerBg="#fee2e2"; bannerBorder="#dc2626"; bannerIcon="❗";
        bannerMsg="<strong>ĐANG LỖ!</strong> Lỗ "+Math.abs(totPctLN).toFixed(1)+"% doanh thu = "+fmtVND(Math.abs(totProfit))+"đ. Cần dừng các chiến dịch lỗ ngay.";
      }
      h+='<div style="margin-top:10px;padding:10px 14px;background:'+bannerBg+';border-left:4px solid '+bannerBorder+';border-radius:4px;font-size:12.5px">';
      h+=bannerIcon+' '+bannerMsg;
      h+='</div>';
    }
  }

  // ── Bảng "Thống kê sản phẩm trong kỳ" (mỗi row = 1 SP: đơn · SL · doanh thu · VAT · giá vốn · ads TB · lợi nhuận) ──
  if(REVDATA && REVDATA.web_items_flat){
    // Gộp flat items theo tên SP
    var prodAgg = {};
    var flatAll = REVDATA.web_items_flat;
    for(var i=0;i<flatAll.length;i++){
      var it = flatAll[i];
      if(!(it.d >= curDates.start && it.d <= curDates.end)) continue;
      if(!prodAgg[it.n]){
        prodAgg[it.n] = {
          name: it.n, category: it.c,
          orderIds: {}, units: 0, revenue: 0,
        };
      }
      prodAgg[it.n].orderIds[it.oid] = 1;
      prodAgg[it.n].units += it.q;
      prodAgg[it.n].revenue += it.r;
    }
    // Convert + compute
    var prodRows = [];
    for(var pn in prodAgg){
      var pp = prodAgg[pn];
      var numOrders = Object.keys(pp.orderIds).length;
      var rev = pp.revenue;
      var vat = rev * 0.10;
      var cost = lookupCost(pp.name) * pp.units;
      var adsAvg = (adsAvgPerCat[pp.category] || 0) * numOrders;
      var profit = rev - vat - cost - adsAvg;
      prodRows.push({
        name: pp.name, category: pp.category,
        orders: numOrders, units: pp.units,
        revenue: rev, vat: vat, cost: cost, ads: adsAvg, profit: profit,
      });
    }
    prodRows.sort(function(a,b){ return b.revenue - a.revenue; });

    if(prodRows.length){
      // Category label lookup
      var catLblMap = {};
      for(var ci2=0; ci2<CAT_ORDER.length; ci2++){ catLblMap[CAT_ORDER[ci2].key] = CAT_ORDER[ci2].label; }

      h+='<h3 style="margin-top:20px;margin-bottom:8px;font-size:13px">Thống kê sản phẩm trong kỳ <span class="text-xs text-gray">('+prodRows.length+' SP · Lợi nhuận = Doanh thu − VAT 10% − Giá vốn − Ads TB · Mục tiêu ≥30% Doanh thu)</span></h3>';
      h+='<div class="tbl-wrap" style="max-height:520px;overflow-y:auto"><table class="compact-tbl"><thead style="position:sticky;top:0;background:#f9fafb;z-index:1"><tr>';
      h+='<th>#</th><th>Sản phẩm</th><th>Nhóm</th>';
      h+='<th class="t-right">Đơn</th><th class="t-right">SL</th>';
      h+='<th class="t-right">Doanh thu</th><th class="t-right">VAT 10%</th>';
      h+='<th class="t-right">Giá vốn</th><th class="t-right">Ads TB</th>';
      h+='<th class="t-right">Lợi nhuận</th><th class="t-right">% LN</th>';
      h+='</tr></thead><tbody>';
      var sTotRev=0, sTotVat=0, sTotCost=0, sTotAds=0, sTotProfit=0, sTotOrders=0, sTotUnits=0;
      for(var pi3=0; pi3<prodRows.length; pi3++){
        var r2 = prodRows[pi3];
        var profCls = r2.profit>0 ? "text-green" : (r2.profit<0 ? "text-red" : "text-gray");
        // Tỷ lệ LN/DT theo mục tiêu 30%
        var pLN = r2.revenue > 0 ? (r2.profit / r2.revenue * 100) : 0;
        var pCls, pIcon;
        if (r2.revenue === 0) { pCls = "text-gray"; pIcon = ""; }
        else if (pLN >= TARGET_PROFIT_PCT) { pCls = "text-green font-bold"; pIcon = "🟢 "; }
        else if (pLN >= 15) { pCls = "text-orange font-bold"; pIcon = "🟡 "; }
        else if (pLN >= 0) { pCls = "text-red"; pIcon = "🔴 "; }
        else { pCls = "text-red font-bold"; pIcon = "🔴 "; }
        h+='<tr>';
        h+='<td class="text-gray text-xs">'+(pi3+1)+'</td>';
        h+='<td class="text-xs"><span style="display:inline-block;max-width:320px" title="'+esc(r2.name)+'">'+esc(r2.name)+'</span></td>';
        h+='<td class="text-xs"><span class="pill">'+esc(catLblMap[r2.category]||r2.category)+'</span></td>';
        h+='<td class="t-right text-xs">'+fmtInt(r2.orders)+'</td>';
        h+='<td class="t-right text-xs text-gray">'+fmtInt(r2.units)+'</td>';
        h+='<td class="t-right text-xs text-green">'+fmtVND(r2.revenue)+'đ</td>';
        h+='<td class="t-right text-xs text-gray">'+fmtVND(Math.round(r2.vat))+'đ</td>';
        h+='<td class="t-right text-xs text-gray">'+(r2.cost>0 ? fmtVND(r2.cost)+'đ' : '-')+'</td>';
        h+='<td class="t-right text-xs text-gray">'+fmtVND(Math.round(r2.ads))+'đ</td>';
        h+='<td class="t-right text-xs font-bold '+profCls+'">'+fmtVND(Math.round(r2.profit))+'đ</td>';
        h+='<td class="t-right text-xs '+pCls+'">'+pIcon+(r2.revenue>0 ? pLN.toFixed(1)+'%' : '-')+'</td>';
        h+='</tr>';
        sTotRev+=r2.revenue; sTotVat+=r2.vat; sTotCost+=r2.cost; sTotAds+=r2.ads;
        sTotProfit+=r2.profit; sTotOrders+=r2.orders; sTotUnits+=r2.units;
      }
      var sProfCls = sTotProfit>0 ? "text-green font-bold" : (sTotProfit<0 ? "text-red font-bold" : "");
      var sPctLN = sTotRev > 0 ? (sTotProfit / sTotRev * 100) : 0;
      var sPctCls, sPctIcon;
      if (sTotRev === 0) { sPctCls = "text-gray"; sPctIcon = ""; }
      else if (sPctLN >= TARGET_PROFIT_PCT) { sPctCls = "text-green font-bold"; sPctIcon = "🟢 "; }
      else if (sPctLN >= 15) { sPctCls = "text-orange font-bold"; sPctIcon = "🟡 "; }
      else if (sPctLN >= 0) { sPctCls = "text-red"; sPctIcon = "🔴 "; }
      else { sPctCls = "text-red font-bold"; sPctIcon = "🔴 "; }
      h+='<tr style="background:#f9fafb;font-weight:700;position:sticky;bottom:0">';
      h+='<td colspan="2">TỔNG</td><td></td>';
      h+='<td class="t-right">'+fmtInt(sTotOrders)+'</td>';
      h+='<td class="t-right">'+fmtInt(sTotUnits)+'</td>';
      h+='<td class="t-right text-green">'+fmtVND(sTotRev)+'đ</td>';
      h+='<td class="t-right">'+fmtVND(Math.round(sTotVat))+'đ</td>';
      h+='<td class="t-right">'+fmtVND(sTotCost)+'đ</td>';
      h+='<td class="t-right">'+fmtVND(Math.round(sTotAds))+'đ</td>';
      h+='<td class="t-right '+sProfCls+'">'+fmtVND(Math.round(sTotProfit))+'đ</td>';
      h+='<td class="t-right '+sPctCls+'">'+sPctIcon+(sTotRev>0 ? sPctLN.toFixed(1)+'%' : '-')+'</td>';
      h+='</tr>';
      h+='</tbody></table></div>';
    }
  }

  // Dòng freshness POS — hiển thị thời điểm data POS cập nhật + freshness guard
  if(REVDATA && REVDATA.generated_at){
    var genDt = parseGenAtUTC(REVDATA.generated_at);
    // Freshness: nếu generated_at < 17:30 VN hôm qua → data có thể thiếu đơn hôm qua/hôm nay
    var isStalePos = false;
    if(genDt){
      var yStr = vnDateShift(-1).split("-");
      var yStop = new Date(Date.UTC(+yStr[0],+yStr[1]-1,+yStr[2], 10, 30));
      isStalePos = genDt < yStop;
    }
    h+='<p class="text-xs" style="margin-top:10px;padding:8px;background:'+(isStalePos?'#fef3c7':'#eff6ff')+';border-left:3px solid '+(isStalePos?'#f59e0b':'#2563eb')+';border-radius:4px">';
    h+=(isStalePos?'<strong>⚠ Dữ liệu POS có thể trễ</strong> · ':'<strong>Dữ liệu POS cập nhật lúc:</strong> ');
    h+='<strong>'+esc(genDt?fmtVNDateTime(genDt):REVDATA.generated_at)+'</strong> · ';
    h+='Cron fetch mỗi 30 phút từ 09:00-17:30 VN · Nguồn: 3 filter POS Pancake (Website + Zalo OA + Hotline, loại DUY/PN staff)';
    h+='</p>';
  }
  if(GACTX && GACTX.generated_at){
    h+='<p class="text-xs text-gray" style="margin-top:4px">Chi phí Google Ads cập nhật lúc: <strong>'+esc(GACTX.generated_at)+'</strong> · Tài khoản: '+esc((GACTX.ga_account||{}).name||'-')+'</p>';
  }

  // Note về keyword/banner không filter theo period
  h+='<p class="text-xs text-gray" style="margin-top:12px;padding:8px;background:#f9fafb;border-radius:4px">Lưu ý: Bộ lọc thời gian ảnh hưởng các số liệu phía trên (chi phí, doanh thu, đơn) và bảng Top sản phẩm. Các bảng Keywords/Banners/Placements/Suggestions ở dưới là <strong>tổng hợp 30 ngày</strong> vì Windsor.ai free trial không export dữ liệu daily cho keyword/banner. Nếu cần filter daily cho keyword/banner, phải nâng cấp Windsor gói trả phí hoặc chuyển sang Google Ads API trực tiếp.</p>';

  document.getElementById("time-filter-content").innerHTML=h;
  // 2026-04-24: bỏ renderProductRanking() - thay bằng bảng "Danh sách đơn hàng trong kỳ" đã render inline ở trên
}

function render(r){
  var g=r.grade||"F";
  // v4.1 — merge categories: ưu tiên 9 nhóm chuẩn Doscom từ GACTX.per_category
  // nếu không có → fallback về r.categories (Cowork task AI gen, có thể nhóm cũ)
  var cats = {};
  if(GACTX && GACTX.per_category){
    for(var ci=0;ci<CAT_ORDER.length;ci++){
      var co = CAT_ORDER[ci];
      var src = GACTX.per_category[co.key];
      if(!src) continue;
      // Merge thêm data AI từ r.categories nếu có key trùng
      var aiData = (r.categories && r.categories[co.key]) || {};
      cats[co.key] = Object.assign({
        display_name: co.label,
        ads_spend_30d: src.spend_30d || 0,
        ads_clicks_30d: src.clicks_30d || 0,
        ads_impressions_30d: src.impressions_30d || 0,
        ads_ctr_30d: src.ctr_30d || 0,
        revenue_pancake_30d: src.revenue_30d || 0,
        orders_pancake_30d: src.orders_30d || 0,
        roas_proxy: src.roas_proxy || 0,
        products: (src.products || []),
      }, aiData, {display_name: co.label});  // display_name luôn dùng nhóm mới
    }
  } else {
    cats = r.categories || {};
  }
  var catKeys=[];
  for(var k in cats)if((cats[k].ads_spend_30d||0)>0 || (cats[k].keywords_count||0)>0 || (cats[k].banners_count||0)>0 || (cats[k].revenue_pancake_30d||0)>0)catKeys.push(k);
  // Sắp xếp theo thứ tự CAT_ORDER
  catKeys.sort(function(a,b){
    var ai = CAT_ORDER.findIndex(function(x){return x.key===a;});
    var bi = CAT_ORDER.findIndex(function(x){return x.key===b;});
    return (ai<0?99:ai) - (bi<0?99:bi);
  });
  if(!currentCat&&catKeys.length)currentCat=catKeys[0];
  // Lưu cats cho switchCat dùng
  window.__CATS_MERGED = cats;
  var t=r.totals||{},h="";
  h+='<section class="grid-summary">';
  h+='<div class="card card-score bg-'+g+'"><div class="metric-label" style="color:rgba(255,255,255,.8)">Điểm số</div><div class="metric-value">'+r.score+'<span style="font-size:18px;opacity:.8">/100</span></div><div style="font-size:14px;font-weight:600;margin-top:4px">Xếp hạng '+g+'</div></div>';
  h+='<div class="card"><div class="metric-label">ROAS (lợi nhuận/chi ads)</div><div class="metric-value '+(t.roas_overall<1?"text-red":"")+'">'+(t.roas_overall||0)+'x</div><div class="metric-sub">Chi: '+fmtVND(t.ads_spend_30d)+'đ · Rev: '+fmtVND(t.website_revenue_30d)+'đ</div></div>';
  h+='<div class="card"><div class="metric-label">Hành động cần làm</div><div class="metric-value">'+(t.total_actions||0)+'</div><div class="metric-sub text-red">'+(t.urgent_actions||0)+' urgent</div></div>';
  h+='<div class="card"><div class="metric-label">Tiết kiệm tiềm năng</div><div class="metric-value text-green">'+fmtVND(t.estimated_total_saving_vnd)+'đ</div><div class="metric-sub">trong 30 ngày</div></div>';
  h+='</section>';

  // ── Tổng quan đánh giá (user request 2026-04-24: đẩy lên ngay sau thẻ điểm) ──
  var ss=r.score_summary||{};
  h+='<section class="block card"><h2>Tổng quan đánh giá</h2><div class="score-summary">';
  h+='<div class="score-block good"><h4>✓ Điểm tốt</h4><ul>';
  var gp=ss.good_points||[];
  if(!gp.length)h+='<li class="text-gray">-</li>';
  for(var i=0;i<gp.length;i++)h+='<li>'+mdBold(gp[i].text)+'</li>';
  h+='</ul></div><div class="score-block bad"><h4>⚠ Cần cải thiện</h4><ul>';
  var bp=ss.improvement_points||[];
  if(!bp.length)h+='<li class="text-gray">-</li>';
  for(var j=0;j<bp.length;j++)h+='<li>'+mdBold(bp[j].text)+'</li>';
  h+='</ul></div></div></section>';

  // Headline + verdict (kỳ 30d)
  h+='<section class="block card"><p style="font-weight:600;font-size:13px">'+esc(r.headline)+'</p><p class="text-sm" style="margin-top:8px;color:#374151">'+esc(r.verdict)+'</p>';
  var pd=r.period||{};
  h+='<p class="text-xs" style="color:#9ca3af;margin-top:6px">Cập nhật: '+esc(r.generated_at)+' · Kỳ 30d: '+esc(pd.start)+' đến '+esc(pd.end)+'</p></section>';

  // Bộ lọc thời gian (xuống sau Tổng quan đánh giá)
  h+='<section class="block card"><div id="time-filter-content"></div></section>';

    // Product ranking - render qua container để nhảy theo period
  // 2026-04-24: Section "Xếp hạng Sản phẩm theo Doanh thu" đã bỏ — thay bằng bảng "Danh sách đơn hàng trong kỳ" trong Bộ lọc thời gian

  // Tabs — 9 nhóm chuẩn Doscom
  h+='<section class="block card"><h2>Phân tích chi tiết theo Nhóm sản phẩm</h2>';
  h+='<p class="text-xs text-gray" style="margin-bottom:8px">9 nhóm chuẩn: Máy dò · Camera wifi · Camera 4G · Camera gọi video 2 chiều · Máy ghi âm · Chống ghi âm · Định vị · NOMA · Khác</p>';
  h+='<div class="cat-tabs">';
  for(var ti=0;ti<catKeys.length;ti++){
    var ck=catKeys[ti],cc=cats[ck],act=ck===currentCat,hasUrg=false,sa=(cc && cc.summary_actions)||[];
    for(var si=0;si<sa.length;si++)if(sa[si].priority==="high"){hasUrg=true;break;}
    var dn = (cc && cc.display_name) || ck;
    h+='<button class="cat-tab '+(act?"active":"")+'" onclick="switchCat(\''+ck+'\',event)">'+esc(dn)+(hasUrg?' <span style="color:#ef4444">●</span>':'')+'</button>';
  }
  h+='</div><div id="cat-content">'+renderCategory(cats[currentCat]||{},currentCat)+'</div></section>';

  h+='<section class="block card" style="background:#eff6ff"><h3>Thông tin chính</h3><ul style="margin-left:16px;font-size:13px">';
  var kf=r.key_findings||[];
  for(var ki=0;ki<kf.length;ki++)if(kf[ki])h+='<li>'+esc(kf[ki])+'</li>';
  h+='</ul></section>';
  h+='<div class="footer">Agent Google Doscom v'+(r.version||"3.4")+' · Chạy 3 ngày/lần lúc 7:30 sáng VN · Click header cột để sort</div>';
  document.getElementById("main").innerHTML=h;
  renderTimeFilterSection(r);
}

function renderCategory(c,ck){
  if(!c)return '<p class="text-gray">Không có dữ liệu.</p>';
  var h="";
  h+='<div class="cat-overview">';
  h+='<div class="cat-overview-item"><div class="lbl">Sản phẩm</div><div class="val text-xs">'+((c.products||[]).join(", ")||"-")+'</div></div>';
  h+='<div class="cat-overview-item"><div class="lbl">Chi phí 30d</div><div class="val">'+fmtVND(c.ads_spend_30d)+'đ</div></div>';
  h+='<div class="cat-overview-item"><div class="lbl">Doanh thu</div><div class="val text-green">'+fmtVND(c.revenue_pancake_30d)+'đ</div></div>';
  h+='<div class="cat-overview-item"><div class="lbl">ROAS</div><div class="val '+(c.roas_proxy>=1.5?"text-green":"text-red")+'">'+c.roas_proxy+'x</div></div>';
  h+='<div class="cat-overview-item"><div class="lbl">Đơn hàng</div><div class="val">'+fmtInt(c.orders_pancake_30d)+'</div></div>';
  h+='<div class="cat-overview-item"><div class="lbl">CTR TB</div><div class="val">'+fmtPct(c.ads_ctr_30d)+'</div></div>';
  h+='</div>';

  // Customer psychology
  var psy=c.customer_psychology;
  if(psy){
    h+='<div style="background:#faf5ff;border-left:4px solid #8b5cf6;border-radius:6px;padding:12px;margin-bottom:16px">';
    h+='<h4 style="font-size:13px;font-weight:700;color:#5b21b6;margin-bottom:8px">Tâm lý khách hàng nhóm này (heuristic analysis)</h4>';
    h+='<div class="text-xs" style="line-height:1.6">';
    h+='<div><strong>Chân dung:</strong> '+esc(psy.customer_profile)+'</div>';
    h+='<div><strong>Thời điểm vàng:</strong> '+esc(psy.best_timing)+'</div>';
    h+='<div><strong>Tránh:</strong> '+esc(psy.avoid_timing)+'</div>';
    h+='<div><strong>Angle cảm xúc:</strong> '+esc(psy.emotional_angle)+'</div>';
    h+='<div><strong>Pattern CTA nên dùng:</strong> '+esc(psy.cta_pattern)+'</div>';
    h+='<div><strong>Tránh angle:</strong> '+esc(psy.avoid_angle)+'</div>';
    h+='</div></div>';
  }

  var ev=c.evaluation||{good:[],bad:[]};
  h+='<div class="cat-eval"><div class="cat-eval-box good"><h4>✓ Điểm mạnh nhóm này</h4><ul>';
  if(!ev.good.length)h+='<li class="text-gray">-</li>';
  for(var gi=0;gi<ev.good.length;gi++)h+='<li>'+mdBold(ev.good[gi])+'</li>';
  h+='</ul></div><div class="cat-eval-box bad"><h4>⚠ Điểm cần lưu ý</h4><ul>';
  if(!ev.bad.length)h+='<li class="text-gray">-</li>';
  for(var bi=0;bi<ev.bad.length;bi++)h+='<li>'+mdBold(ev.bad[bi])+'</li>';
  h+='</ul></div></div>';

  // Actions
  var sa=c.summary_actions||[];
  if(sa.length){
    h+='<h3>Hành động đề xuất</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    for(var ai=0;ai<sa.length;ai++){
      var a=sa[ai],tg="";
      if(a.type==="ADD_NEGATIVE_KEYWORDS"||a.type==="SCALE_KEYWORDS"||a.type==="PAUSE_KEYWORDS"||a.type==="REVIEW_KEYWORDS")tg="suggest-keywords-"+ck;
      else if(a.type==="REPLACE_BANNERS"||a.type==="PAUSE_BANNERS")tg="suggest-banners-"+ck;
      else if(a.type==="REVIEW_BANNERS")tg="suggest-abtest-"+ck;
      h+='<div class="action-box priority-'+a.priority+'"><div style="display:flex;justify-content:space-between;gap:8px"><span class="title">'+esc(a.title)+'</span><span class="badge badge-'+a.priority+'">'+a.priority+'</span></div>';
      h+='<div class="detail">'+esc(a.detail)+'</div>';
      if(a.estimated_saving_vnd>0)h+='<div class="save">Tiết kiệm: '+fmtVND(a.estimated_saving_vnd)+'đ/30d</div>';
      if(tg)h+='<button class="scroll-btn" onclick="scrollToEl(\''+tg+'\')">→ Xem gợi ý chi tiết</button>';
      h+='</div>';
    }
    h+='</div>';
  }

  // Keywords table with sort
  var kws=c.keywords||[];
  h+='<h3 style="margin-top:16px">Bảng Từ khóa ('+kws.length+' từ khóa đang chạy) <span class="text-xs text-gray">— Click header để sắp xếp</span></h3>';
  h+='<p class="text-xs text-gray" style="margin:4px 0">Ghi chú: Cột <strong>Hiệu quả #</strong> là xếp hạng nội bộ theo conv/spend/CTR (không phải SEO rank Google). Google Ads cho phép đặt <strong>Loại khớp</strong> RIÊNG cho TỪNG từ khóa. Cột <strong>% Top IS</strong> = Top Impression Share (% lần hiển thị ở top 4 kết quả Google). <strong>% #1</strong> = Absolute Top IS (% lần ở vị trí #1). Hiển thị "—" khi Windsor chưa có data (sau khi trigger fetch workflow mới).</p>';
  if(!kws.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    var tid="tbl-kw-"+ck;
    h+='<div class="tbl-wrap"><table id="'+tid+'"><thead><tr>';
    h+='<th class="t-center" onclick="sortTable(\''+tid+'\',0,\'num\')" style="cursor:pointer" title="Xếp hạng hiệu quả nội bộ (theo conv/spend/CTR) — KHÔNG phải xếp hạng SEO trên Google">Hiệu quả #</th>';
    h+='<th onclick="sortTable(\''+tid+'\',1,\'str\')" style="cursor:pointer">Từ khóa</th>';
    h+='<th onclick="sortTable(\''+tid+'\',2,\'str\')" style="cursor:pointer">Loại khớp</th>';
    h+='<th onclick="sortTable(\''+tid+'\',3,\'str\')" style="cursor:pointer">Trạng thái</th>';
    h+='<th class="t-right" onclick="sortTable(\''+tid+'\',4,\'num\')" style="cursor:pointer">Chi tiêu</th>';
    h+='<th class="t-right" onclick="sortTable(\''+tid+'\',5,\'num\')" style="cursor:pointer">Click</th>';
    h+='<th class="t-right" onclick="sortTable(\''+tid+'\',6,\'num\')" style="cursor:pointer">CTR</th>';
    h+='<th class="t-right" onclick="sortTable(\''+tid+'\',7,\'num\')" style="cursor:pointer">Chuyển đổi</th>';
    h+='<th>Khuyến nghị</th><th>Lý do</th></tr></thead><tbody>';
    for(var ki2=0;ki2<kws.length;ki2++){
      var kw=kws[ki2],rnk=kw.rank_effectiveness||(ki2+1),rc=rnk<=3?"rank-top3":"";
      h+='<tr><td class="t-center"><span class="rank-badge '+rc+'">#'+rnk+'</span></td>';
      h+='<td><span class="truncate" title="'+esc(kw.text)+'">'+esc(kw.text)+'</span></td>';
      h+='<td class="text-xs">'+esc(trn(kw.match_type,MATCH_VN))+'</td>';
      h+='<td class="text-xs">'+esc(trn(kw.status,STATUS_VN))+'</td>';
      h+='<td class="t-right">'+fmtVND(kw.spend_30d)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(kw.clicks_30d)+'</td>';
      h+='<td class="t-right">'+fmtPct(kw.ctr_30d)+'</td>';
      var topIs = kw.top_impression_share || 0;
      var absTop = kw.abs_top_impression_share || 0;
      h+='<td class="t-right '+(topIs>=0.5?"text-green font-bold":(topIs>0?"":"text-gray"))+'">'+(topIs>0?fmtPct(topIs,0):"—")+'</td>';
      h+='<td class="t-right '+(absTop>=0.3?"text-green font-bold":(absTop>0?"":"text-gray"))+'">'+(absTop>0?fmtPct(absTop,0):"—")+'</td>';
      h+='<td class="t-right '+(kw.conv_30d>0?"text-green font-bold":"text-gray")+'">'+kw.conv_30d+'</td>';
      h+='<td><span class="rec rec-'+kw.recommendation+'">'+esc(REC_VN[kw.recommendation]||kw.recommendation)+'</span></td>';
      h+='<td class="text-xs text-gray">'+esc(kw.reason)+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // Banners table - compact spacing
  var bs=c.banners||[];
  h+='<h3 style="margin-top:16px">Bảng Banner ('+bs.length+' banner)</h3>';
  if(!bs.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    var btid="tbl-bn-"+ck;
    h+='<div class="tbl-wrap"><table id="'+btid+'" class="compact-tbl"><thead><tr>';
    h+='<th onclick="sortTable(\''+btid+'\',0,\'str\')" style="cursor:pointer">Tên banner</th>';
    h+='<th>Định dạng</th><th>Kích thước</th><th>Chiến dịch</th>';
    h+='<th class="t-right" onclick="sortTable(\''+btid+'\',4,\'num\')" style="cursor:pointer">Chi tiêu</th>';
    h+='<th class="t-right" onclick="sortTable(\''+btid+'\',5,\'num\')" style="cursor:pointer">Hiển thị</th>';
    h+='<th class="t-right" onclick="sortTable(\''+btid+'\',6,\'num\')" style="cursor:pointer">Click</th>';
    h+='<th class="t-right" onclick="sortTable(\''+btid+'\',7,\'num\')" style="cursor:pointer">CTR</th>';
    h+='<th class="t-right">Chuyển đổi</th><th>Khuyến nghị</th><th>Lý do</th></tr></thead><tbody>';
    for(var bi2=0;bi2<bs.length;bi2++){
      var b=bs[bi2],cv=(b.conv_30d!=null)?b.conv_30d:"—";
      h+='<tr><td class="mono" title="'+esc(b.ad_id)+'">'+esc(b.ad_name)+'</td>';
      h+='<td class="text-xs">'+esc(b.ad_format)+'</td>';
      h+='<td class="text-xs">'+esc(b.current_size)+'</td>';
      h+='<td class="text-xs truncate" title="'+esc(b.campaign)+'">'+esc(b.campaign)+'</td>';
      h+='<td class="t-right">'+fmtVND(b.spend_30d)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(b.impressions_30d)+'</td>';
      h+='<td class="t-right">'+fmtInt(b.clicks_30d)+'</td>';
      h+='<td class="t-right">'+fmtPct(b.ctr_30d)+'</td>';
      h+='<td class="t-right text-gray">'+cv+'</td>';
      h+='<td><span class="rec rec-'+b.recommendation+'">'+esc(REC_VN[b.recommendation]||b.recommendation)+'</span></td>';
      h+='<td class="text-xs text-gray">'+esc(b.reason)+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // Banner size analysis
  var bsa=c.banner_size_analysis||[];
  if(bsa.length){
    h+='<h3 style="margin-top:16px">Đánh giá Kích thước Banner (rank theo CTR)</h3>';
    h+='<p class="text-xs text-gray" style="margin:4px 0">Phân tích thực tế size nào cho CTR tốt nhất ở nhóm này. Ưu tiên size có CTR > 1%, giảm tỷ trọng size CTR thấp.</p>';
    h+='<div class="tbl-wrap"><table><thead><tr><th class="t-center">Rank</th><th>Kích thước</th><th class="t-right">Số banner</th><th class="t-right">Chi tiêu</th><th class="t-right">Click</th><th class="t-right">Hiển thị</th><th class="t-right">CTR</th><th class="t-right">CPC</th><th>Đánh giá</th></tr></thead><tbody>';
    for(var si=0;si<bsa.length;si++){
      var bz=bsa[si];
      h+='<tr><td class="t-center"><span class="rank-badge '+(bz.rank<=3?"rank-top3":"")+'">#'+bz.rank+'</span></td>';
      h+='<td class="font-bold">'+esc(bz.size)+'</td>';
      h+='<td class="t-right">'+fmtInt(bz.banner_count)+'</td>';
      h+='<td class="t-right">'+fmtVND(bz.spend_30d)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(bz.clicks_30d)+'</td>';
      h+='<td class="t-right">'+fmtInt(bz.impressions_30d)+'</td>';
      h+='<td class="t-right '+(bz.ctr_30d>0.01?"text-green font-bold":(bz.ctr_30d<0.005?"text-red":""))+'">'+fmtPct(bz.ctr_30d)+'</td>';
      h+='<td class="t-right">'+fmtVND(bz.cpc_30d)+'đ</td>';
      h+='<td class="text-xs">'+esc(bz.evaluation)+' <span class="rec rec-'+(bz.recommendation==="UU_TIEN"?"KEEP":(bz.recommendation==="CAI_THIEN"?"REPLACE":"REVIEW"))+'">'+esc(REC_VN[bz.recommendation]||bz.recommendation)+'</span></td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // Placement quality
  var pq=c.placement_quality||[];
  if(pq.length){
    h+='<h3 style="margin-top:16px">Chất lượng Placement (trang web/app banner hiển thị)</h3>';
    h+='<p class="text-xs text-gray" style="margin:4px 0">Nhận xét từng placement dựa trên CTR + conversion + spend. Ưu tiên loại trừ placement "Nên loại trừ".</p>';
    h+='<div class="tbl-wrap"><table><thead><tr><th>Placement</th><th>Loại</th><th>Network</th><th class="t-right">Chi tiêu</th><th class="t-right">Click</th><th class="t-right">Hiển thị</th><th class="t-right">CTR</th><th>Đánh giá</th></tr></thead><tbody>';
    for(var pqi=0;pqi<pq.length;pqi++){
      var pql=pq[pqi];
      h+='<tr><td class="mono text-xs truncate" title="'+esc(pql.placement)+'">'+esc(pql.placement)+'</td>';
      h+='<td class="text-xs">'+esc(pql.placement_type)+'</td>';
      h+='<td class="text-xs">'+esc(pql.ad_network_type)+'</td>';
      h+='<td class="t-right">'+fmtVND(pql.spend_30d)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(pql.clicks_30d)+'</td>';
      h+='<td class="t-right">'+fmtInt(pql.impressions_30d)+'</td>';
      h+='<td class="t-right">'+fmtPct(pql.ctr_30d)+'</td>';
      h+='<td class="text-xs">'+esc(pql.evaluation)+' <span class="rec rec-'+(pql.action==="GIU"?"KEEP":(pql.action==="NEN_LOAI_TRU"?"REPLACE":"REVIEW"))+'">'+esc(REC_VN[pql.action]||pql.action)+'</span></td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // Suggested keywords
  var sk=c.suggested_keywords||[];
  h+='<div id="suggest-keywords-'+ck+'" class="suggest-block"><h3>Bộ từ khóa nên THÊM ('+sk.length+')</h3>';
  h+='<p class="text-xs text-gray" style="margin:4px 0">Lưu ý: Google Ads cho phép set <strong>Loại khớp khác nhau</strong> cho TỪNG từ khóa (không ép toàn chiến dịch).</p>';
  if(!sk.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    h+='<div class="tbl-wrap" style="background:white"><table><thead><tr><th>Từ khóa đề xuất</th><th>Nhóm ý định</th><th>Loại khớp nên dùng</th><th>Volume</th><th>Lý do</th></tr></thead><tbody>';
    for(var si2=0;si2<sk.length;si2++){var s=sk[si2];h+='<tr><td class="font-bold">'+esc(s.keyword)+'</td><td><span class="pill">'+esc(s.intent_group)+'</span></td><td class="text-xs">'+esc(trn(s.suggested_match_type,MATCH_VN))+'</td><td class="text-xs">'+esc(s.estimated_volume==="medium"?"Trung bình":s.estimated_volume)+'</td><td class="text-xs text-gray">'+esc(s.reason)+'</td></tr>';}
    h+='</tbody></table></div>';
  }
  h+='</div>';

  // Banner improvement
  var bt=c.banner_improvement_tips||[];
  h+='<div id="suggest-banners-'+ck+'" class="suggest-block"><h3>Gợi ý cải thiện Banner ('+bt.length+')</h3>';
  if(!bt.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    for(var tii=0;tii<bt.length;tii++){
      var tip=bt[tii];
      h+='<div class="tip-card">';
      h+='<div class="field"><span class="lbl">Banner:</span> <span class="mono">'+esc(tip.ad_name)+'</span> (size '+esc(tip.current_size)+', CTR '+fmtPct(tip.current_ctr)+')</div>';
      h+='<div class="field"><span class="lbl">Vấn đề:</span> '+esc(tip.problem)+'</div>';
      h+='<div class="field"><span class="lbl">Size nên dùng:</span> '+esc(tip.recommended_size)+'</div>';
      h+='<div class="field"><span class="lbl">Màu sắc:</span> '+esc(tip.recommended_colors)+'</div>';
      h+='<div class="field"><span class="lbl">Visual:</span> '+esc(tip.recommended_visual)+'</div>';
      h+='<div class="field"><span class="lbl">Headline:</span> "'+esc(tip.recommended_headline)+'"</div>';
      h+='<div class="field"><span class="lbl">CTA:</span> "'+esc(tip.recommended_cta)+'"</div>';
      h+='<div class="field"><span class="lbl">Social proof:</span> '+esc(tip.recommended_social_proof)+'</div>';
      h+='<div class="field text-xs" style="color:#6b7280;padding-top:4px;border-top:1px dashed #fde68a;margin-top:6px"><span class="lbl">Vì sao:</span> '+esc(tip.why)+'</div>';
      h+='</div>';
    }
  }
  h+='</div>';

  var ab=c.ab_test_suggestions||[];
  h+='<div id="suggest-abtest-'+ck+'" class="suggest-block"><h3>Gợi ý A/B Test ('+ab.length+')</h3>';
  if(!ab.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    for(var abi=0;abi<ab.length;abi++){
      var tt=ab[abi];
      h+='<div class="tip-card">';
      h+='<div class="field"><span class="lbl">Banner:</span> <span class="mono">'+esc(tt.ad_name)+'</span> (CTR: '+fmtPct(tt.current_ctr)+')</div>';
      var vs=tt.test_variants||[];
      h+='<div class="field"><span class="lbl">Các variant:</span></div><ol style="margin-left:24px;font-size:12px">';
      for(var vi=0;vi<vs.length;vi++){var v=vs[vi];h+='<li><strong>'+esc(v.variant)+'</strong> ('+esc(v.angle)+') — "'+esc(v.headline)+'"</li>';}
      h+='</ol>';
      h+='<div class="field"><span class="lbl">Ngân sách:</span> '+esc(tt.budget_split)+'</div>';
      h+='<div class="field"><span class="lbl">Tiêu chí thắng:</span> '+esc(tt.success_metric)+'</div>';
      h+='</div>';
    }
  }
  h+='</div>';

  var ta=c.title_analysis||[];
  h+='<div id="suggest-titles-'+ck+'" class="suggest-block"><h3>Phân tích Tiêu đề Quảng cáo ('+ta.length+')</h3>';
  if(!ta.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    h+='<div class="tbl-wrap" style="background:white;max-height:none"><table><thead><tr><th>Tiêu đề</th><th>Ad group</th><th class="t-right">Chi tiêu</th><th class="t-right">CTR</th><th>Chất lượng</th><th>Hành động</th><th>Gợi ý cải thiện</th></tr></thead><tbody>';
    for(var tii2=0;tii2<ta.length;tii2++){
      var t2=ta[tii2],qC=t2.quality==="tốt"?"pill-green":(t2.quality==="kém"?"pill-orange":"pill");
      h+='<tr><td><span class="truncate" title="'+esc(t2.full_title)+'">'+esc(t2.title_snippet)+'</span></td>';
      h+='<td class="text-xs">'+esc(t2.ad_group_name)+'</td>';
      h+='<td class="t-right">'+fmtVND(t2.spend_30d)+'đ</td>';
      h+='<td class="t-right">'+fmtPct(t2.ctr_30d)+'</td>';
      h+='<td><span class="pill '+qC+'">'+esc(t2.quality)+'</span></td>';
      var rc2=t2.recommendation==="GIỮ"?"KEEP":(t2.recommendation==="VIẾT LẠI"?"REPLACE":"REVIEW");
      h+='<td><span class="rec rec-'+rc2+'">'+esc(t2.recommendation)+'</span></td>';
      h+='<td class="text-xs text-gray">'+esc(t2.suggested_improvement||"-")+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }
  h+='</div>';
  return h;
}

load();

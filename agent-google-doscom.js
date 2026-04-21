// Agent Google Doscom v3.3 — Thêm bộ lọc thời gian + bảng so sánh
console.log("[AgentPage] JS v3.3 loaded");
var REPORT=null, currentCat=null, selectedPeriod="last_30d";
var REC_VN={"KEEP":"Giữ nguyên","SCALE":"Tăng bid","ADD_NEGATIVE":"Thêm negative","PAUSE":"Tạm dừng","REPLACE":"Thay banner","REVIEW":"Xem lại","MONITOR":"Theo dõi"};
var MATCH_VN={"BROAD":"Rộng","EXACT":"Chính xác","PHRASE":"Cụm","NEAR_PHRASE":"Gần cụm","UNKNOWN":"-"};
var STATUS_VN={"NONE":"Chưa xử lý","ADDED":"Đã thêm","EXCLUDED":"Đã loại trừ"};

function fmtVND(n){if(n==null||n===0)return "0";if(Math.abs(n)>=1e6)return (n/1e6).toFixed(1)+"tr";if(Math.abs(n)>=1e3)return (n/1e3).toFixed(0)+"K";return Math.round(n).toLocaleString("vi-VN")}
function fmtInt(n){return n==null?"-":n.toLocaleString("vi-VN")}
function fmtPct(n,d){if(d==null)d=2;return n==null?"-":(n*100).toFixed(d)+"%"}
function fmtChange(pct){
  if(pct==null)return '<span class="text-gray">-</span>';
  var cls = pct > 0 ? "text-green" : (pct < 0 ? "text-red" : "text-gray");
  var sign = pct > 0 ? "+" : "";
  var arrow = pct > 0 ? "▲" : (pct < 0 ? "▼" : "●");
  return '<span class="'+cls+' font-bold">'+arrow+" "+sign+pct.toFixed(1)+"%</span>";
}
function esc(s){if(s==null)return "";return String(s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split("\"").join("&quot;")}
function mdBold(s){return esc(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")}
function trn(s,d){if(!s)return "-";return s.split("/").map(function(p){return d[p]||p}).join(" / ")}

function load(){
  fetch("data/google-ads-daily-report.json?v="+Date.now()).then(function(res){
    if(!res.ok)throw new Error("HTTP "+res.status);
    return res.json();
  }).then(function(r){
    console.log("[AgentPage] loaded");
    REPORT=r;
    try{render(r);}catch(err){console.error(err);showError("Lỗi: "+err.message);}
  }).catch(function(e){showError("Không tải được: "+esc(e.message));});
}

function showError(msg){document.getElementById("main").innerHTML='<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2"><h3 style="color:#991b1b">Lỗi</h3><div style="margin-top:8px">'+msg+'</div></div>';}

function scrollToEl(id){
  var el=document.getElementById(id);
  if(!el){console.warn("target not found:",id);return false;}
  el.scrollIntoView({behavior:"smooth",block:"start"});
  el.classList.add("highlight-bg");
  setTimeout(function(){el.classList.remove("highlight-bg");},2000);
  return false;
}

function switchCat(key,ev){
  currentCat=key;
  var tabs=document.querySelectorAll(".cat-tab");
  for(var i=0;i<tabs.length;i++)tabs[i].classList.remove("active");
  if(ev&&ev.target)ev.target.classList.add("active");
  document.getElementById("cat-content").innerHTML=renderCategory(REPORT.categories[key],key);
}

function changePeriod(key){
  selectedPeriod = key;
  renderTimeFilterSection(REPORT);
}

function computeCompare(cur, prev){
  function pct(a, b){ if(!b) return null; return (a-b)/b*100; }
  return {
    spend: pct(cur.totals.spend, prev.totals.spend),
    clicks: pct(cur.totals.clicks, prev.totals.clicks),
    ctr: pct(cur.totals.ctr, prev.totals.ctr),
    revenue: pct(cur.totals.revenue, prev.totals.revenue),
    orders: pct(cur.totals.orders, prev.totals.orders),
    roas: pct(cur.totals.roas, prev.totals.roas),
  };
}

function renderTimeFilterSection(r){
  var tp = r.time_periods || {};
  var cur = tp[selectedPeriod];
  if(!cur) return;
  var compareKey = cur.compare_to;
  var prev = compareKey ? tp[compareKey] : null;
  var cmp = prev ? computeCompare(cur, prev) : null;

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
  html += '<h2 style="font-size:16px;font-weight:700">Bộ lọc thời gian</h2>';
  html += '<select onchange="changePeriod(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:white">';
  var periodList = ["today","yesterday","this_week","last_week","this_month","last_month","last_7d","last_30d","last_90d"];
  for(var i=0;i<periodList.length;i++){
    var k = periodList[i];
    if(!tp[k]) continue;
    var sel = k === selectedPeriod ? " selected" : "";
    html += '<option value="'+k+'"'+sel+'>'+esc(tp[k].label)+'</option>';
  }
  html += '</select></div>';

  // Date range
  html += '<p class="text-xs text-gray" style="margin-bottom:12px">Kỳ: <strong>'+esc(cur.date_range.start)+' → '+esc(cur.date_range.end)+'</strong>';
  if(prev) html += ' · So sánh với <strong>'+esc(prev.label)+'</strong> ('+esc(prev.date_range.start)+' → '+esc(prev.date_range.end)+')';
  html += '</p>';

  // Totals + compare
  var t = cur.totals;
  html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px" class="tf-grid">';
  function metricBox(label, value, changeHtml){
    return '<div style="background:#f9fafb;border-radius:6px;padding:10px"><div style="font-size:10px;color:#6b7280;text-transform:uppercase">'+label+'</div>'+
      '<div style="font-size:18px;font-weight:700;margin-top:4px">'+value+'</div>'+
      (changeHtml?'<div style="font-size:11px;margin-top:2px">'+changeHtml+'</div>':'')+'</div>';
  }
  html += metricBox("Chi phí ads", fmtVND(t.spend)+'đ', cmp?fmtChange(cmp.spend):'');
  html += metricBox("Click", fmtInt(t.clicks), cmp?fmtChange(cmp.clicks):'');
  html += metricBox("CTR", fmtPct(t.ctr), cmp?fmtChange(cmp.ctr):'');
  html += metricBox("Doanh thu", fmtVND(t.revenue)+'đ', cmp?fmtChange(cmp.revenue):'');
  html += metricBox("Đơn hàng", fmtInt(t.orders), cmp?fmtChange(cmp.orders):'');
  html += metricBox("ROAS", t.roas+'x', cmp?fmtChange(cmp.roas):'');
  html += '</div>';

  // Per-category table trong period này
  var pc = cur.per_category || {};
  var catList = [];
  for(var k in pc) if(pc[k].spend > 0 || pc[k].revenue > 0) catList.push(k);
  catList.sort(function(a,b){return pc[b].spend - pc[a].spend;});

  if(catList.length){
    var catMeta = {};
    if(REPORT.categories) for(var ck in REPORT.categories) catMeta[ck] = REPORT.categories[ck].display_name || ck;

    html += '<h3 style="margin-top:16px;margin-bottom:8px;font-size:13px">Phân chia theo nhóm sản phẩm trong kỳ</h3>';
    html += '<div class="tbl-wrap"><table><thead><tr>';
    html += '<th>Nhóm sản phẩm</th><th class="t-right">Chi phí</th><th class="t-right">Click</th>';
    html += '<th class="t-right">CTR</th><th class="t-right">Doanh thu</th><th class="t-right">Đơn</th><th class="t-right">ROAS</th>';
    if(prev) html += '<th class="t-right">Thay đổi Spend</th><th class="t-right">Thay đổi Revenue</th>';
    html += '</tr></thead><tbody>';
    for(var ci=0;ci<catList.length;ci++){
      var ck2 = catList[ci];
      var c = pc[ck2];
      var pcPrev = prev ? (prev.per_category[ck2] || {}) : null;
      html += '<tr><td class="font-bold">'+esc(catMeta[ck2]||ck2)+'</td>';
      html += '<td class="t-right">'+fmtVND(c.spend)+'đ</td>';
      html += '<td class="t-right">'+fmtInt(c.clicks)+'</td>';
      html += '<td class="t-right">'+fmtPct(c.ctr)+'</td>';
      html += '<td class="t-right text-green">'+fmtVND(c.revenue)+'đ</td>';
      html += '<td class="t-right">'+fmtInt(c.orders)+'</td>';
      var roasCls = c.roas >= 1.5 ? "text-green font-bold" : (c.roas > 0 ? "text-red" : "text-gray");
      html += '<td class="t-right '+roasCls+'">'+c.roas+'x</td>';
      if(prev){
        function catPct(a,b){if(!b||b===0)return null;return (a-b)/b*100;}
        var sCh = pcPrev ? catPct(c.spend, pcPrev.spend||0) : null;
        var rCh = pcPrev ? catPct(c.revenue, pcPrev.revenue||0) : null;
        html += '<td class="t-right">'+fmtChange(sCh)+'</td>';
        html += '<td class="t-right">'+fmtChange(rCh)+'</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }

  document.getElementById("time-filter-content").innerHTML = html;
}

function render(r){
  var g=r.grade||"F";
  var cats=r.categories||{};
  var catKeys=[];
  for(var k in cats){if(cats[k].ads_spend_30d>0||cats[k].keywords_count>0||cats[k].banners_count>0)catKeys.push(k);}
  if(!currentCat&&catKeys.length)currentCat=catKeys[0];
  var t=r.totals||{};
  var html="";

  // Summary cards
  html+='<section class="grid-summary">';
  html+='<div class="card card-score bg-'+g+'"><div class="metric-label" style="color:rgba(255,255,255,.8)">Điểm số</div>';
  html+='<div class="metric-value">'+r.score+'<span style="font-size:18px;opacity:.8">/100</span></div>';
  html+='<div style="font-size:14px;font-weight:600;margin-top:4px">Xếp hạng '+g+'</div></div>';
  html+='<div class="card"><div class="metric-label">ROAS (lợi nhuận/chi ads)</div>';
  html+='<div class="metric-value '+(t.roas_overall<1?"text-red":"")+'">'+(t.roas_overall||0)+'x</div>';
  html+='<div class="metric-sub">Chi: '+fmtVND(t.ads_spend_30d)+'đ · Rev: '+fmtVND(t.website_revenue_30d)+'đ</div></div>';
  html+='<div class="card"><div class="metric-label">Hành động cần làm</div>';
  html+='<div class="metric-value">'+(t.total_actions||0)+'</div>';
  html+='<div class="metric-sub text-red">'+(t.urgent_actions||0)+' urgent (ưu tiên cao)</div></div>';
  html+='<div class="card"><div class="metric-label">Tiết kiệm tiềm năng</div>';
  html+='<div class="metric-value text-green">'+fmtVND(t.estimated_total_saving_vnd)+'đ</div>';
  html+='<div class="metric-sub">trong 30 ngày</div></div>';
  html+='</section>';

  // NEW: Time filter section
  html+='<section class="block card"><div id="time-filter-content"></div></section>';

  // Score summary
  var ss=r.score_summary||{};
  html+='<section class="block card"><h2>Tổng quan đánh giá</h2>';
  html+='<div class="score-summary">';
  html+='<div class="score-block good"><h4>✓ Điểm tốt</h4><ul>';
  var gp=ss.good_points||[];
  if(!gp.length)html+='<li class="text-gray">Chưa có điểm tốt nổi bật.</li>';
  for(var i=0;i<gp.length;i++)html+='<li>'+mdBold(gp[i].text)+'</li>';
  html+='</ul></div>';
  html+='<div class="score-block bad"><h4>⚠ Cần cải thiện</h4><ul>';
  var bp=ss.improvement_points||[];
  if(!bp.length)html+='<li class="text-gray">Không có vấn đề urgent.</li>';
  for(var j=0;j<bp.length;j++)html+='<li>'+mdBold(bp[j].text)+'</li>';
  html+='</ul></div></div></section>';

  // Verdict
  html+='<section class="block card">';
  html+='<p style="font-weight:600;font-size:13px">'+esc(r.headline)+'</p>';
  html+='<p class="text-sm" style="margin-top:8px;color:#374151">'+esc(r.verdict)+'</p>';
  var pd=r.period||{};
  html+='<p class="text-xs" style="color:#9ca3af;margin-top:6px">Cập nhật: '+esc(r.generated_at)+' · Kỳ 30d: '+esc(pd.start)+' đến '+esc(pd.end)+'</p>';
  html+='</section>';

  // Product ranking
  html+='<section class="block card"><h2>Xếp hạng Sản phẩm theo Doanh thu (Pancake 30 ngày)</h2>';
  html+='<div class="tbl-wrap"><table><thead><tr>';
  html+='<th>#</th><th>Sản phẩm</th><th>Nhóm</th><th class="t-right">Doanh thu</th>';
  html+='<th class="t-right">Đơn</th><th class="t-right">AOV</th><th>Từ khóa có chuyển đổi</th>';
  html+='</tr></thead><tbody>';
  var pr=r.products_ranking||[];
  for(var pi=0;pi<pr.length;pi++){
    var p=pr[pi],kws="";
    var krel=p.related_keywords_top_convert||[];
    for(var kj=0;kj<krel.length;kj++)kws+='<span class="pill pill-green">'+esc(krel[kj].text)+' ('+krel[kj].conv_30d+')</span>';
    if(!kws)kws='<span class="text-gray">—</span>';
    html+='<tr><td class="text-gray">'+(pi+1)+'</td>';
    html+='<td class="font-bold">'+esc(p.product)+'</td>';
    html+='<td><span class="pill">'+esc(p.category_name)+'</span></td>';
    html+='<td class="t-right text-green font-bold">'+fmtVND(p.revenue_30d)+'đ</td>';
    html+='<td class="t-right">'+fmtInt(p.orders_30d)+'</td>';
    html+='<td class="t-right text-xs text-gray">'+fmtVND(p.avg_order_value)+'đ</td>';
    html+='<td class="text-xs">'+kws+'</td></tr>';
  }
  html+='</tbody></table></div></section>';

  // Tabs
  html+='<section class="block card"><h2>Phân tích chi tiết theo Nhóm sản phẩm</h2><div class="cat-tabs">';
  for(var ti=0;ti<catKeys.length;ti++){
    var ck=catKeys[ti],cc=cats[ck],act=ck===currentCat;
    var hasUrg=false,sa=cc.summary_actions||[];
    for(var si=0;si<sa.length;si++){if(sa[si].priority==="high"){hasUrg=true;break;}}
    html+='<button class="cat-tab '+(act?"active":"")+'" onclick="switchCat(\''+ck+'\',event)">'+esc(cc.display_name)+(hasUrg?' <span style="color:#ef4444">●</span>':'')+'</button>';
  }
  html+='</div><div id="cat-content">'+renderCategory(cats[currentCat],currentCat)+'</div></section>';

  // Key findings
  html+='<section class="block card" style="background:#eff6ff"><h3>Thông tin chính</h3><ul style="margin-left:16px;font-size:13px">';
  var kf=r.key_findings||[];
  for(var ki=0;ki<kf.length;ki++)if(kf[ki])html+='<li>'+esc(kf[ki])+'</li>';
  html+='</ul></section>';

  html+='<div class="footer">Agent Google Doscom v'+(r.version||"3.3")+' · Chạy 3 ngày/lần lúc 7:30 sáng VN</div>';
  document.getElementById("main").innerHTML=html;

  // Render time filter sau khi DOM có
  renderTimeFilterSection(r);
}

function renderCategory(c,ck){
  if(!c)return '<p class="text-gray">Không có dữ liệu.</p>';
  var html="";

  html+='<div class="cat-overview">';
  html+='<div class="cat-overview-item"><div class="lbl">Sản phẩm</div><div class="val text-xs">'+((c.products||[]).join(", ")||"-")+'</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Chi phí ads 30d</div><div class="val">'+fmtVND(c.ads_spend_30d)+'đ</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Doanh thu</div><div class="val text-green">'+fmtVND(c.revenue_pancake_30d)+'đ</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">ROAS</div><div class="val '+(c.roas_proxy>=1.5?"text-green":"text-red")+'">'+c.roas_proxy+'x</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Đơn hàng</div><div class="val">'+fmtInt(c.orders_pancake_30d)+'</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">CTR TB</div><div class="val">'+fmtPct(c.ads_ctr_30d)+'</div></div>';
  html+='</div>';

  var ev=c.evaluation||{good:[],bad:[]};
  html+='<div class="cat-eval">';
  html+='<div class="cat-eval-box good"><h4>✓ Điểm mạnh nhóm này</h4><ul>';
  if(!ev.good.length)html+='<li class="text-gray">Chưa có điểm mạnh nổi bật.</li>';
  for(var gi=0;gi<ev.good.length;gi++)html+='<li>'+mdBold(ev.good[gi])+'</li>';
  html+='</ul></div>';
  html+='<div class="cat-eval-box bad"><h4>⚠ Điểm cần lưu ý</h4><ul>';
  if(!ev.bad.length)html+='<li class="text-gray">Nhóm này đang ổn.</li>';
  for(var bi=0;bi<ev.bad.length;bi++)html+='<li>'+mdBold(ev.bad[bi])+'</li>';
  html+='</ul></div></div>';

  var sa=c.summary_actions||[];
  if(sa.length){
    html+='<h3>Hành động đề xuất</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    for(var ai=0;ai<sa.length;ai++){
      var a=sa[ai],target="";
      if(a.type==="ADD_NEGATIVE_KEYWORDS"||a.type==="SCALE_KEYWORDS"||a.type==="PAUSE_KEYWORDS"||a.type==="REVIEW_KEYWORDS")target="suggest-keywords-"+ck;
      else if(a.type==="REPLACE_BANNERS"||a.type==="PAUSE_BANNERS")target="suggest-banners-"+ck;
      else if(a.type==="REVIEW_BANNERS")target="suggest-abtest-"+ck;
      html+='<div class="action-box priority-'+a.priority+'">';
      html+='<div style="display:flex;justify-content:space-between;gap:8px"><span class="title">'+esc(a.title)+'</span>';
      html+='<span class="badge badge-'+a.priority+'">'+a.priority+'</span></div>';
      html+='<div class="detail">'+esc(a.detail)+'</div>';
      if(a.estimated_saving_vnd>0)html+='<div class="save">Tiết kiệm: '+fmtVND(a.estimated_saving_vnd)+'đ/30d</div>';
      if(target)html+='<button class="scroll-btn" onclick="scrollToEl(\''+target+'\')">→ Xem gợi ý chi tiết</button>';
      html+='</div>';
    }
    html+='</div>';
  } else html+='<p class="text-xs text-gray" style="margin-bottom:12px">Không có hành động cần thực hiện.</p>';

  var kws=c.keywords||[];
  html+='<h3 style="margin-top:16px">Bảng Từ khóa ('+kws.length+' từ khóa đang chạy)</h3>';
  if(!kws.length)html+='<p class="text-xs text-gray">Chưa có dữ liệu từ khóa.</p>';
  else{
    html+='<div class="tbl-wrap"><table><thead><tr>';
    html+='<th class="t-center">Xếp hạng</th><th>Từ khóa</th><th>Loại khớp</th><th>Trạng thái</th>';
    html+='<th class="t-right">Chi tiêu</th><th class="t-right">Click</th>';
    html+='<th class="t-right">CTR</th><th class="t-right">Chuyển đổi</th>';
    html+='<th>Khuyến nghị</th><th>Lý do</th></tr></thead><tbody>';
    for(var ki2=0;ki2<kws.length;ki2++){
      var kw=kws[ki2],rnk=kw.rank_effectiveness||(ki2+1);
      var rnkCls=rnk<=3?"rank-top3":"";
      html+='<tr><td class="t-center"><span class="rank-badge '+rnkCls+'">#'+rnk+'</span></td>';
      html+='<td><span class="truncate" title="'+esc(kw.text)+'">'+esc(kw.text)+'</span></td>';
      html+='<td class="text-xs">'+esc(trn(kw.match_type,MATCH_VN))+'</td>';
      html+='<td class="text-xs">'+esc(trn(kw.status,STATUS_VN))+'</td>';
      html+='<td class="t-right">'+fmtVND(kw.spend_30d)+'đ</td>';
      html+='<td class="t-right">'+fmtInt(kw.clicks_30d)+'</td>';
      html+='<td class="t-right">'+fmtPct(kw.ctr_30d)+'</td>';
      html+='<td class="t-right '+(kw.conv_30d>0?"text-green font-bold":"text-gray")+'">'+kw.conv_30d+'</td>';
      html+='<td><span class="rec rec-'+kw.recommendation+'">'+esc(REC_VN[kw.recommendation]||kw.recommendation)+'</span></td>';
      html+='<td class="text-xs text-gray">'+esc(kw.reason)+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }

  var bs=c.banners||[];
  html+='<h3 style="margin-top:16px">Bảng Banner ('+bs.length+' banner)</h3>';
  if(!bs.length)html+='<p class="text-xs text-gray">Chưa có dữ liệu banner.</p>';
  else{
    html+='<div class="tbl-wrap"><table><thead><tr>';
    html+='<th>Tên banner</th><th>Định dạng</th><th>Kích thước</th><th>Chiến dịch</th>';
    html+='<th class="t-right">Chi tiêu</th><th class="t-right">Hiển thị</th>';
    html+='<th class="t-right">Click</th><th class="t-right">CTR</th>';
    html+='<th class="t-right">Chuyển đổi</th>';
    html+='<th>Khuyến nghị</th><th>Lý do</th></tr></thead><tbody>';
    for(var bi2=0;bi2<bs.length;bi2++){
      var b=bs[bi2];
      var cv=(b.conv_30d!=null)?b.conv_30d:"—";
      html+='<tr><td class="mono" title="'+esc(b.ad_id)+'">'+esc(b.ad_name)+'</td>';
      html+='<td class="text-xs">'+esc(b.ad_format)+'</td>';
      html+='<td class="text-xs">'+esc(b.current_size)+'</td>';
      html+='<td class="text-xs truncate" title="'+esc(b.campaign)+'">'+esc(b.campaign)+'</td>';
      html+='<td class="t-right">'+fmtVND(b.spend_30d)+'đ</td>';
      html+='<td class="t-right">'+fmtInt(b.impressions_30d)+'</td>';
      html+='<td class="t-right">'+fmtInt(b.clicks_30d)+'</td>';
      html+='<td class="t-right">'+fmtPct(b.ctr_30d)+'</td>';
      html+='<td class="t-right text-gray">'+cv+'</td>';
      html+='<td><span class="rec rec-'+b.recommendation+'">'+esc(REC_VN[b.recommendation]||b.recommendation)+'</span></td>';
      html+='<td class="text-xs text-gray">'+esc(b.reason)+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }

  var sk=c.suggested_keywords||[];
  html+='<div id="suggest-keywords-'+ck+'" class="suggest-block"><h3>Bộ từ khóa nên THÊM ('+sk.length+' gợi ý)</h3>';
  if(!sk.length)html+='<p class="text-xs text-gray">Chua co goi y.</p>';
  else{
    html+='<div class="tbl-wrap" style="background:white"><table><thead><tr>';
    html+='<th>Tu khoa de xuat</th><th>Nhom y dinh</th><th>Loai khop nen dung</th><th>Volume</th><th>Ly do</th>';
    html+='</tr></thead><tbody>';
    for(var si2=0;si2<sk.length;si2++){
      var s=sk[si2];
      html+='<tr><td class="font-bold">'+esc(s.keyword)+'</td>';
      html+='<td><span class="pill">'+esc(s.intent_group)+'</span></td>';
      html+='<td class="text-xs">'+esc(trn(s.suggested_match_type,MATCH_VN))+'</td>';
      html+='<td class="text-xs">'+esc(s.estimated_volume==="medium"?"Trung binh":s.estimated_volume)+'</td>';
      html+='<td class="text-xs text-gray">'+esc(s.reason)+'</td></tr>';
    }
    html+='</tbody></table></div></div>';
  }
  var bt=c.banner_improvement_tips||[];
  html+='<div id="suggest-banners-'+ck+'" class="suggest-block"><h3>Goi y cai thien Banner ('+bt.length+' banner)</h3>';
  if(!bt.length)html+='<p class="text-xs text-gray">Khong co banner can sua.</p>';
  else{
    for(var tii=0;tii<bt.length;tii++){
      var tip=bt[tii];
      html+='<div class="tip-card">';
      html+='<div class="field"><span class="lbl">Banner:</span> <span class="mono">'+esc(tip.ad_name)+'</span> (id '+esc(tip.ad_id)+', size '+esc(tip.current_size)+', CTR '+fmtPct(tip.current_ctr)+')</div>';
      html+='<div class="field"><span class="lbl">Van de:</span> '+esc(tip.problem)+'</div>';
      html+='<div class="field"><span class="lbl">Size nen dung:</span> '+esc(tip.recommended_size)+'</div>';
      html+='<div class="field"><span class="lbl">Mau sac:</span> '+esc(tip.recommended_colors)+'</div>';
      html+='<div class="field"><span class="lbl">Visual:</span> '+esc(tip.recommended_visual)+'</div>';
      html+='<div class="field"><span class="lbl">Headline:</span> "'+esc(tip.recommended_headline)+'"</div>';
      html+='<div class="field"><span class="lbl">CTA:</span> "'+esc(tip.recommended_cta)+'"</div>';
      html+='<div class="field"><span class="lbl">Social proof:</span> '+esc(tip.recommended_social_proof)+'</div>';
      html+='<div class="field text-xs" style="color:#6b7280;padding-top:4px;border-top:1px dashed #fde68a;margin-top:6px"><span class="lbl">Vi sao:</span> '+esc(tip.why)+'</div>';
      html+='</div>';
    }
  }
  html+='</div>';
  var ab=c.ab_test_suggestions||[];
  html+='<div id="suggest-abtest-'+ck+'" class="suggest-block"><h3>Goi y A/B Test ('+ab.length+' banner)</h3>';
  if(!ab.length)html+='<p class="text-xs text-gray">Khong co banner can A/B test.</p>';
  else{
    for(var abi=0;abi<ab.length;abi++){
      var tt=ab[abi];
      html+='<div class="tip-card">';
      html+='<div class="field"><span class="lbl">Banner test:</span> <span class="mono">'+esc(tt.ad_name)+'</span> (CTR: '+fmtPct(tt.current_ctr)+')</div>';
      var vs=tt.test_variants||[];
      html+='<div class="field"><span class="lbl">Cac variant:</span></div><ol style="margin-left:24px;font-size:12px">';
      for(var vi=0;vi<vs.length;vi++){
        var v=vs[vi];
        html+='<li><strong>'+esc(v.variant)+'</strong> ('+esc(v.angle)+') - "'+esc(v.headline)+'" - '+esc(v.purpose)+'</li>';
      }
      html+='</ol>';
      html+='<div class="field"><span class="lbl">Ngan sach:</span> '+esc(tt.budget_split)+'</div>';
      html+='<div class="field"><span class="lbl">Tieu chi thang:</span> '+esc(tt.success_metric)+'</div>';
      html+='<div class="field text-xs" style="color:#047857"><span class="lbl">Ky vong:</span> '+esc(tt.estimated_lift)+'</div>';
      html+='</div>';
    }
  }
  html+='</div>';
  var ta=c.title_analysis||[];
  html+='<div id="suggest-titles-'+ck+'" class="suggest-block"><h3>Phan tich Tieu de Quang cao ('+ta.length+' tieu de)</h3>';
  if(!ta.length)html+='<p class="text-xs text-gray">Chua co tieu de.</p>';
  else{
    html+='<div class="tbl-wrap" style="background:white;max-height:none"><table><thead><tr>';
    html+='<th>Tieu de</th><th>Ad group</th><th class="t-right">Chi tieu</th><th class="t-right">CTR</th><th>Chat luong</th><th>Hanh dong</th><th>Goi y cai thien</th>';
    html+='</tr></thead><tbody>';
    for(var tii2=0;tii2<ta.length;tii2++){
      var tt2=ta[tii2];
      html+='<tr><td><span class="truncate" title="'+esc(tt2.full_title)+'">'+esc(tt2.title_snippet)+'</span></td>';
      html+='<td class="text-xs">'+esc(tt2.ad_group_name)+'</td>';
      html+='<td class="t-right">'+fmtVND(tt2.spend_30d)+'d</td>';
      html+='<td class="t-right">'+fmtPct(tt2.ctr_30d)+'</td>';
      var qC=tt2.quality==="tot"?"pill-green":(tt2.quality==="kem"?"pill-orange":"pill");
      html+='<td><span class="pill '+qC+'">'+esc(tt2.quality)+'</span></td>';
      var recCls=tt2.recommendation==="GIU"?"KEEP":(tt2.recommendation==="VIET LAI"?"REPLACE":"REVIEW");
      html+='<td><span class="rec rec-'+recCls+'">'+esc(tt2.recommendation)+'</span></td>';
      html+='<td class="text-xs text-gray">'+esc(tt2.suggested_improvement||"-")+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }
  html+='</div>';
  return html;
}
load();

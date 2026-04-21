// Agent Google Doscom v3.4 — Phase 3A
console.log("[AgentPage] JS v3.4 loaded");
var REPORT=null, currentCat=null, selectedPeriod="last_30d", sortStates={};
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
  fetch("data/google-ads-daily-report.json?v="+Date.now()).then(function(r){
    if(!r.ok)throw new Error("HTTP "+r.status);
    return r.json();
  }).then(function(r){
    REPORT=r;
    try{render(r);}catch(e){console.error(e);showError("Lỗi: "+e.message);}
  }).catch(function(e){showError("Không tải: "+esc(e.message));});
}

function showError(m){document.getElementById("main").innerHTML='<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2"><h3 style="color:#991b1b">Lỗi</h3><div>'+m+'</div></div>';}

function scrollToEl(id){var el=document.getElementById(id);if(!el)return;el.scrollIntoView({behavior:"smooth",block:"start"});el.classList.add("highlight-bg");setTimeout(function(){el.classList.remove("highlight-bg");},2000);}

function switchCat(key,ev){
  currentCat=key;
  var tabs=document.querySelectorAll(".cat-tab");
  for(var i=0;i<tabs.length;i++)tabs[i].classList.remove("active");
  if(ev&&ev.target)ev.target.classList.add("active");
  document.getElementById("cat-content").innerHTML=renderCategory(REPORT.categories[key],key);
}

function changePeriod(k){selectedPeriod=k;renderTimeFilterSection(REPORT);}

function compareFn(c,p){function pct(a,b){if(!b)return null;return (a-b)/b*100;}return{spend:pct(c.totals.spend,p.totals.spend),clicks:pct(c.totals.clicks,p.totals.clicks),ctr:pct(c.totals.ctr,p.totals.ctr),revenue:pct(c.totals.revenue,p.totals.revenue),orders:pct(c.totals.orders,p.totals.orders),roas:pct(c.totals.roas,p.totals.roas)};}

function renderTimeFilterSection(r){
  var tp=r.time_periods||{};
  var cur=tp[selectedPeriod]; if(!cur)return;
  var prev=cur.compare_to?tp[cur.compare_to]:null;
  var cmp=prev?compareFn(cur,prev):null;
  var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
  h+='<h2 style="font-size:16px;font-weight:700">Bộ lọc thời gian</h2>';
  h+='<select onchange="changePeriod(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:white">';
  var ks=["today","yesterday","this_week","last_week","this_month","last_month","last_7d","last_30d","last_90d"];
  for(var i=0;i<ks.length;i++){if(!tp[ks[i]])continue;var sel=ks[i]===selectedPeriod?" selected":"";h+='<option value="'+ks[i]+'"'+sel+'>'+esc(tp[ks[i]].label)+'</option>';}
  h+='</select></div>';
  h+='<p class="text-xs text-gray" style="margin-bottom:12px">Kỳ: <strong>'+esc(cur.date_range.start)+' → '+esc(cur.date_range.end)+'</strong>';
  if(prev)h+=' · So sánh với <strong>'+esc(prev.label)+'</strong>';
  h+='</p>';
  var t=cur.totals;
  h+='<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">';
  function mb(l,v,c){return '<div style="background:#f9fafb;border-radius:6px;padding:10px"><div style="font-size:10px;color:#6b7280;text-transform:uppercase">'+l+'</div><div style="font-size:18px;font-weight:700;margin-top:4px">'+v+'</div>'+(c?'<div style="font-size:11px;margin-top:2px">'+c+'</div>':'')+'</div>';}
  h+=mb("Chi phí ads",fmtVND(t.spend)+'đ',cmp?fmtChange(cmp.spend):'');
  h+=mb("Click",fmtInt(t.clicks),cmp?fmtChange(cmp.clicks):'');
  h+=mb("CTR",fmtPct(t.ctr),cmp?fmtChange(cmp.ctr):'');
  h+=mb("Doanh thu",fmtVND(t.revenue)+'đ',cmp?fmtChange(cmp.revenue):'');
  h+=mb("Đơn hàng",fmtInt(t.orders),cmp?fmtChange(cmp.orders):'');
  h+=mb("ROAS",t.roas+'x',cmp?fmtChange(cmp.roas):'');
  h+='</div>';
  var pc=cur.per_category||{};
  var cls=[];
  for(var k in pc)if(pc[k].spend>0||pc[k].revenue>0)cls.push(k);
  cls.sort(function(a,b){return pc[b].spend-pc[a].spend;});
  if(cls.length){
    var cm={};
    if(REPORT.categories)for(var ck in REPORT.categories)cm[ck]=REPORT.categories[ck].display_name||ck;
    h+='<h3 style="margin-top:16px;margin-bottom:8px;font-size:13px">Phân chia theo nhóm SP trong kỳ</h3>';
    h+='<div class="tbl-wrap"><table><thead><tr><th>Nhóm SP</th><th class="t-right">Chi phí</th><th class="t-right">Click</th><th class="t-right">CTR</th><th class="t-right">Doanh thu</th><th class="t-right">Đơn</th><th class="t-right">ROAS</th>';
    if(prev)h+='<th class="t-right">Δ Spend</th><th class="t-right">Δ Revenue</th>';
    h+='</tr></thead><tbody>';
    for(var ci=0;ci<cls.length;ci++){
      var ck2=cls[ci],c=pc[ck2],pp=prev?(prev.per_category[ck2]||{}):null;
      h+='<tr><td class="font-bold">'+esc(cm[ck2]||ck2)+'</td>';
      h+='<td class="t-right">'+fmtVND(c.spend)+'đ</td><td class="t-right">'+fmtInt(c.clicks)+'</td><td class="t-right">'+fmtPct(c.ctr)+'</td>';
      h+='<td class="t-right text-green">'+fmtVND(c.revenue)+'đ</td><td class="t-right">'+fmtInt(c.orders)+'</td>';
      var rc=c.roas>=1.5?"text-green font-bold":(c.roas>0?"text-red":"text-gray");
      h+='<td class="t-right '+rc+'">'+c.roas+'x</td>';
      if(prev){function pct2(a,b){if(!b)return null;return (a-b)/b*100;}var sCh=pp?pct2(c.spend,pp.spend||0):null;var rCh=pp?pct2(c.revenue,pp.revenue||0):null;h+='<td class="t-right">'+fmtChange(sCh)+'</td><td class="t-right">'+fmtChange(rCh)+'</td>';}
      h+='</tr>';
    }
    h+='</tbody></table></div>';
  }
  // Top products trong period
  var tp_prods = cur.top_products || [];
  if(tp_prods.length){
    h+='<h3 style="margin-top:16px;margin-bottom:8px;font-size:13px">Top sản phẩm trong kỳ (3 nguồn: Website + Hotline + Zalo OA)</h3>';
    h+='<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Sản phẩm</th><th class="t-right">Doanh thu</th><th class="t-right">Đơn</th>';
    if(prev){h+='<th class="t-right">Δ Doanh thu vs kỳ trước</th>';}
    h+='</tr></thead><tbody>';
    var prev_map = {};
    if(prev && prev.top_products){
      for(var pi=0;pi<prev.top_products.length;pi++){ prev_map[prev.top_products[pi].product] = prev.top_products[pi]; }
    }
    for(var pi2=0;pi2<tp_prods.length;pi2++){
      var pp = tp_prods[pi2];
      h+='<tr><td class="text-gray">'+(pi2+1)+'</td><td class="font-bold">'+esc(pp.product)+'</td>';
      h+='<td class="t-right text-green">'+fmtVND(pp.revenue)+'đ</td>';
      h+='<td class="t-right">'+fmtInt(pp.orders)+'</td>';
      if(prev){
        var pr_prev = prev_map[pp.product];
        var ch = (pr_prev && pr_prev.revenue) ? ((pp.revenue - pr_prev.revenue) / pr_prev.revenue * 100) : null;
        h+='<td class="t-right">'+fmtChange(ch)+'</td>';
      }
      h+='</tr>';
    }
    h+='</tbody></table></div>';
  }

  // Note về keyword/banner không filter theo period
  h+='<p class="text-xs text-gray" style="margin-top:12px;padding:8px;background:#f9fafb;border-radius:4px">Lưu ý: Bộ lọc thời gian ảnh hưởng các số liệu phía trên (chi phí, doanh thu, đơn) và bảng Top sản phẩm. Các bảng Keywords/Banners/Placements/Suggestions ở dưới là <strong>tổng hợp 30 ngày</strong> vì Windsor.ai free trial không export dữ liệu daily cho keyword/banner. Nếu cần filter daily cho keyword/banner, phải nâng cấp Windsor gói trả phí hoặc chuyển sang Google Ads API trực tiếp.</p>';

  document.getElementById("time-filter-content").innerHTML=h;
}

function render(r){
  var g=r.grade||"F",cats=r.categories||{},catKeys=[];
  for(var k in cats)if(cats[k].ads_spend_30d>0||cats[k].keywords_count>0||cats[k].banners_count>0)catKeys.push(k);
  if(!currentCat&&catKeys.length)currentCat=catKeys[0];
  var t=r.totals||{},h="";
  h+='<section class="grid-summary">';
  h+='<div class="card card-score bg-'+g+'"><div class="metric-label" style="color:rgba(255,255,255,.8)">Điểm số</div><div class="metric-value">'+r.score+'<span style="font-size:18px;opacity:.8">/100</span></div><div style="font-size:14px;font-weight:600;margin-top:4px">Xếp hạng '+g+'</div></div>';
  h+='<div class="card"><div class="metric-label">ROAS (lợi nhuận/chi ads)</div><div class="metric-value '+(t.roas_overall<1?"text-red":"")+'">'+(t.roas_overall||0)+'x</div><div class="metric-sub">Chi: '+fmtVND(t.ads_spend_30d)+'đ · Rev: '+fmtVND(t.website_revenue_30d)+'đ</div></div>';
  h+='<div class="card"><div class="metric-label">Hành động cần làm</div><div class="metric-value">'+(t.total_actions||0)+'</div><div class="metric-sub text-red">'+(t.urgent_actions||0)+' urgent</div></div>';
  h+='<div class="card"><div class="metric-label">Tiết kiệm tiềm năng</div><div class="metric-value text-green">'+fmtVND(t.estimated_total_saving_vnd)+'đ</div><div class="metric-sub">trong 30 ngày</div></div>';
  h+='</section>';
  h+='<section class="block card"><div id="time-filter-content"></div></section>';

  // VN culture tips
  var vn=r.vn_culture_tips||[];
  if(vn.length){
    h+='<section class="block card" style="background:#fffbeb;border-left:4px solid #f59e0b"><h3>Lưu ý văn hóa & lịch mua sắm VN</h3><ul style="margin-left:16px;font-size:13px;margin-top:6px">';
    for(var vi=0;vi<vn.length;vi++)h+='<li style="margin-bottom:4px">'+esc(vn[vi].text)+'</li>';
    h+='</ul></section>';
  }

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

  h+='<section class="block card"><p style="font-weight:600;font-size:13px">'+esc(r.headline)+'</p><p class="text-sm" style="margin-top:8px;color:#374151">'+esc(r.verdict)+'</p>';
  var pd=r.period||{};
  h+='<p class="text-xs" style="color:#9ca3af;margin-top:6px">Cập nhật: '+esc(r.generated_at)+' · Kỳ 30d: '+esc(pd.start)+' đến '+esc(pd.end)+'</p></section>';

  // Product ranking
  h+='<section class="block card"><h2>Xếp hạng Sản phẩm theo Doanh thu</h2>';
  h+='<p class="text-xs text-gray" style="margin-bottom:6px">Chỉ lấy từ 3 nguồn: Website + Hotline + Zalo OA (không bao gồm DUY/PN staff)</p>';
  h+='<div class="tbl-wrap"><table id="tbl-prod"><thead><tr>';
  h+='<th>#</th><th onclick="sortTable(\'tbl-prod\',1,\'str\')" style="cursor:pointer">Sản phẩm</th>';
  h+='<th onclick="sortTable(\'tbl-prod\',2,\'str\')" style="cursor:pointer">Nhóm</th>';
  h+='<th class="t-right" onclick="sortTable(\'tbl-prod\',3,\'num\')" style="cursor:pointer">Doanh thu</th>';
  h+='<th class="t-right" onclick="sortTable(\'tbl-prod\',4,\'num\')" style="cursor:pointer">Đơn</th>';
  h+='<th class="t-right" onclick="sortTable(\'tbl-prod\',5,\'num\')" style="cursor:pointer">AOV</th><th>Từ khóa có chuyển đổi</th></tr></thead><tbody>';
  var pr=r.products_ranking||[];
  for(var pi=0;pi<pr.length;pi++){
    var p=pr[pi],kws="",krel=p.related_keywords_top_convert||[];
    for(var kj=0;kj<krel.length;kj++)kws+='<span class="pill pill-green">'+esc(krel[kj].text)+' ('+krel[kj].conv_30d+')</span>';
    if(!kws)kws='<span class="text-gray">—</span>';
    h+='<tr><td class="text-gray">'+(pi+1)+'</td><td class="font-bold">'+esc(p.product)+'</td>';
    h+='<td><span class="pill">'+esc(p.category_name)+'</span></td>';
    h+='<td class="t-right text-green font-bold">'+fmtVND(p.revenue_30d)+'đ</td>';
    h+='<td class="t-right">'+fmtInt(p.orders_30d)+'</td>';
    h+='<td class="t-right text-xs text-gray">'+fmtVND(p.avg_order_value)+'đ</td>';
    h+='<td class="text-xs">'+kws+'</td></tr>';
  }
  h+='</tbody></table></div></section>';

  // Tabs
  h+='<section class="block card"><h2>Phân tích chi tiết theo Nhóm sản phẩm</h2><div class="cat-tabs">';
  for(var ti=0;ti<catKeys.length;ti++){
    var ck=catKeys[ti],cc=cats[ck],act=ck===currentCat,hasUrg=false,sa=cc.summary_actions||[];
    for(var si=0;si<sa.length;si++)if(sa[si].priority==="high"){hasUrg=true;break;}
    h+='<button class="cat-tab '+(act?"active":"")+'" onclick="switchCat(\''+ck+'\',event)">'+esc(cc.display_name)+(hasUrg?' <span style="color:#ef4444">●</span>':'')+'</button>';
  }
  h+='</div><div id="cat-content">'+renderCategory(cats[currentCat],currentCat)+'</div></section>';

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
  h+='<p class="text-xs text-gray" style="margin:4px 0">Ghi chú: Google Ads cho phép đặt <strong>Loại khớp</strong> RIÊNG cho TỪNG từ khóa (không phải cho toàn chiến dịch). Cột Loại khớp hiển thị match type hiện tại của keyword đó.</p>';
  if(!kws.length)h+='<p class="text-xs text-gray">-</p>';
  else{
    var tid="tbl-kw-"+ck;
    h+='<div class="tbl-wrap"><table id="'+tid+'"><thead><tr>';
    h+='<th class="t-center" onclick="sortTable(\''+tid+'\',0,\'num\')" style="cursor:pointer">Xếp hạng</th>';
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

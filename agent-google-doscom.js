// Agent Google Doscom v3.2 — JS logic tách khỏi HTML để tránh truncate
console.log("[AgentPage] JS loaded");
var REPORT=null, currentCat=null;
var REC_VN={"KEEP":"Giữ nguyên","SCALE":"Tăng bid","ADD_NEGATIVE":"Thêm negative","PAUSE":"Tạm dừng","REPLACE":"Thay banner","REVIEW":"Xem lại","MONITOR":"Theo dõi"};
var MATCH_VN={"BROAD":"Rộng","EXACT":"Chính xác","PHRASE":"Cụm","NEAR_PHRASE":"Gần cụm","UNKNOWN":"-"};
var STATUS_VN={"NONE":"Chưa xử lý","ADDED":"Đã thêm","EXCLUDED":"Đã loại trừ"};

function fmtVND(n){if(n==null||n===0)return "0";if(Math.abs(n)>=1e6)return (n/1e6).toFixed(1)+"tr";if(Math.abs(n)>=1e3)return (n/1e3).toFixed(0)+"K";return Math.round(n).toLocaleString("vi-VN")}
function fmtInt(n){return n==null?"-":n.toLocaleString("vi-VN")}
function fmtPct(n,d){if(d==null)d=2;return n==null?"-":(n*100).toFixed(d)+"%"}
function esc(s){if(s==null)return "";return String(s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split("\"").join("&quot;")}
function mdBold(s){return esc(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")}
function trn(s,d){if(!s)return "-";return s.split("/").map(function(p){return d[p]||p}).join(" / ")}

function load(){
  fetch("data/google-ads-daily-report.json?v="+Date.now()).then(function(res){
    if(!res.ok)throw new Error("HTTP "+res.status);
    return res.json();
  }).then(function(r){
    console.log("[AgentPage] loaded score:",r.score);
    REPORT=r;
    try{render(r);}catch(err){console.error(err);showError("Lỗi render: "+err.message);}
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
  html+='<p class="text-xs" style="color:#9ca3af;margin-top:6px">Cập nhật: '+esc(r.generated_at)+' · Kỳ: '+esc(pd.start)+' đến '+esc(pd.end)+'</p>';
  html+='</section>';

  // Product ranking
  html+='<section class="block card"><h2>Xếp hạng Sản phẩm theo Doanh thu (Pancake 30 ngày)</h2>';
  html+='<div class="tbl-wrap"><table><thead><tr>';
  html+='<th>#</th><th>Sản phẩm</th><th>Nhóm</th><th class="t-right">Doanh thu</th>';
  html+='<th class="t-right">Đơn</th><th class="t-right">AOV (giá đơn TB)</th><th>Từ khóa có chuyển đổi</th>';
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

  html+='<div class="footer">Agent Google Doscom v'+(r.version||"3.2")+' · Chạy 3 ngày/lần lúc 7:30 sáng VN</div>';
  document.getElementById("main").innerHTML=html;
}

function renderCategory(c,ck){
  if(!c)return '<p class="text-gray">Không có dữ liệu.</p>';
  var html="";

  // Overview
  html+='<div class="cat-overview">';
  html+='<div class="cat-overview-item"><div class="lbl">Sản phẩm</div><div class="val text-xs">'+((c.products||[]).join(", ")||"-")+'</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Chi phí ads 30d</div><div class="val">'+fmtVND(c.ads_spend_30d)+'đ</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Doanh thu</div><div class="val text-green">'+fmtVND(c.revenue_pancake_30d)+'đ</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">ROAS</div><div class="val '+(c.roas_proxy>=1.5?"text-green":"text-red")+'">'+c.roas_proxy+'x</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">Đơn hàng</div><div class="val">'+fmtInt(c.orders_pancake_30d)+'</div></div>';
  html+='<div class="cat-overview-item"><div class="lbl">CTR TB</div><div class="val">'+fmtPct(c.ads_ctr_30d)+'</div></div>';
  html+='</div>';

  // Category Evaluation
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

  // Actions
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

  // Keywords table (full list with rank)
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

  // Banners
  var bs=c.banners||[];
  html+='<h3 style="margin-top:16px">Bảng Banner / Quảng cáo ('+bs.length+' banner)</h3>';
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
    html+='<p class="text-xs text-gray" style="margin-top:4px">Ghi chú: Chuyển đổi ở banner đang là "—" vì Windsor chưa xuất field này (sẽ bổ sung sau).</p>';
  }

  // Suggested Keywords
  var sk=c.suggested_keywords||[];
  html+='<div id="suggest-keywords-'+ck+'" class="suggest-block"><h3>Bộ từ khóa nên THÊM ('+sk.length+' gợi ý)</h3>';
  if(!sk.length)html+='<p class="text-xs text-gray">Chưa có gợi ý cho nhóm này.</p>';
  else{
    html+='<div class="tbl-wrap" style="background:white"><table><thead><tr>';
    html+='<th>Từ khóa đề xuất</th><th>Nhóm ý định (intent)</th><th>Loại khớp nên dùng</th><th>Volume ước tính</th><th>Lý do</th>';
    html+='</tr></thead><tbody>';
    for(var si2=0;si2<sk.length;si2++){
      var s=sk[si2];
      html+='<tr><td class="font-bold">'+esc(s.keyword)+'</td>';
      html+='<td><span class="pill">'+esc(s.intent_group)+'</span></td>';
      html+='<td class="text-xs">'+esc(trn(s.suggested_match_type,MATCH_VN))+'</td>';
      html+='<td class="text-xs">'+esc(s.estimated_volume==="medium"?"Trung bình":s.estimated_volume)+'</td>';
      html+='<td class="text-xs text-gray">'+esc(s.reason)+'</td></tr>';
    }
    html+='</tbody></table></div></div>';
  }

  // Banner Tips
  var bt=c.banner_improvement_tips||[];
  html+='<div id="suggest-banners-'+ck+'" class="suggest-block"><h3>Gợi ý cải thiện Banner ('+bt.length+' banner cần sửa)</h3>';
  if(!bt.length)html+='<p class="text-xs text-gray">Không có banner cần cải thiện.</p>';
  else{
    for(var tii=0;tii<bt.length;tii++){
      var tip=bt[tii];
      html+='<div class="tip-card">';
      html+='<div class="field"><span class="lbl">Banner:</span> <span class="mono">'+esc(tip.ad_name)+'</span> (id '+esc(tip.ad_id)+', size '+esc(tip.current_size)+', CTR '+fmtPct(tip.current_ctr)+')</div>';
      html+='<div class="field"><span class="lbl">Vấn đề:</span> '+esc(tip.problem)+'</div>';
      html+='<div class="field"><span class="lbl">Size nên dùng:</span> '+esc(tip.recommended_size)+'</div>';
      html+='<div class="field"><span class="lbl">Màu sắc:</span> '+esc(tip.recommended_colors)+'</div>';
      html+='<div class="field"><span class="lbl">Visual:</span> '+esc(tip.recommended_visual)+'</div>';
      html+='<div class="field"><span class="lbl">Headline:</span> "'+esc(tip.recommended_headline)+'"</div>';
      html+='<div class="field"><span class="lbl">CTA:</span> "'+esc(tip.recommended_cta)+'"</div>';
      html+='<div class="field"><span class="lbl">Social proof:</span> '+esc(tip.recommended_social_proof)+'</div>';
      html+='<div class="field text-xs" style="color:#6b7280;padding-top:4px;border-top:1px dashed #fde68a;margin-top:6px"><span class="lbl">Vì sao:</span> '+esc(tip.why)+'</div>';
      html+='</div>';
    }
  }
  html+='</div>';

  // A/B Test
  var ab=c.ab_test_suggestions||[];
  html+='<div id="suggest-abtest-'+ck+'" class="suggest-block"><h3>Gợi ý A/B Test ('+ab.length+' banner)</h3>';
  if(!ab.length)html+='<p class="text-xs text-gray">Không có banner cần A/B test.</p>';
  else{
    for(var abi=0;abi<ab.length;abi++){
      var tt=ab[abi];
      html+='<div class="tip-card">';
      html+='<div class="field"><span class="lbl">Banner test:</span> <span class="mono">'+esc(tt.ad_name)+'</span> (CTR: '+fmtPct(tt.current_ctr)+')</div>';
      var vs=tt.test_variants||[];
      html+='<div class="field"><span class="lbl">Các variant:</span></div><ol style="margin-left:24px;font-size:12px">';
      for(var vi=0;vi<vs.length;vi++){
        var v=vs[vi];
        html+='<li><strong>'+esc(v.variant)+'</strong> ('+esc(v.angle)+') — "'+esc(v.headline)+'" · '+esc(v.purpose)+'</li>';
      }
      html+='</ol>';
      html+='<div class="field"><span class="lbl">Ngân sách:</span> '+esc(tt.budget_split)+'</div>';
      html+='<div class="field"><span class="lbl">Tiêu chí thắng:</span> '+esc(tt.success_metric)+'</div>';
      html+='<div class="field text-xs" style="color:#047857"><span class="lbl">Kỳ vọng:</span> '+esc(tt.estimated_lift)+'</div>';
      html+='</div>';
    }
  }
  html+='</div>';

  // Title Analysis
  var ta=c.title_analysis||[];
  html+='<div id="suggest-titles-'+ck+'" class="suggest-block"><h3>Phân tích Tiêu đề Quảng cáo ('+ta.length+' tiêu đề)</h3>';
  if(!ta.length)html+='<p class="text-xs text-gray">Chưa có tiêu đề để phân tích.</p>';
  else{
    html+='<div class="tbl-wrap" style="background:white;max-height:none"><table><thead><tr>';
    html+='<th>Tiêu đề</th><th>Ad group</th><th class="t-right">Chi tiêu</th><th class="t-right">CTR</th><th>Chất lượng</th><th>Hành động</th><th>Gợi ý cải thiện</th>';
    html+='</tr></thead><tbody>';
    for(var tii2=0;tii2<ta.length;tii2++){
      var tt2=ta[tii2];
      html+='<tr><td><span class="truncate" title="'+esc(tt2.full_title)+'">'+esc(tt2.title_snippet)+'</span></td>';
      html+='<td class="text-xs">'+esc(tt2.ad_group_name)+'</td>';
      html+='<td class="t-right">'+fmtVND(tt2.spend_30d)+'đ</td>';
      html+='<td class="t-right">'+fmtPct(tt2.ctr_30d)+'</td>';
      var qC=tt2.quality==="tốt"?"pill-green":(tt2.quality==="kém"?"pill-orange":"pill");
      html+='<td><span class="pill '+qC+'">'+esc(tt2.quality)+'</span></td>';
      var recCls=tt2.recommendation==="GIỮ"?"KEEP":(tt2.recommendation==="VIẾT LẠI"?"REPLACE":"REVIEW");
      html+='<td><span class="rec rec-'+recCls+'">'+esc(tt2.recommendation)+'</span></td>';
      html+='<td class="text-xs text-gray">'+esc(tt2.suggested_improvement||"-")+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }
  html+='</div>';

  return html;
}

load();

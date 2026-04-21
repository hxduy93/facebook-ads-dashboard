#!/usr/bin/env python3
"""
Generate Agent Google Doscom daily report v3 — cấu trúc chi tiết theo category/SP.

Mỗi category (MAYDO/DINHVI/GHIAM/CAMCALL/OTHER_*) có:
  - Keywords table với recommendation: KEEP/SCALE/PAUSE/ADD_NEGATIVE/REVIEW/MONITOR
  - Banners table với recommendation: KEEP/REPLACE/PAUSE/MONITOR
  - Summary actions cụ thể (add/remove keyword, replace banner nào)

Cộng thêm products ranking (Pancake revenue) + ROAS per category.

Input:
  - data/google-ads-context.json
  - data/google-ads-search-terms.json
  - data/google-ads-ads.json
  - data/product-revenue.json

Output:
  - data/google-ads-daily-report.json (v3)
"""

import os
import json
import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CTX_FILE = os.path.join(REPO_ROOT, "data", "google-ads-context.json")
ST_FILE = os.path.join(REPO_ROOT, "data", "google-ads-search-terms.json")
ADS_FILE = os.path.join(REPO_ROOT, "data", "google-ads-ads.json")
PL_FILE = os.path.join(REPO_ROOT, "data", "google-ads-placement.json")
REV_FILE = os.path.join(REPO_ROOT, "data", "product-revenue.json")
OUT_FILE = os.path.join(REPO_ROOT, "data", "google-ads-daily-report.json")

# Category display names + product mapping
CATEGORY_META = {
    "MAYDO": {"name": "Máy dò nghe lén", "products": ["D1", "D1 Pro", "D2", "D3", "D4", "D5", "D8 Pro"]},
    "DINHVI": {"name": "Thiết bị định vị GPS", "products": ["DV1 Pro", "DV1", "DV2"]},
    "GHIAM": {"name": "Thiết bị ghi âm", "products": ["DR1", "DR4 Plus", "DR2", "DR3"]},
    "CAMCALL": {"name": "Camera gọi 2 chiều", "products": ["DA8.1", "DA8.1 Pro"]},
    "OTHER_DI": {"name": "Thiết bị chống ghi âm", "products": []},
    "OTHER_SIM": {"name": "SIM 4G", "products": []},
    "OTHER_CAM": {"name": "Camera mini/WiFi/4G/NLMT", "products": []},
    "OTHER_RAZOR": {"name": "Máy cạo râu", "products": []},
    "OTHER": {"name": "Khác", "products": []},
}


def _load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[WARN] {path}: {e}", file=sys.stderr)
        return {}


def detect_category(name: str) -> str:
    import re
    n = (name or "").lower()
    if "máy dò" in n or "tb dò" in n:
        return "MAYDO"
    if "tbđv gps" in n or "thiết bị định vị" in n or "shopping - 6/6 - đv" in n:
        return "DINHVI"
    if "tb ghi âm" in n or "thiết bị ghi âm" in n or (re.search(r"\bghi âm\b", n) and "chống" not in n):
        return "GHIAM"
    if "camera gọi 2 chiều" in n:
        return "CAMCALL"
    if "chống ghi âm" in n:
        return "OTHER_DI"
    if re.search(r"\bsim\s*4g\b", n):
        return "OTHER_SIM"
    if "cạo râu" in n or "cao rau" in n:
        return "OTHER_RAZOR"
    if (re.search(r"cam\s*(mini|wifi|nlmt|4g)", n)
        or "camera wifi" in n or "camera 4g" in n or "camera mini" in n
        or re.search(r"nlmt", n)):
        return "OTHER_CAM"
    return "OTHER"


def classify_keyword(m: dict) -> tuple:
    """Return (recommendation, reason) cho 1 keyword dựa vào metrics."""
    spend = m["spend_30d"]
    clicks = m["clicks_30d"]
    ctr = m["ctr_30d"]
    conv = m["conversions_30d"]
    statuses = m.get("statuses") or []
    status_str = "/".join(statuses) if statuses else "NONE"

    # SCALE: CTR tốt + conv nhiều + spend chưa quá cao
    if ctr > 0.05 and conv >= 3 and spend < 2_000_000:
        return "SCALE", f"CTR {ctr*100:.1f}% cao, {conv} conv/30d, còn room tăng bid"

    # KEEP: có conversion
    if conv >= 1:
        return "KEEP", f"Có {conv} conv/30d, CTR {ctr*100:.1f}%, giữ nguyên"

    # ADD_NEGATIVE: spend > 50k, 0 conv, chưa excluded, chưa ADDED
    if spend >= 50_000 and conv == 0 and "NONE" in statuses and "ADDED" not in statuses:
        return "ADD_NEGATIVE", f"Spend {spend/1000:.0f}K, {clicks} click, 0 conv, chưa add negative"

    # PAUSE: đã ADDED nhưng không hiệu quả (spend > 200k, 0 conv)
    if spend >= 200_000 and conv == 0 and "ADDED" in statuses:
        return "PAUSE", f"Đã ADDED nhưng spend {spend/1000:.0f}K với 0 conv — pause keyword"

    # REVIEW: spend cao, CTR thấp
    if spend >= 100_000 and ctr < 0.02:
        return "REVIEW", f"Spend {spend/1000:.0f}K, CTR chỉ {ctr*100:.1f}% — review relevance"

    return "MONITOR", f"Spend {spend/1000:.0f}K, CTR {ctr*100:.1f}%, {conv} conv — theo dõi thêm"


def classify_banner(m: dict) -> tuple:
    """Return (recommendation, reason, suggested_size) cho 1 banner."""
    spend = m["spend_30d"]
    ctr = m["ctr_30d"]
    imp = m["impressions_30d"]
    clicks = m["clicks_30d"]
    ad_name = m.get("ad_name", "")

    # Extract current banner size
    import re
    size_match = re.search(r"(\d{2,4}x\d{2,4})", ad_name or "")
    size = size_match.group(1) if size_match else None

    # KEEP: CTR tốt
    if ctr > 0.03 and imp > 500:
        return "KEEP", f"CTR {ctr*100:.2f}% tốt, {imp:,} imp — giữ", size

    # PAUSE: spend mà không click
    if spend >= 100_000 and clicks == 0:
        return "PAUSE", f"Spend {spend/1000:.0f}K mà 0 click — pause ngay", size

    # REPLACE: CTR quá thấp
    if ctr < 0.005 and imp > 500 and spend > 0:
        alt = "Thử size khác (300x250 thường tốt nhất GDN) hoặc đổi visual + headline"
        return "REPLACE", f"CTR {ctr*100:.2f}% quá thấp ({imp:,} imp). {alt}", size

    # LOW: CTR trung bình thấp
    if ctr < 0.01 and imp > 1000:
        return "REVIEW", f"CTR {ctr*100:.2f}%, dưới avg GDN (~1%) — A/B test visual mới", size

    return "MONITOR", f"CTR {ctr*100:.2f}%, spend {spend/1000:.0f}K — theo dõi", size


def analyze_keywords_by_category(st_data, campaign_to_cat):
    """Group search terms theo category (via campaign), return per-category keyword table."""
    terms = st_data.get("term_aggregates", {})
    by_cat = defaultdict(list)

    for term_text, m in terms.items():
        # Filter: hiển thị hết keyword đang chạy (có spend hoặc clicks hoặc conversions)
        if not (m["spend_30d"] > 0 or m["clicks_30d"] > 0 or m["conversions_30d"] > 0):
            continue

        # Xác định category qua campaigns
        cats = set()
        for camp in m.get("campaigns", []):
            cats.add(detect_category(camp))

        # Nếu term span nhiều category → chọn category có campaign đầu tiên
        primary_cat = list(cats)[0] if cats else "OTHER"

        rec, reason = classify_keyword(m)
        by_cat[primary_cat].append({
            "text": term_text,
            "match_type": "/".join(m.get("match_types", []) or ["—"]),
            "status": "/".join(m.get("statuses", []) or ["—"]),
            "spend_30d": m["spend_30d"],
            "clicks_30d": m["clicks_30d"],
            "ctr_30d": m["ctr_30d"],
            "conv_30d": m["conversions_30d"],
            "recommendation": rec,
            "reason": reason,
            "campaigns": list(m.get("campaigns", []))[:2],
        })

    # Sort per cat: priority actions trên đầu (SCALE/KEEP đầu, rồi ADD_NEGATIVE/PAUSE/REVIEW)
    priority_order = {"SCALE": 0, "KEEP": 1, "ADD_NEGATIVE": 2, "PAUSE": 3, "REVIEW": 4, "MONITOR": 5}
    for cat in by_cat:
        # Sort theo priority action trước
        by_cat[cat].sort(key=lambda k: (priority_order.get(k["recommendation"], 99), -k["spend_30d"]))
        # Thêm rank (xếp hạng nội bộ) theo hiệu quả: conv DESC, spend DESC, ctr DESC
        ranked = sorted(by_cat[cat], key=lambda k: (-k["conv_30d"], -k["spend_30d"], -k["ctr_30d"]))
        rank_map = {id(k): i+1 for i, k in enumerate(ranked)}
        for kw in by_cat[cat]:
            kw["rank_effectiveness"] = rank_map.get(id(kw), 999)

    return dict(by_cat)


def analyze_banners_by_category(ads_data):
    ads = ads_data.get("ad_aggregates", {})
    by_cat = defaultdict(list)

    for ad_id, m in ads.items():
        spend = m["spend_30d"]
        imp = m["impressions_30d"]
        # Filter: chỉ ad có spend > 10k hoặc impressions > 500
        if not (spend > 10_000 or imp > 500):
            continue

        cat = m["category"] or "OTHER"
        rec, reason, size = classify_banner(m)
        by_cat[cat].append({
            "ad_id": ad_id,
            "ad_name": m.get("ad_name") or "(no name)",
            "ad_format": m.get("ad_format") or "—",
            "current_size": size or "—",
            "campaign": m.get("campaign") or "",
            "ad_group_name": m.get("ad_group_name") or "",
            "spend_30d": spend,
            "clicks_30d": m["clicks_30d"],
            "impressions_30d": imp,
            "ctr_30d": m["ctr_30d"],
            "recommendation": rec,
            "reason": reason,
        })

    priority_order = {"PAUSE": 0, "REPLACE": 1, "REVIEW": 2, "KEEP": 3, "MONITOR": 4}
    for cat in by_cat:
        by_cat[cat].sort(key=lambda b: (priority_order.get(b["recommendation"], 99), -b["spend_30d"]))

    return dict(by_cat)


def summarize_category_actions(keywords, banners, cat_key):
    """Tổng hợp recommendations cụ thể cho 1 category."""
    actions = []
    cat_name = CATEGORY_META.get(cat_key, {}).get("name", cat_key)

    # Keywords
    add_neg = [k for k in keywords if k["recommendation"] == "ADD_NEGATIVE"]
    scale = [k for k in keywords if k["recommendation"] == "SCALE"]
    pause_kw = [k for k in keywords if k["recommendation"] == "PAUSE"]
    review_kw = [k for k in keywords if k["recommendation"] == "REVIEW"]

    if add_neg:
        terms = ", ".join([f'"{k["text"]}"' for k in add_neg[:3]])
        total_save = sum(k["spend_30d"] for k in add_neg)
        actions.append({
            "type": "ADD_NEGATIVE_KEYWORDS",
            "priority": "high",
            "title": f"Add {len(add_neg)} negative keyword",
            "detail": f"Top: {terms}" + (f" và {len(add_neg)-3} từ khóa khác" if len(add_neg) > 3 else ""),
            "estimated_saving_vnd": int(total_save),
        })

    if scale:
        terms_detail = []
        for k in scale[:5]:
            cur_bid = k.get("cpc_30d", 0) or round(k.get("spend_30d", 0) / max(k.get("clicks_30d", 1), 1))
            new_bid = round(cur_bid * 1.25)
            ktext = k.get("text", "")
            terms_detail.append("'" + ktext + "' CPC hiện " + format(cur_bid, ",.0f") + "đ → tăng +25% = " + format(new_bid, ",.0f") + "đ")
        actions.append({
            "type": "SCALE_KEYWORDS",
            "priority": "medium",
            "title": f"Tăng bid {len(scale)} từ khóa converting (+25%)",
            "detail": "Top: " + "; ".join(terms_detail[:3]) + ". Theo dõi sau 7 ngày: nếu conv rate không giảm, CPA ổn → giữ bid mới; nếu CPA tăng >20% → rollback về bid cũ.",
            "estimated_saving_vnd": 0,
        })

    if pause_kw:
        terms = ", ".join([f'"{k["text"]}"' for k in pause_kw[:3]])
        total_save = sum(k["spend_30d"] for k in pause_kw)
        actions.append({
            "type": "PAUSE_KEYWORDS",
            "priority": "high",
            "title": f"Pause {len(pause_kw)} keyword đã ADDED nhưng 0 conv",
            "detail": f"Top: {terms}",
            "estimated_saving_vnd": int(total_save),
        })

    if review_kw:
        terms = ", ".join([f'"{k["text"]}"' for k in review_kw[:3]])
        actions.append({
            "type": "REVIEW_KEYWORDS",
            "priority": "medium",
            "title": f"Review {len(review_kw)} keyword CTR thấp",
            "detail": f"Top: {terms}",
            "estimated_saving_vnd": 0,
        })

    # Banners
    replace_b = [b for b in banners if b["recommendation"] == "REPLACE"]
    pause_b = [b for b in banners if b["recommendation"] == "PAUSE"]
    review_b = [b for b in banners if b["recommendation"] == "REVIEW"]

    if replace_b:
        sizes = [b["current_size"] for b in replace_b[:3] if b["current_size"] != "—"]
        ad_ids = ", ".join([f"ad_id {b['ad_id']}" for b in replace_b[:3]])
        total_save = sum(b["spend_30d"] * 0.7 for b in replace_b)
        actions.append({
            "type": "REPLACE_BANNERS",
            "priority": "medium",
            "title": f"Thay {len(replace_b)} banner CTR quá thấp",
            "detail": f"Thay: {ad_ids}. Size hiện tại: {', '.join(set(sizes)) if sizes else '—'}. Gợi ý: thử 300x250 + visual sản phẩm rõ + CTA 'Đặt ngay' + social proof",
            "estimated_saving_vnd": int(total_save),
        })

    if pause_b:
        ad_ids = ", ".join([f"ad_id {b['ad_id']}" for b in pause_b[:3]])
        total_save = sum(b["spend_30d"] for b in pause_b)
        actions.append({
            "type": "PAUSE_BANNERS",
            "priority": "high",
            "title": f"Pause {len(pause_b)} banner spend 0 click",
            "detail": f"Top: {ad_ids}",
            "estimated_saving_vnd": int(total_save),
        })

    if review_b:
        actions.append({
            "type": "REVIEW_BANNERS",
            "priority": "low",
            "title": f"A/B test {len(review_b)} banner CTR dưới avg",
            "detail": f"Thử visual mới + headline mạnh (VD: '[SP] 5★ · Giao 2h' thay vì 'Mua ngay')",
            "estimated_saving_vnd": 0,
        })

    return actions


def build_product_ranking(rev_data, st_data, keywords_by_cat):
    """Build product revenue ranking CHỈ lấy từ 3 source: Website + Hotline + Zalo OA."""
    products = rev_data.get("products", {})
    products_by_status = rev_data.get("products_by_status", {})
    terms = st_data.get("term_aggregates", {})

    # products có total (all sources). Ta cần filter chỉ 3 nguồn.
    # Data source_groups trong rev_data chỉ có total theo status, chưa có per-product.
    # Dùng products_by_status với filter statuses trong ["delivered","other"], 
    # nhưng cần phân source. Hiện rev_data.products có "by_source" không?
    # Fallback: giả định products["total"] là tổng 3 nguồn (WEBSITE+HOTLINE+ZALO_OA) — gần đúng.
    # Nếu có field by_source → dùng. Check key đầu tiên.

    product_to_cat = {}
    for cat, meta in CATEGORY_META.items():
        for prod in meta["products"]:
            product_to_cat[prod] = cat

    # Merge products từ 3 source: WEBSITE + ZALO_OA + HOTLINE
    source_groups = rev_data.get("source_groups", {})
    merged_products = {}  # prod_name -> {"total", "orders", "by_date"}
    for src_name in ["WEBSITE", "ZALO_OA", "HOTLINE"]:
        s = source_groups.get(src_name, {})
        src_prods = s.get("products", {}) or {}
        for prod_name, pd in src_prods.items():
            if prod_name not in merged_products:
                merged_products[prod_name] = {"total": 0, "orders": 0, "by_date": {}}
            merged_products[prod_name]["total"] += pd.get("total", 0) or 0
            merged_products[prod_name]["orders"] += pd.get("orders", 0) or 0
            for d, v in (pd.get("by_date", {}) or {}).items():
                merged_products[prod_name]["by_date"][d] = merged_products[prod_name]["by_date"].get(d, 0) + v

    ranking = []
    # Dùng merged_products thay vì products cũ để loại DUY/PN
    all_products = set(list(products.keys()) + list(merged_products.keys()))
    for prod_name in all_products:
        cat = product_to_cat.get(prod_name, "OTHER")
        cat_keywords = keywords_by_cat.get(cat, [])

        mp = merged_products.get(prod_name, {"total": 0, "orders": 0})
        rev_3src = mp["total"]
        orders_3src = mp["orders"]

        # Skip nếu không có revenue từ 3 source
        if rev_3src == 0 and orders_3src == 0:
            continue

        linked_kws = sorted(
            [k for k in cat_keywords if k["conv_30d"] > 0],
            key=lambda x: -x["conv_30d"]
        )[:3]
        ranking.append({
            "product": prod_name,
            "category": cat,
            "category_name": CATEGORY_META.get(cat, {}).get("name", cat),
            "revenue_30d": rev_3src,
            "orders_30d": orders_3src,
            "avg_order_value": round(rev_3src / orders_3src, 0) if orders_3src > 0 else 0,
            "source_note": "Website + Hotline + Zalo OA (loại DUY/PN staff)",
            "related_keywords_top_convert": [
                {"text": k["text"], "conv_30d": k["conv_30d"], "spend_30d": k["spend_30d"]}
                for k in linked_kws
            ],
        })

    ranking.sort(key=lambda x: -x["revenue_30d"])
    return ranking


def main():
    print("[INFO] Loading data...")
    ctx = _load_json(CTX_FILE)
    st = _load_json(ST_FILE)
    ads = _load_json(ADS_FILE)
    pl = _load_json(PL_FILE)
    rev = _load_json(REV_FILE)

    per_camp = ctx.get("per_campaign", {})
    per_cat = ctx.get("per_category", {})
    roas = ctx.get("roas_proxy", {})
    summary = ctx.get("summary", {})
    website_rev = ctx.get("website_revenue_pancake", {})

    print("[INFO] Analyzing keywords by category...")
    campaign_to_cat = {c: m.get("category", "OTHER") for c, m in per_camp.items()}
    keywords_by_cat = analyze_keywords_by_category(st, campaign_to_cat)

    print("[INFO] Analyzing banners by category...")
    banners_by_cat = analyze_banners_by_category(ads)

    print("[INFO] Building product ranking...")
    product_ranking = build_product_ranking(rev, st, keywords_by_cat)

    print("[INFO] Building per-category details...")
    categories_report = {}
    for cat_key in CATEGORY_META.keys():
        cat_data = per_cat.get(cat_key, {})
        ads_spend = cat_data.get("spend_30d", 0)
        cat_keywords = keywords_by_cat.get(cat_key, [])
        cat_banners = banners_by_cat.get(cat_key, [])

        # Revenue từ products thuộc category
        cat_revenue = 0
        cat_orders = 0
        for p in product_ranking:
            if p["category"] == cat_key:
                cat_revenue += p["revenue_30d"]
                cat_orders += p["orders_30d"]

        roas_cat = round(cat_revenue / ads_spend, 2) if ads_spend > 0 else 0

        summary_actions = summarize_category_actions(cat_keywords, cat_banners, cat_key)

        categories_report[cat_key] = {
            "display_name": CATEGORY_META[cat_key]["name"],
            "products": CATEGORY_META[cat_key]["products"],
            "ads_spend_30d": round(ads_spend, 0),
            "ads_clicks_30d": cat_data.get("clicks_30d", 0),
            "ads_impressions_30d": cat_data.get("impressions_30d", 0),
            "ads_ctr_30d": cat_data.get("ctr_30d", 0),
            "ads_cpc_30d": cat_data.get("cpc_30d", 0),
            "revenue_pancake_30d": cat_revenue,
            "orders_pancake_30d": cat_orders,
            "roas_proxy": roas_cat,
            "campaign_count": cat_data.get("campaign_count", 0),
            "keywords_count": len(cat_keywords),
            "banners_count": len(cat_banners),
            "keywords": cat_keywords[:100],  # Top 12 per cat (limit output size, tối ưu load speed)
            "banners": cat_banners[:50],
            "summary_actions": summary_actions,
            "suggested_keywords": suggest_keywords_for_category(cat_key, cat_keywords),
            "banner_improvement_tips": generate_banner_improvement_tips(cat_banners, cat_key),
            "ab_test_suggestions": generate_ab_test_suggestions(cat_banners, cat_key),
            "title_analysis": generate_title_analysis(ads, cat_key, None),
            "placement_quality": analyze_placement_quality(pl, ads, cat_key),
            "banner_size_analysis": analyze_banner_sizes(ads, cat_key),
            "customer_psychology": get_customer_psychology_for_category(cat_key),
        }
        categories_report[cat_key]["evaluation"] = build_category_evaluation(categories_report[cat_key], cat_key)

    # Overall score từ v2 schema (giữ compatible)
    total_spend = summary.get("total_spend_30d_vnd", 0)
    total_rev = website_rev.get("total_30d", 0)
    r = roas.get("roas_overall", 0)

    # Score (dùng scoring v2 đơn giản)
    scores = {
        "conversion_tracking": 5 if total_rev / max(total_spend, 1) >= 0.2 else (3 if total_rev > 0 else 0),
        "keyword_hygiene": max(1, 5 - sum(1 for kws in keywords_by_cat.values() for k in kws if k["recommendation"] == "ADD_NEGATIVE") // 5),
        "banner_health": max(1, 5 - sum(1 for bns in banners_by_cat.values() for b in bns if b["recommendation"] in ("REPLACE", "PAUSE"))),
        "spend_efficiency": 5 if r >= 3 else (3 if r >= 1.5 else (2 if r >= 1 else 1)),
        "campaign_structure": 4 if summary.get("total_campaigns", 0) >= 15 else 3,
    }
    total = sum(scores.values())
    overall = round(total * 100 / 25)
    grade = "A" if overall >= 90 else ("B" if overall >= 75 else ("C" if overall >= 60 else ("D" if overall >= 40 else "F")))

    now_vn = datetime.now(timezone(timedelta(hours=7)))

    # Build top-level verdict
    total_actions = sum(len(c["summary_actions"]) for c in categories_report.values())
    urgent_actions = sum(1 for c in categories_report.values() for a in c["summary_actions"] if a["priority"] == "high")
    total_saving = sum(a["estimated_saving_vnd"] for c in categories_report.values() for a in c["summary_actions"])

    headline = (
        f"Score {overall}/100 ({grade}) · ROAS {r}x · "
        f"{urgent_actions}/{total_actions} hành động ưu tiên cao · "
        f"Có thể tiết kiệm ~{total_saving/1_000_000:.1f}tr/30d"
    )

    verdict = (
        f"Google Ads chi {total_spend/1_000_000:.1f}tr/30d ra {total_rev/1_000_000:.1f}tr Website (ROAS {r}x). "
        f"Phân tích chi tiết {len(keywords_by_cat)} category với {sum(len(v) for v in keywords_by_cat.values())} keyword active, "
        f"{sum(len(v) for v in banners_by_cat.values())} banner. "
        f"Tổng có thể tiết kiệm/tối ưu {total_saving/1_000_000:.1f}tr/30d qua {total_actions} hành động. "
        f"Xem bảng chi tiết từng nhóm sản phẩm bên dưới."
    )

    score_summary_data = build_score_summary(categories_report, {
        "total_actions": total_actions,
        "urgent_actions": urgent_actions,
        "estimated_total_saving_vnd": total_saving,
    }, roas)

    # Build time_periods block — load spend file để có campaigns_raw theo ngày
    GA_SPEND_FILE = os.path.join(REPO_ROOT, "data", "google-ads-spend.json")
    ga_spend_data = _load_json(GA_SPEND_FILE)
    _all_dates = sorted(set(r.get("date", "") for r in ga_spend_data.get("campaigns_raw", []) if r.get("date")))
    today_str = _all_dates[-1] if _all_dates else now_vn.strftime("%Y-%m-%d")
    print(f"[INFO] Computing time periods (reference date: {today_str})...")
    time_periods = build_time_periods(ga_spend_data, rev, today_str)

    vn_tips = get_vn_culture_tips(today_str)

    report = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "score_summary": score_summary_data,
        "time_periods": time_periods,
        "vn_culture_tips": vn_tips,
        "version": "3.0",
        "period": {
            "start": ctx.get("source_data_date_range", {}).get("start_30d", ""),
            "end": ctx.get("source_data_date_range", {}).get("end", ""),
        },
        "ga_account": ctx.get("ga_account", {}),
        "score": overall,
        "grade": grade,
        "score_detail": {k: {"score": v, "max": 5} for k, v in scores.items()},
        "headline": headline,
        "verdict": verdict,
        "totals": {
            "ads_spend_30d": total_spend,
            "website_revenue_30d": total_rev,
            "roas_overall": r,
            "total_actions": total_actions,
            "urgent_actions": urgent_actions,
            "estimated_total_saving_vnd": total_saving,
        },
        "categories": categories_report,
        "products_ranking": product_ranking,
        "key_findings": [
            f"Tổng {total_actions} action từ {len(categories_report)} category (urgent: {urgent_actions})",
            f"Tiết kiệm tiềm năng: {total_saving/1_000_000:.1f}tr/30d",
            f"Top SP revenue: {product_ranking[0]['product']} ({product_ranking[0]['revenue_30d']/1_000_000:.0f}tr, {product_ranking[0]['orders_30d']} đơn)" if product_ranking else "",
            f"Search terms: {sum(len(v) for v in keywords_by_cat.values())} meaningful / {st.get('unique_search_terms', 0):,} total",
            f"Banners: {sum(len(v) for v in banners_by_cat.values())} meaningful / {ads.get('unique_ads', 0):,} total",
        ],
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] {OUT_FILE}")
    print(f"       Score: {overall}/100 ({grade}) · ROAS {r}x")
    print(f"       Categories: {len(categories_report)}")
    print(f"       Total actions: {total_actions} (urgent: {urgent_actions})")
    print(f"       Potential saving: {total_saving/1_000_000:.1f}tr/30d")
    print(f"\n       Top 3 category by spend:")
    cats_by_spend = sorted(categories_report.items(), key=lambda x: -x[1]["ads_spend_30d"])[:3]
    for cat, c in cats_by_spend:
        print(f"         {c['display_name']:25s}: spend {c['ads_spend_30d']/1_000_000:.1f}tr · {c['keywords_count']} kw · {c['banners_count']} banner · {len(c['summary_actions'])} action")




def suggest_keywords_for_category(category_key, existing_keywords):
    """
    Rule-based suggest keyword MỚI dựa vào top converting keywords của category.
    Mỗi category có seed patterns — expand thành biến thể intent-driven.
    """
    # Keywords template cho mỗi category (rule-based, không AI)
    SEED_TEMPLATES = {
        "MAYDO": {
            "intent_buy": [
                "mua máy dò camera ẩn chính hãng",
                "máy dò thiết bị nghe lén giá rẻ",
                "thiết bị phát hiện camera quay lén tốt nhất",
                "máy dò nghe lén giá bao nhiêu",
                "mua máy dò định vị ở đâu",
            ],
            "intent_compare": [
                "so sánh máy dò nghe lén",
                "review máy dò camera ẩn",
                "máy dò nghe lén loại nào tốt",
                "đánh giá thiết bị phát hiện camera",
            ],
            "intent_location": [
                "mua máy dò nghe lén tại hà nội",
                "máy dò camera ẩn tphcm",
                "cửa hàng bán máy dò thiết bị ẩn",
            ],
            "intent_brand": [
                "máy dò nghe lén doscom",
                "doscom da1 pro",
                "thiết bị an ninh doscom",
            ],
            "reason": "Intent mua cao + brand keyword (CTR cao, CPC thấp)",
        },
        "DINHVI": {
            "intent_buy": [
                "mua thiết bị định vị gps chính hãng",
                "thiết bị định vị xe máy có sim",
                "định vị ô tô không dây",
                "thiết bị định vị theo dõi con",
                "gps tracker cho xe máy",
            ],
            "intent_compare": [
                "review thiết bị định vị gps",
                "thiết bị định vị nào tốt nhất",
                "so sánh định vị wifi và gps",
            ],
            "intent_feature": [
                "thiết bị định vị không cần sim",
                "định vị pin trâu 30 ngày",
                "thiết bị định vị siêu nhỏ",
            ],
            "intent_target": [
                "định vị ngoại tình",
                "theo dõi chồng qua điện thoại",
                "định vị xe công",
            ],
            "reason": "Target audience cao + feature-specific (intent rõ ràng)",
        },
        "GHIAM": {
            "intent_buy": [
                "mua máy ghi âm bí mật",
                "thiết bị ghi âm cuộc họp chuyên nghiệp",
                "máy ghi âm mini giá rẻ",
                "máy ghi âm cao cấp chính hãng",
                "ghi âm lén chất lượng cao",
            ],
            "intent_feature": [
                "máy ghi âm pin trâu 24h",
                "thiết bị ghi âm không phát hiện",
                "máy ghi âm kích hoạt giọng nói",
                "ghi âm chuyển text tự động",
            ],
            "intent_use": [
                "ghi âm cuộc họp quan trọng",
                "ghi âm phỏng vấn",
                "ghi âm lớp học sinh viên",
            ],
            "reason": "Intent use-case cụ thể + feature premium",
        },
        "CAMCALL": {
            "intent_buy": [
                "mua camera gọi 2 chiều chính hãng",
                "camera giám sát có loa",
                "camera wifi đàm thoại",
                "camera xoay 360 gọi video",
            ],
            "intent_use": [
                "camera trông trẻ từ xa",
                "camera giám sát cửa hàng",
                "camera nhà có người già",
            ],
            "intent_feature": [
                "camera chống nước ngoài trời",
                "camera ban đêm hồng ngoại",
                "camera ai phát hiện người",
            ],
            "reason": "Use-case cụ thể (trông trẻ, giám sát cửa hàng) CTR cao",
        },
        "OTHER_DI": {
            "intent_buy": [
                "thiết bị chống nghe lén văn phòng",
                "máy chống ghi âm cuộc họp",
                "thiết bị bảo mật phòng họp",
                "chống nghe lén điện thoại",
            ],
            "intent_target": [
                "chống gián điệp doanh nghiệp",
                "bảo vệ thông tin cuộc họp",
            ],
            "reason": "B2B audience, bảo mật doanh nghiệp",
        },
        "OTHER_SIM": {
            "intent_buy": [
                "camera sim 4g ngoài trời",
                "camera 4g không wifi",
                "camera 4g chống nước",
            ],
            "reason": "Feature-specific cho người không có wifi",
        },
        "OTHER_CAM": {
            "intent_buy": [
                "camera mini siêu nhỏ",
                "camera wifi không dây chính hãng",
                "camera năng lượng mặt trời",
                "camera kết nối điện thoại",
            ],
            "intent_location": [
                "camera ngoài trời chống nước",
                "camera gara ô tô",
                "camera cổng nhà",
            ],
            "reason": "Feature + location intent",
        },
        "OTHER_RAZOR": {
            "intent_buy": [
                "mua máy cạo râu mini chính hãng",
                "máy cạo râu du lịch",
                "máy cạo râu không dây giá rẻ",
            ],
            "reason": "Intent mua trực tiếp",
        },
    }

    seed = SEED_TEMPLATES.get(category_key, {})
    if not seed:
        return []

    existing_texts = set(k.get("text", "").lower() for k in existing_keywords)
    suggestions = []

    for intent_type, keywords_list in seed.items():
        if intent_type == "reason":
            continue
        for kw in keywords_list:
            if kw.lower() in existing_texts:
                continue  # Skip keyword đã có
            suggestions.append({
                "keyword": kw,
                "intent_group": {
                "buy": "Mua hàng",
                "compare": "So sánh",
                "location": "Địa điểm",
                "brand": "Thương hiệu",
                "feature": "Tính năng",
                "use": "Sử dụng",
                "target": "Đối tượng mục tiêu",
            }.get(intent_type.replace("intent_", ""), intent_type.replace("intent_", "")),
                "suggested_match_type": "PHRASE" if "mua" in kw or "giá" in kw else "BROAD",
                "estimated_volume": "medium",
                "reason": seed.get("reason", ""),
            })

    return suggestions[:15]  # Top 15 per category


def generate_banner_improvement_tips(banners, category_key):
    """Tạo gợi ý CỤ THỂ về content/color/layout cho banner CTR thấp."""
    tips = []
    # Template cho mỗi category
    VISUAL_TEMPLATES = {
        "MAYDO": {
            "colors": ["Đỏ cam #ef4444 + đen #1f2937 (tạo cảm giác urgent + bảo mật)"],
            "visual": "Hình máy dò rõ nét + icon tia sóng phát hiện + hình ảnh người lén nhìn (ẩn dụ threat)",
            "headline": "Phát hiện 100% thiết bị ẩn trong 30 giây · Bảo vệ quyền riêng tư",
            "cta": "Đặt ngay · Giao 2h nội thành",
            "social_proof": "Sao ★★★★★ 4.9/5 · Hơn 15.000 khách hàng tin dùng",
        },
        "DINHVI": {
            "colors": ["Xanh dương #2563eb + trắng (tin cậy, công nghệ)"],
            "visual": "Hình map + vị trí pin + hình xe máy/ô tô, có đường gps thật",
            "headline": "Định vị chính xác 1m · Pin 30 ngày · Chống nước IP68",
            "cta": "Mua ngay với giá ưu đãi",
            "social_proof": "Bảo hành 24 tháng · Hơn 20.000 người dùng",
        },
        "GHIAM": {
            "colors": ["Đen #0f172a + vàng #fbbf24 (pro, premium)"],
            "visual": "Close-up máy ghi âm mini trong tay + waveform + biểu tượng tai nghe",
            "headline": "Ghi âm chuyên nghiệp · Pin 24h · Chuyển text tự động AI",
            "cta": "Đặt hàng hôm nay · Giảm 20%",
            "social_proof": "Top ghi âm 2025 · Đã có 10K đơn hàng",
        },
        "CAMCALL": {
            "colors": ["Xanh lá #10b981 + trắng (an toàn, gần gũi)"],
            "visual": "Hình gia đình + camera trong phòng khách + icon video call",
            "headline": "Gọi video 2 chiều · Xoay 360° · Nhìn rõ cả đêm",
            "cta": "Mua ngay giữ an toàn cả nhà",
            "social_proof": "Đánh giá 4.8★ · 5.000+ gia đình tin dùng",
        },
        "OTHER_CAM": {
            "colors": ["Xám đen + cam (công nghệ, năng động)"],
            "visual": "Camera + đèn LED + hình ảnh an ninh/giám sát rõ nét",
            "headline": "Giám sát 24/7 · Wifi không dây · Xem từ xa qua điện thoại",
            "cta": "Đặt ngay hôm nay",
            "social_proof": "Cam kết hoàn tiền 30 ngày",
        },
    }

    template = VISUAL_TEMPLATES.get(category_key, VISUAL_TEMPLATES.get("OTHER_CAM"))

    # Filter banner cần improve
    to_fix = [b for b in banners if b.get("recommendation") in ("REPLACE", "PAUSE", "REVIEW")]
    if not to_fix:
        return []

    for b in to_fix[:8]:
        problem = ""
        current_ctr = b.get("ctr_30d", 0)
        if current_ctr < 0.002:
            problem = "CTR cực thấp (< 0.2%) — visual không thu hút, headline không rõ value"
        elif current_ctr < 0.005:
            problem = "CTR thấp (< 0.5%) — có thể do size không tối ưu hoặc message chưa đủ mạnh"
        elif current_ctr < 0.01:
            problem = "CTR dưới avg (< 1%) — cần A/B test visual + headline mới"

        tips.append({
            "ad_id": b.get("ad_id"),
            "ad_name": b.get("ad_name"),
            "current_size": b.get("current_size") or "N/A",
            "current_ctr": current_ctr,
            "problem": problem,
            "recommended_size": "300x250 (performance cao nhất GDN), 336x280, 728x90",
            "recommended_colors": template["colors"][0],
            "recommended_visual": template["visual"],
            "recommended_headline": template["headline"],
            "recommended_cta": template["cta"],
            "recommended_social_proof": template["social_proof"],
            "why": "Size 300x250 chiếm 80% traffic GDN. Color high-contrast giúp thu hút attention. Headline ngắn gọn + benefit rõ + social proof tăng trust = CTR tốt hơn 3-5x",
        })

    return tips


def generate_ab_test_suggestions(banners, category_key):
    """Chi tiết A/B test versions cho banners CTR trung bình."""
    to_test = [b for b in banners if b.get("recommendation") == "REVIEW"]
    if not to_test:
        return []

    AB_TEMPLATES = {
        "MAYDO": {
            "test_a": {"headline": "Phát hiện thiết bị ẩn trong 30s", "angle": "Speed/Technology"},
            "test_b": {"headline": "Bảo vệ quyền riêng tư - Nhà bạn có bị theo dõi?", "angle": "Emotional/Fear"},
            "test_c": {"headline": "Chuyên gia an ninh khuyên dùng · 15K+ khách", "angle": "Authority/Social"},
        },
        "DINHVI": {
            "test_a": {"headline": "Định vị chính xác 1m · Pin 30 ngày", "angle": "Feature"},
            "test_b": {"headline": "Yên tâm biết chồng con đang ở đâu", "angle": "Emotional/Family"},
            "test_c": {"headline": "Ưu đãi 20% · Giao 2h miễn phí", "angle": "Promo/Urgency"},
        },
        "GHIAM": {
            "test_a": {"headline": "Ghi âm HD · Pin 24h · Không bị phát hiện", "angle": "Feature"},
            "test_b": {"headline": "Bảo vệ bản thân bằng bằng chứng rõ ràng", "angle": "Protection"},
            "test_c": {"headline": "Top máy ghi âm 2025 · Đánh giá 4.9★", "angle": "Social/Review"},
        },
    }

    template = AB_TEMPLATES.get(category_key, {
        "test_a": {"headline": "Giá tốt · Giao nhanh 2h", "angle": "Promo"},
        "test_b": {"headline": "Chính hãng · Bảo hành 24 tháng", "angle": "Trust"},
        "test_c": {"headline": "Hơn 10.000 khách hài lòng · 4.8★", "angle": "Social"},
    })

    suggestions = []
    for b in to_test[:5]:
        suggestions.append({
            "ad_id": b.get("ad_id"),
            "ad_name": b.get("ad_name"),
            "current_ctr": b.get("ctr_30d", 0),
            "test_variants": [
                {"variant": "A (Control hiện tại)", "headline": "Giữ nguyên", "angle": "Baseline", "purpose": "Đối chứng"},
                {"variant": "B", "headline": template["test_a"]["headline"], "angle": template["test_a"]["angle"], "purpose": "Test feature-driven"},
                {"variant": "C", "headline": template["test_b"]["headline"], "angle": template["test_b"]["angle"], "purpose": "Test emotional"},
                {"variant": "D", "headline": template["test_c"]["headline"], "angle": template["test_c"]["angle"], "purpose": "Test authority/promo"},
            ],
            "budget_split": "25% mỗi variant trong 14 ngày",
            "success_metric": "CTR > 2x hiện tại + CPA không tăng",
            "estimated_lift": "CTR có thể tăng 2-4x nếu variant winner rõ ràng",
        })

    return suggestions


def generate_title_analysis(ads_data, category_key, ads_raw_for_cat):
    """Phân tích tiêu đề quảng cáo RSA per category.
    Với Windsor free trial không expose text, ta dùng ad_name + ad_id để reference.
    """
    # Ads thuộc category có spend meaningful
    titles = []
    for ad_id, m in ads_data.get("ad_aggregates", {}).items():
        if m.get("category") != category_key:
            continue
        if m.get("spend_30d", 0) < 30000:
            continue
        # Ad có ad_name là RSA text dài (200+ chars) thì coi là title
        ad_name = m.get("ad_name") or ""
        # Show tất cả ads có tên đủ ý nghĩa (>= 30 chars) hoặc format RSA
        if m.get("ad_format") == "RSA" or len(ad_name) >= 10:
            ctr = m.get("ctr_30d", 0)
            titles.append({
                "ad_id": ad_id,
                "title_snippet": ad_name[:150] + ("..." if len(ad_name) > 150 else ""),
                "full_title": ad_name,
                "ad_group_name": m.get("ad_group_name", ""),
                "spend_30d": m.get("spend_30d", 0),
                "clicks_30d": m.get("clicks_30d", 0),
                "ctr_30d": ctr,
                "quality": "tốt" if ctr > 0.05 else ("trung bình" if ctr > 0.02 else "kém"),
                "recommendation": "GIỮ" if ctr > 0.05 else ("A/B TEST" if ctr > 0.02 else "VIẾT LẠI"),
                "suggested_improvement": _suggest_title_improvement(ad_name, ctr, category_key) if ctr < 0.05 else "",
            })

    titles.sort(key=lambda x: -x["spend_30d"])
    return titles[:100]


def _suggest_title_improvement(current, ctr, category_key):
    templates = {
        "MAYDO": "Thêm urgency + specific benefit: 'Phát hiện 100% thiết bị ẩn · 30s · Bảo hành 24 tháng'. Pattern: [Benefit cụ thể] · [Speed/Time] · [Trust signal]",
        "DINHVI": "Thêm proof + feature: 'Định vị 1m · Pin 30 ngày · 20K khách tin dùng'. Dùng số đo đạc cụ thể",
        "GHIAM": "Professional angle: 'Ghi âm chuyên nghiệp · HD · Chuyển text AI'. Target B2B users",
        "CAMCALL": "Family angle: 'Gọi 2 chiều · Xoay 360° · Bảo vệ cả nhà 24/7'",
        "OTHER_DI": "B2B trust: 'Bảo mật phòng họp · Chống nghe lén · Cam kết hoàn tiền'",
        "OTHER_CAM": "Convenience: 'Wifi không dây · Xem điện thoại · Ban đêm rõ nét'",
    }
    return templates.get(category_key, "Rewrite với format: [Benefit] · [Feature cụ thể] · [Social proof]")


def build_score_summary(categories, totals, roas):
    """Bullet points điểm tốt + cần cải thiện, highlight cho UI."""
    good = []
    bad = []

    # Analyze từng category
    for cat_key, c in categories.items():
        display_name = c.get("display_name", cat_key)
        cat_roas = c.get("roas_proxy", 0)
        ads_spend = c.get("ads_spend_30d", 0)
        rev = c.get("revenue_pancake_30d", 0)
        ctr = c.get("ads_ctr_30d", 0)

        if ads_spend < 500_000:
            continue  # Skip category spend quá nhỏ

        # Điểm tốt
        if cat_roas >= 3:
            good.append({
                "icon": "star",
                "color": "green",
                "text": f"Nhóm **{display_name}** có ROAS {cat_roas}x (cao hơn target 3x), chi {ads_spend/1_000_000:.1f}tr ra {rev/1_000_000:.1f}tr doanh thu"
            })
        if ctr > 0.05:
            good.append({
                "icon": "check",
                "color": "green",
                "text": f"Nhóm **{display_name}** CTR {ctr*100:.1f}% (rất tốt, cao hơn avg industry ~3-4%)"
            })

        # Điểm cần cải thiện
        if 0 < cat_roas < 0.5 and ads_spend > 2_000_000:
            bad.append({
                "icon": "warning",
                "color": "red",
                "text": f"Nhóm **{display_name}** ROAS chỉ {cat_roas}x (lỗ), spend {ads_spend/1_000_000:.1f}tr mà rev chỉ {rev/1_000_000:.1f}tr — cần urgent review"
            })
        if ctr < 0.01 and ads_spend > 1_000_000:
            bad.append({
                "icon": "trend-down",
                "color": "orange",
                "text": f"Nhóm **{display_name}** CTR quá thấp {ctr*100:.2f}% — phần lớn banner/keyword không liên quan"
            })

    # Top-level findings
    if roas.get("roas_overall", 0) < 1:
        bad.insert(0, {
            "icon": "alert",
            "color": "red",
            "text": f"**ROAS tổng {roas.get('roas_overall', 0)}x dưới 1x** — đang lỗ ngân sách ads (chi nhiều hơn thu từ Website)"
        })
    elif roas.get("roas_overall", 0) < 2:
        bad.insert(0, {
            "icon": "alert",
            "color": "orange",
            "text": f"**ROAS tổng {roas.get('roas_overall', 0)}x** dưới target 3x — cần tối ưu để đạt profitability"
        })

    total_actions = totals.get("total_actions", 0)
    urgent = totals.get("urgent_actions", 0)
    saving = totals.get("estimated_total_saving_vnd", 0)

    if urgent > 0:
        bad.append({
            "icon": "clock",
            "color": "orange",
            "text": f"**{urgent} hành động urgent** cần làm ngay trong 1-3 ngày tới (chi tiết xem bảng category)"
        })

    if saving > 5_000_000:
        good.append({
            "icon": "saving",
            "color": "green",
            "text": f"**Tiết kiệm tiềm năng {saving/1_000_000:.1f}tr/30d** nếu apply hết recommendations (saving = spend lãng phí có thể cắt)"
        })

    return {"good_points": good, "improvement_points": bad}




def build_category_evaluation(c, cat_key):
    """Box đánh giá cho 1 category: bullet tốt + cần cải thiện."""
    good = []
    bad = []
    roas = c.get("roas_proxy", 0)
    spend = c.get("ads_spend_30d", 0)
    rev = c.get("revenue_pancake_30d", 0)
    ctr = c.get("ads_ctr_30d", 0)
    orders = c.get("orders_pancake_30d", 0)
    kws = c.get("keywords", [])
    banners = c.get("banners", [])

    # Điểm tốt
    if roas >= 3 and spend > 0:
        good.append(f"ROAS **{roas}x** (cao hơn target 3x) - chi {spend/1_000_000:.1f}tr ra {rev/1_000_000:.1f}tr doanh thu")
    elif roas >= 1.5 and spend > 0:
        good.append(f"ROAS **{roas}x** (trên mức hòa vốn) - có lãi từ ads")
    if ctr >= 0.05:
        good.append(f"CTR trung bình **{ctr*100:.1f}%** rất tốt (cao hơn avg industry 3-4%)")
    elif ctr >= 0.03:
        good.append(f"CTR trung bình **{ctr*100:.1f}%** ở mức khá")
    converting_kws = [k for k in kws if k.get("conv_30d", 0) > 0]
    if len(converting_kws) >= 5:
        good.append(f"Có **{len(converting_kws)} từ khóa** đang tạo chuyển đổi")
    if orders >= 50:
        good.append(f"**{orders} đơn hàng** từ nhóm này trong 30 ngày")

    # Điểm cần cải thiện
    if spend > 1_000_000 and roas < 1:
        bad.append(f"ROAS **{roas}x** đang lỗ - spend {spend/1_000_000:.1f}tr mà rev chỉ {rev/1_000_000:.1f}tr")
    elif spend > 1_000_000 and roas < 1.5:
        bad.append(f"ROAS **{roas}x** chưa hòa vốn - cần tối ưu")
    if ctr > 0 and ctr < 0.01 and spend > 500_000:
        bad.append(f"CTR TB quá thấp **{ctr*100:.2f}%** - đa phần ads không thu hút")
    neg_needed = [k for k in kws if k.get("recommendation") == "ADD_NEGATIVE"]
    if len(neg_needed) >= 5:
        waste = sum(k.get("spend_30d", 0) for k in neg_needed)
        bad.append(f"**{len(neg_needed)} từ khóa** cần thêm negative - waste {waste/1_000_000:.1f}tr/30d")
    banners_replace = [b for b in banners if b.get("recommendation") == "REPLACE"]
    if len(banners_replace) >= 3:
        bad.append(f"**{len(banners_replace)} banner** CTR rất thấp - cần thay mới")
    if orders == 0 and spend > 500_000:
        bad.append(f"**0 đơn hàng** mà chi {spend/1_000_000:.1f}tr - verify tracking hoặc cắt budget")

    return {"good": good, "bad": bad}



def _period_dates(today_str, period_key):
    """Return (start, end) for a period based on today."""
    from datetime import datetime, timedelta
    tdy = datetime.strptime(today_str, "%Y-%m-%d")
    if period_key == "today":
        return today_str, today_str
    if period_key == "yesterday":
        y = (tdy - timedelta(days=1)).strftime("%Y-%m-%d")
        return y, y
    if period_key == "this_week":
        # Monday → today
        wd = tdy.weekday()  # Mon=0
        mon = (tdy - timedelta(days=wd)).strftime("%Y-%m-%d")
        return mon, today_str
    if period_key == "last_week":
        wd = tdy.weekday()
        mon_this = tdy - timedelta(days=wd)
        mon_last = mon_this - timedelta(days=7)
        sun_last = mon_this - timedelta(days=1)
        return mon_last.strftime("%Y-%m-%d"), sun_last.strftime("%Y-%m-%d")
    if period_key == "this_month":
        first = tdy.replace(day=1).strftime("%Y-%m-%d")
        return first, today_str
    if period_key == "last_month":
        first_this = tdy.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        first_prev = last_prev.replace(day=1)
        return first_prev.strftime("%Y-%m-%d"), last_prev.strftime("%Y-%m-%d")
    if period_key == "last_7d":
        return (tdy - timedelta(days=6)).strftime("%Y-%m-%d"), today_str
    if period_key == "last_30d":
        return (tdy - timedelta(days=29)).strftime("%Y-%m-%d"), today_str
    if period_key == "last_90d":
        return (tdy - timedelta(days=89)).strftime("%Y-%m-%d"), today_str
    if period_key == "prior_7d":
        end_p = (tdy - timedelta(days=7)).strftime("%Y-%m-%d")
        start_p = (tdy - timedelta(days=13)).strftime("%Y-%m-%d")
        return start_p, end_p
    if period_key == "prior_30d":
        end_p = (tdy - timedelta(days=30)).strftime("%Y-%m-%d")
        start_p = (tdy - timedelta(days=59)).strftime("%Y-%m-%d")
        return start_p, end_p
    return today_str, today_str


def compute_period_totals(ga_data, rev_data, start, end):
    """Tổng hợp spend/clicks/impressions/revenue cho 1 period [start, end]."""
    spend = 0.0
    clicks = 0
    imps = 0
    per_cat = {}
    campaigns_raw = ga_data.get("campaigns_raw", [])
    for r in campaigns_raw:
        d = r.get("date", "")
        if not d or not (start <= d <= end):
            continue
        cat = r.get("category", "OTHER")
        s = float(r.get("spend", 0) or 0)
        c = int(r.get("clicks", 0) or 0)
        i = int(r.get("impressions", 0) or 0)
        spend += s
        clicks += c
        imps += i
        if cat not in per_cat:
            per_cat[cat] = {"spend": 0.0, "clicks": 0, "impressions": 0, "revenue": 0.0, "orders": 0}
        per_cat[cat]["spend"] += s
        per_cat[cat]["clicks"] += c
        per_cat[cat]["impressions"] += i

    # Revenue từ Pancake 3 sources: WEBSITE + ZALO_OA + HOTLINE (loại DUY/PN)
    groups = rev_data.get("source_groups", {})
    total_rev = 0
    total_orders = 0
    for src_name in ["WEBSITE", "ZALO_OA", "HOTLINE"]:
        s = groups.get(src_name, {})
        rsbd = s.get("order_revenue_by_status_by_date", {}) or {}
        cbsd = s.get("order_count_by_status_by_date", {}) or {}
        for st in ["delivered", "other"]:
            for d, v in (rsbd.get(st) or {}).items():
                if start <= d <= end:
                    total_rev += v
            for d, c in (cbsd.get(st) or {}).items():
                if start <= d <= end:
                    total_orders += c

    # Revenue per product theo category - merge 3 sources
    merged_products = {}
    for src_name in ["WEBSITE", "ZALO_OA", "HOTLINE"]:
        s = groups.get(src_name, {})
        src_prods = s.get("products", {}) or {}
        for prod_name, pd in src_prods.items():
            if prod_name not in merged_products:
                merged_products[prod_name] = {"by_date": {}}
            for d, v in (pd.get("by_date", {}) or {}).items():
                merged_products[prod_name]["by_date"][d] = merged_products[prod_name]["by_date"].get(d, 0) + v

    for prod_name, p in merged_products.items():
        # Map product → category
        cat = "OTHER"
        for ck, meta in CATEGORY_META.items():
            if prod_name in meta["products"]:
                cat = ck
                break
        by_date = p.get("by_date", {}) or {}
        for d, v in by_date.items():
            if start <= d <= end:
                if cat not in per_cat:
                    per_cat[cat] = {"spend": 0.0, "clicks": 0, "impressions": 0, "revenue": 0.0, "orders": 0}
                per_cat[cat]["revenue"] += v
                per_cat[cat]["orders"] += 1  # ước lượng 1 đơn/1 date entry (không chính xác lắm)

    ctr = (clicks / imps) if imps > 0 else 0
    cpc = (spend / clicks) if clicks > 0 else 0
    roas = (total_rev / spend) if spend > 0 else 0

    # Finalize per_cat
    per_cat_out = {}
    for cat, m in per_cat.items():
        m_ctr = (m["clicks"] / m["impressions"]) if m["impressions"] > 0 else 0
        m_roas = (m["revenue"] / m["spend"]) if m["spend"] > 0 else 0
        per_cat_out[cat] = {
            "spend": round(m["spend"], 0),
            "clicks": m["clicks"],
            "impressions": m["impressions"],
            "ctr": round(m_ctr, 4),
            "revenue": round(m["revenue"], 0),
            "orders": m["orders"],
            "roas": round(m_roas, 2),
        }

    # Top products trong period này (3 source)
    top_prods = []
    for prod_name, pp in merged_products.items():
        by_date = pp.get("by_date", {}) or {}
        prev_rev = 0
        prev_orders = 0
        for d, v in by_date.items():
            if start <= d <= end:
                prev_rev += v
                prev_orders += 1
        if prev_rev > 0 or prev_orders > 0:
            top_prods.append({
                "product": prod_name,
                "revenue": round(prev_rev, 0),
                "orders": prev_orders,
            })
    top_prods.sort(key=lambda x: -x["revenue"])

    return {
        "date_range": {"start": start, "end": end},
        "totals": {
            "spend": round(spend, 0),
            "clicks": clicks,
            "impressions": imps,
            "ctr": round(ctr, 4),
            "cpc": round(cpc, 0),
            "revenue": round(total_rev, 0),
            "orders": total_orders,
            "roas": round(roas, 2),
        },
        "per_category": per_cat_out,
        "top_products": top_prods,
    }


def build_time_periods(ga_data, rev_data, today_str):
    """Build dict of multiple periods + compare pairs."""
    period_keys = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_7d", "last_30d", "last_90d", "prior_7d", "prior_30d"]
    labels = {
        "today": "Hôm nay",
        "yesterday": "Hôm qua",
        "this_week": "Tuần này",
        "last_week": "Tuần trước",
        "this_month": "Tháng này",
        "last_month": "Tháng trước",
        "last_7d": "7 ngày qua",
        "last_30d": "30 ngày qua",
        "last_90d": "90 ngày qua",
        "prior_7d": "7 ngày trước đó",
        "prior_30d": "30 ngày trước đó",
    }
    compare_map = {
        "today": "yesterday",
        "yesterday": None,
        "this_week": "last_week",
        "last_week": None,
        "this_month": "last_month",
        "last_month": None,
        "last_7d": "prior_7d",
        "last_30d": "prior_30d",
        "last_90d": None,
    }

    periods = {}
    for pk in period_keys:
        start, end = _period_dates(today_str, pk)
        data = compute_period_totals(ga_data, rev_data, start, end)
        data["label"] = labels[pk]
        data["compare_to"] = compare_map.get(pk)
        periods[pk] = data

    return periods


def compute_comparison(current, previous):
    """Tính % thay đổi giữa 2 period totals."""
    def pct(a, b):
        if b == 0:
            return None
        return round((a - b) / b * 100, 1)

    return {
        "spend_change_pct": pct(current["totals"]["spend"], previous["totals"]["spend"]),
        "clicks_change_pct": pct(current["totals"]["clicks"], previous["totals"]["clicks"]),
        "ctr_change_pct": pct(current["totals"]["ctr"], previous["totals"]["ctr"]),
        "revenue_change_pct": pct(current["totals"]["revenue"], previous["totals"]["revenue"]),
        "orders_change_pct": pct(current["totals"]["orders"], previous["totals"]["orders"]),
        "roas_change_pct": pct(current["totals"]["roas"], previous["totals"]["roas"]),
    }



def analyze_banner_sizes(ads_data, category_key=None):
    """Phan tich hieu qua theo size banner."""
    ads = ads_data.get("ad_aggregates", {})
    size_stats = {}
    import re
    for ad_id, m in ads.items():
        if category_key and m.get("category") != category_key:
            continue
        if m.get("ad_format") not in ("DISPLAY_BANNER", "OTHER"):
            continue
        # Extract size from ad_name
        name = (m.get("ad_name") or "").lower()
        match = re.search(r"(\d{2,4})[xX](\d{2,4})", name)
        if not match:
            continue
        size = match.group(1) + "x" + match.group(2)
        if size not in size_stats:
            size_stats[size] = {"spend": 0, "clicks": 0, "imp": 0, "count": 0}
        size_stats[size]["spend"] += m.get("spend_30d", 0)
        size_stats[size]["clicks"] += m.get("clicks_30d", 0)
        size_stats[size]["imp"] += m.get("impressions_30d", 0)
        size_stats[size]["count"] += 1
    
    results = []
    for size, s in size_stats.items():
        ctr = s["clicks"] / s["imp"] if s["imp"] > 0 else 0
        cpc = s["spend"] / s["clicks"] if s["clicks"] > 0 else 0
        results.append({
            "size": size,
            "banner_count": s["count"],
            "spend_30d": round(s["spend"], 0),
            "clicks_30d": s["clicks"],
            "impressions_30d": s["imp"],
            "ctr_30d": round(ctr, 4),
            "cpc_30d": round(cpc, 0),
        })
    results.sort(key=lambda x: -x["ctr_30d"])
    
    # Rank + evaluation
    for i, r in enumerate(results):
        r["rank"] = i + 1
        if r["ctr_30d"] >= 0.01:
            r["evaluation"] = "Hieu qua tot — uu tien size nay"
            r["recommendation"] = "UU_TIEN"
        elif r["ctr_30d"] >= 0.005:
            r["evaluation"] = "Hieu qua trung binh"
            r["recommendation"] = "THEO_DOI"
        else:
            r["evaluation"] = "CTR thap — can cai thien hoac giam ty trong"
            r["recommendation"] = "CAI_THIEN"
    
    return results


def analyze_placement_quality(pl_data, ads_data, category_key=None):
    """Phan tich chat luong placement per category. Lay top problematic + top tot."""
    placements = pl_data.get("placement_aggregates", {})
    # Filter by category (via campaign name match category)
    results = []
    for placement, m in placements.items():
        if category_key:
            campaigns = m.get("campaigns", []) or []
            # Check if campaign names match this category
            from_cat = False
            for cn in campaigns:
                if detect_category(cn) == category_key:
                    from_cat = True
                    break
            if not from_cat:
                continue
        
        spend = m.get("spend_30d", 0)
        clicks = m.get("clicks_30d", 0)
        imp = m.get("impressions_30d", 0)
        ctr = m.get("ctr_30d", 0)
        if spend < 5000 and imp < 100:  # skip quá nhỏ
            continue
        
        # Danh gia
        if clicks == 0 and spend > 20000:
            eval_text = "Lang phi — 0 click va spend cao"
            action = "NEN_LOAI_TRU"
        elif ctr < 0.005 and imp > 500:
            eval_text = "CTR qua thap — can exclude hoac giam bid"
            action = "NEN_LOAI_TRU"
        elif ctr > 0.02:
            eval_text = "CTR tot — giu nguyen"
            action = "GIU"
        else:
            eval_text = "Theo doi them"
            action = "THEO_DOI"
        
        results.append({
            "placement": placement,
            "placement_type": m.get("placement_type", ""),
            "ad_network_type": m.get("ad_network_type", ""),
            "spend_30d": round(spend, 0),
            "clicks_30d": clicks,
            "impressions_30d": imp,
            "ctr_30d": round(ctr, 4),
            "evaluation": eval_text,
            "action": action,
        })
    
    # Sort: action "NEN_LOAI_TRU" len dau, roi spend desc
    priority = {"NEN_LOAI_TRU": 0, "THEO_DOI": 1, "GIU": 2}
    results.sort(key=lambda x: (priority.get(x["action"], 99), -x["spend_30d"]))
    return results[:30]  # Top 30 per cat


def get_vn_culture_tips(today_str):
    """Heuristic dua tren lich VN — tranh spend cao cac ngay kieng hoi."""
    from datetime import datetime
    tips = []
    # Ngay AM LICH can import, fallback: dung nhung rule co ban
    # Mong 1 va ram (15 am lich) — thuc te can thu vien lunar
    # Placeholder: check ngay duong 1,15 cua thang de luu y
    try:
        tdy = datetime.strptime(today_str, "%Y-%m-%d")
        day_of_month = tdy.day
        weekday = tdy.weekday()
        
        # Ngay sale Shopee/Tiktok: 1, 15, 25, 30 (hoac cuoi thang)
        sale_days = [1, 15, 25, 30]
        if day_of_month in sale_days:
            tips.append({
                "type": "SALE_DAY",
                "text": "Hom nay la ngay sale tren Shopee/TikTok (ngay " + str(day_of_month) + "). Noi y doi thu se giam gia manh — can an dinh hon ve gia hoac tung voucher rieng."
            })
        
        # Weekend (Saturday/Sunday): mua sam cao
        if weekday >= 5:
            tips.append({
                "type": "WEEKEND",
                "text": "Cuoi tuan — demand mua sam thuong cao hon 30-50% weekday. Tang budget ad 20% de capture demand."
            })
        
        # General VN rules (hien thi mac dinh)
        tips.append({
            "type": "LUNAR",
            "text": "VN tap tinh: tranh push sale/mua lon vao mong 1 va ram am lich (am lich). Thang 7 am lich (thang co hon) nguoi dan tranh mua sam do dat tien. Khi rot vao cac ngay nay, giam bid 20-30%."
        })
        tips.append({
            "type": "SALE_CYCLE",
            "text": "Khach VN co thoi quen doi ngay sale cuoi/dau/giua thang (1, 15, 25). Neu ban target conversion, thi ngay do can BID CAO HON (tang +30%) vi khach co intent mua cao, the hien bang budget spike."
        })
    except Exception:
        pass
    
    return tips


def get_customer_psychology_for_category(category_key):
    """Heuristic: tam ly khach hang theo category, de xuat angle."""
    PSYCH = {
        "MAYDO": {
            "customer_profile": "Nguoi nghi ngo bi theo doi/gian diep, cam xuc lo lang, mua tren impulse (cam xuc cao)",
            "best_timing": "Buoi toi 20-23h (khi khach lo lang, chua duoc giai toa)",
            "avoid_timing": "Gio hanh chinh 9-17h (khach dang ban, khong focus vao security)",
            "emotional_angle": "FEAR (so bi theo doi) + RELIEF (giai toa lo lang) + CONTROL (kiem soat duoc gi dien ra)",
            "cta_pattern": "Bao ve quyen rieng tu cua ban NGAY hom nay | Khong de ai nghe len cuoc tro chuyen | Kiem tra 100% thiet bi an trong 30 giay",
            "avoid_angle": "Khong noi 'gia re', 'khuyen mai' — gia khong phai concern; trust + effective moi la.",
        },
        "DINHVI": {
            "customer_profile": "Phu huynh lo con, vo/chong nghi ngoai tinh, chu xe lo mat, chu tai xe oto — mua co chu dich",
            "best_timing": "Buoi toi 19-22h + cuoi tuan (khi co thoi gian suy nghi/lo lang)",
            "avoid_timing": "Gio hanh chinh",
            "emotional_angle": "WORRY (lo mat nguoi/xe) + REASSURANCE (yen tam biet vi tri) + EVIDENCE (bang chung cu the)",
            "cta_pattern": "Biet con o dau moi luc | Yen tam khi xe dau co xa | Bang chung khach quan ro rang",
            "avoid_angle": "Trach moc/nghi ngo — gian tiep gay negative voi khach con lan van.",
        },
        "GHIAM": {
            "customer_profile": "Nguoi mo cong ty, can ghi lai cuoc hop, nhan vien muon bao ve ban than, chong gian diep cong nghiep",
            "best_timing": "Thu 2-5, gio hanh chinh 9-12h (khi dang chuan bi cuoc hop)",
            "avoid_timing": "Cuoi tuan",
            "emotional_angle": "PROFESSIONALISM (chuyen nghiep) + PROOF (bang chung) + PROTECTION (bao ve minh)",
            "cta_pattern": "Chuyen nghiep nhu luat su | Khong bo sot chi tiet | Chuyen text tu dong AI",
            "avoid_angle": "Khong noi 'len len', 'bi mat' — khach B2B can chuyen nghiep khong phai suspicious",
        },
        "CAMCALL": {
            "customer_profile": "Gia dinh co tre nho/nguoi gia, chu cua hang, chu nha cho thue — warmth-oriented buyer",
            "best_timing": "Toi 19-22h + sang cuoi tuan 9-11h",
            "avoid_timing": "Giua trua (12-14h)",
            "emotional_angle": "FAMILY LOVE + SAFETY + CONVENIENCE",
            "cta_pattern": "Nhin ro ca nha 24/7 | Goi voi con tu xa bat cu luc nao | Khi co nguoi la vao nha se alert ngay",
            "avoid_angle": "Tech-heavy jargon (thay vao visual + emotional)",
        },
    }
    return PSYCH.get(category_key, {
        "customer_profile": "Khach hang thong thuong",
        "best_timing": "Toi 19-22h",
        "avoid_timing": "Gio hanh chinh",
        "emotional_angle": "VALUE + TRUST + CONVENIENCE",
        "cta_pattern": "Dat ngay giam gia | Giao 2h noi thanh | Bao hanh 24 thang",
        "avoid_angle": "Price-only angle (de bi so sanh)",
    })

if __name__ == "__main__":
    main()

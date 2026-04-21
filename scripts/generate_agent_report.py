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
        # Filter: chỉ lấy term đủ "ý nghĩa" (spend >= 30k hoặc clicks >= 5 hoặc conversions >= 1)
        if not (m["spend_30d"] >= 30_000 or m["clicks_30d"] >= 5 or m["conversions_30d"] >= 1):
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
        by_cat[cat].sort(key=lambda k: (priority_order.get(k["recommendation"], 99), -k["spend_30d"]))

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
        terms = ", ".join([f'"{k["text"]}"' for k in scale[:3]])
        actions.append({
            "type": "SCALE_KEYWORDS",
            "priority": "medium",
            "title": f"Tăng bid {len(scale)} keyword converting",
            "detail": f"Top converting: {terms}",
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
    """Build product revenue ranking + map to related keywords."""
    products = rev_data.get("products", {})
    terms = st_data.get("term_aggregates", {})

    # Build product → category map
    product_to_cat = {}
    for cat, meta in CATEGORY_META.items():
        for prod in meta["products"]:
            product_to_cat[prod] = cat

    ranking = []
    for prod_name, p in products.items():
        cat = product_to_cat.get(prod_name, "OTHER")
        cat_keywords = keywords_by_cat.get(cat, [])
        # Top 3 keywords by conversions for linked product
        linked_kws = sorted(
            [k for k in cat_keywords if k["conv_30d"] > 0],
            key=lambda x: -x["conv_30d"]
        )[:3]
        ranking.append({
            "product": prod_name,
            "category": cat,
            "category_name": CATEGORY_META.get(cat, {}).get("name", cat),
            "revenue_30d": p["total"],
            "orders_30d": p["orders"],
            "avg_order_value": round(p["total"] / p["orders"], 0) if p["orders"] > 0 else 0,
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
            "keywords": cat_keywords[:30],  # Top 30 per cat (limit output size)
            "banners": cat_banners[:20],
            "summary_actions": summary_actions,
        }

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

    report = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
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


if __name__ == "__main__":
    main()

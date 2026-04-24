#!/usr/bin/env python3
"""
Pre-compute Google Ads metrics v2 (deterministic) — output data/google-ads-context.json
cho AI agent doc phan tich.

Data sources:
  - data/google-ads-spend.json
  - data/product-revenue.json
  - data/google-ads-search-terms.json
  - data/google-ads-placement.json
  - data/google-ads-ads.json
"""

import os
import json
import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict


# ── Phân loại chiến dịch Google Ads vào 9 nhóm chuẩn Doscom (2026-04-23 v2) ──
# 22 chiến dịch Doscom đặt tên theo quy ước:
#   - "Search - Cam WIFI", "RMK - Camera wifi", "Cam mini" → Camera wifi
#   - "Search - Cam NLMT", "Search - Sim 4G", "RMK - Camera 4G", "RMK - NLMT" → Camera 4G
#   - "RMK - Camera Gọi 2 chiều" → Camera video call
#   - "Search - TB Dò Nghe Lén", "RMK - Máy dò" → Máy dò
#   - "Search - TB Ghi Âm", "RMK - thiết bị ghi âm" → Ghi âm
#   - "Search - TB Chống Ghi Âm", "RMK - chống ghi âm" → Chống ghi âm
#   - "Search - TBĐV GPS", "RMK - thiết bị định vị", "Shopping - ĐV" → Định vị
#   - Còn lại (Máy cạo râu, Máy massage, Gia dụng...) → Khác
CAMPAIGN_CATEGORY_ORDER = [
    ("MAY_DO",            "Máy dò"),
    ("CAMERA_WIFI",       "Camera wifi"),
    ("CAMERA_4G",         "Camera 4G"),
    ("CAMERA_VIDEO_CALL", "Camera gọi video 2 chiều"),
    ("GHI_AM",            "Máy ghi âm"),
    ("CHONG_GHI_AM",      "Chống ghi âm"),
    ("DINH_VI",           "Định vị"),
    ("NOMA",              "NOMA"),
    ("OTHER",             "Khác"),
]


def classify_campaign_v2(name):
    """Phân 1 tên chiến dịch Google Ads vào 1 trong 9 nhóm chuẩn Doscom."""
    if not name:
        return "OTHER"
    n = name.lower()
    if "gọi 2 chiều" in n or "goi 2 chieu" in n or "2 chiều" in n:
        return "CAMERA_VIDEO_CALL"
    if "4g" in n or "nlmt" in n or "năng lượng" in n:
        return "CAMERA_4G"
    if "wifi" in n or "cam mini" in n or "camera mini" in n:
        return "CAMERA_WIFI"
    if "chống ghi âm" in n or "chong ghi am" in n:
        return "CHONG_GHI_AM"
    if "ghi âm" in n or "ghi am" in n:
        return "GHI_AM"
    if "dò nghe lén" in n or "do nghe len" in n or "máy dò" in n or "may do" in n or "tb dò" in n:
        return "MAY_DO"
    if ("định vị" in n or "dinh vi" in n or "tbđv" in n or "tbdv" in n
            or "gps" in n or "- đv" in n or "-đv" in n or " đv" in n.replace("máy", "")):
        return "DINH_VI"
    if "noma" in n:
        return "NOMA"
    return "OTHER"


def compute_spend_breakdown_by_period(ga_data):
    """Tổng chi phí Google Ads theo 9 nhóm cho 5 period chuẩn.

    Return: {period: {total_spend, total_clicks, total_impressions,
                      categories: {KEY: {label, spend, clicks, impressions}}}}
    """
    end_str = (ga_data.get("date_range") or {}).get("end")
    if not end_str:
        return {}

    end_dt = datetime.strptime(end_str, "%Y-%m-%d")

    def offset(days):
        return (end_dt - timedelta(days=days)).strftime("%Y-%m-%d")

    # Period start inclusive, end inclusive
    periods = {
        "yesterday":  (end_str, end_str),
        "last_7d":    (offset(6), end_str),
        "this_month": (end_dt.replace(day=1).strftime("%Y-%m-%d"), end_str),
        "last_30d":   (offset(29), end_str),
        "last_90d":   (offset(89), end_str),
    }
    labels = {
        "yesterday": "Hôm qua", "last_7d": "7 ngày gần", "this_month": "Tháng này",
        "last_30d": "30 ngày gần", "last_90d": "90 ngày gần",
    }

    rows = ga_data.get("campaigns_raw") or []
    result = {}
    for pk, (pstart, pend) in periods.items():
        cats = {ck: {"label": lbl, "spend": 0.0, "clicks": 0, "impressions": 0, "campaigns": set()}
                for ck, lbl in CAMPAIGN_CATEGORY_ORDER}
        total_spend, total_clicks, total_imps = 0.0, 0, 0
        for r in rows:
            d = r.get("date", "")
            if not (d and pstart <= d <= pend):
                continue
            cat = classify_campaign_v2(r.get("campaign", ""))
            s = float(r.get("spend", 0) or 0)
            c = int(r.get("clicks", 0) or 0)
            i = int(r.get("impressions", 0) or 0)
            cats[cat]["spend"] += s
            cats[cat]["clicks"] += c
            cats[cat]["impressions"] += i
            cats[cat]["campaigns"].add(r.get("campaign", ""))
            total_spend += s
            total_clicks += c
            total_imps += i
        # Finalize
        out_cats = {}
        for ck, lbl in CAMPAIGN_CATEGORY_ORDER:
            c = cats[ck]
            ctr = (c["clicks"] / c["impressions"]) if c["impressions"] > 0 else 0
            cpc = (c["spend"] / c["clicks"]) if c["clicks"] > 0 else 0
            out_cats[ck] = {
                "label": c["label"],
                "spend": round(c["spend"]),
                "clicks": c["clicks"],
                "impressions": c["impressions"],
                "ctr": round(ctr, 4),
                "cpc": round(cpc),
                "campaigns_count": len(c["campaigns"]),
            }
        result[pk] = {
            "label": labels[pk],
            "date_range": {"start": pstart, "end": pend},
            "total_spend": round(total_spend),
            "total_clicks": total_clicks,
            "total_impressions": total_imps,
            "categories": out_cats,
        }
    return result

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GA_FILE = os.path.join(REPO_ROOT, "data", "google-ads-spend.json")
REV_FILE = os.path.join(REPO_ROOT, "data", "product-revenue.json")
ST_FILE = os.path.join(REPO_ROOT, "data", "google-ads-search-terms.json")
PL_FILE = os.path.join(REPO_ROOT, "data", "google-ads-placement.json")
ADS_FILE = os.path.join(REPO_ROOT, "data", "google-ads-ads.json")
OUT_FILE = os.path.join(REPO_ROOT, "data", "google-ads-context.json")

THRESHOLDS = {
    "low_ctr": 0.005,
    "very_low_ctr": 0.002,
    "min_impressions_to_judge": 500,
    "high_cpc_spike_pct": 0.30,
    "spend_anomaly_pct": 0.50,
    "waste_min_spend": 500000,
    "roas_target": 3.0,
    "term_waste_min_spend": 100000,
    "neg_gap_min_spend": 50000,
    "ad_waste_min_spend": 100000,
}


def _load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[WARN] Cannot load {path}: {e}", file=sys.stderr)
        return {}


def date_offset(base: str, days: int) -> str:
    dt = datetime.strptime(base, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return (dt - timedelta(days=days)).strftime("%Y-%m-%d")


def in_range(date: str, start: str, end: str) -> bool:
    return bool(date) and start <= date <= end


def compute_campaign_metrics(ga_data):
    campaigns_raw = ga_data.get("campaigns_raw", [])
    if not campaigns_raw:
        return {}, {}
    all_dates = sorted(set(r.get("date", "") for r in campaigns_raw if r.get("date")))
    if not all_dates:
        return {}, {}
    end_date = all_dates[-1]
    start_7d = date_offset(end_date, 6)
    start_30d = date_offset(end_date, 29)
    start_prior_7d = date_offset(end_date, 13)
    end_prior_7d = date_offset(end_date, 7)

    camps = defaultdict(lambda: {
        "category": "", "spend_30d": 0.0, "clicks_30d": 0, "impressions_30d": 0,
        "spend_7d": 0.0, "clicks_7d": 0, "impressions_7d": 0,
        "spend_prior_7d": 0.0, "clicks_prior_7d": 0, "impressions_prior_7d": 0,
        "active_days_30d": set(),
    })

    for r in campaigns_raw:
        camp = r.get("campaign", "")
        date = r.get("date", "")
        if not camp or not date:
            continue
        spend = float(r.get("spend", 0) or 0)
        clicks = int(r.get("clicks", 0) or 0)
        impressions = int(r.get("impressions", 0) or 0)
        entry = camps[camp]
        entry["category"] = r.get("category", "")
        if in_range(date, start_30d, end_date):
            entry["spend_30d"] += spend
            entry["clicks_30d"] += clicks
            entry["impressions_30d"] += impressions
            if spend > 0 or clicks > 0:
                entry["active_days_30d"].add(date)
        if in_range(date, start_7d, end_date):
            entry["spend_7d"] += spend
            entry["clicks_7d"] += clicks
            entry["impressions_7d"] += impressions
        if in_range(date, start_prior_7d, end_prior_7d):
            entry["spend_prior_7d"] += spend
            entry["clicks_prior_7d"] += clicks
            entry["impressions_prior_7d"] += impressions

    out = {}
    for camp, e in camps.items():
        active_days = len(e["active_days_30d"])
        ctr_30d = (e["clicks_30d"] / e["impressions_30d"]) if e["impressions_30d"] > 0 else 0
        ctr_7d = (e["clicks_7d"] / e["impressions_7d"]) if e["impressions_7d"] > 0 else 0
        ctr_prior_7d = (e["clicks_prior_7d"] / e["impressions_prior_7d"]) if e["impressions_prior_7d"] > 0 else 0
        cpc_30d = (e["spend_30d"] / e["clicks_30d"]) if e["clicks_30d"] > 0 else 0
        cpc_7d = (e["spend_7d"] / e["clicks_7d"]) if e["clicks_7d"] > 0 else 0
        cpc_prior_7d = (e["spend_prior_7d"] / e["clicks_prior_7d"]) if e["clicks_prior_7d"] > 0 else 0
        avg_daily_30d = e["spend_30d"] / max(1, active_days)
        spend_trend_pct = ((e["spend_7d"] - e["spend_prior_7d"]) / e["spend_prior_7d"] * 100) if e["spend_prior_7d"] > 0 else 0
        ctr_trend_pct = ((ctr_7d - ctr_prior_7d) / ctr_prior_7d * 100) if ctr_prior_7d > 0 else 0
        cpc_trend_pct = ((cpc_7d - cpc_prior_7d) / cpc_prior_7d * 100) if cpc_prior_7d > 0 else 0
        flags = []
        if e["impressions_30d"] >= THRESHOLDS["min_impressions_to_judge"]:
            if ctr_30d < THRESHOLDS["very_low_ctr"]:
                flags.append("critical_low_ctr")
            elif ctr_30d < THRESHOLDS["low_ctr"]:
                flags.append("low_ctr")
        if cpc_trend_pct > THRESHOLDS["high_cpc_spike_pct"] * 100:
            flags.append("cpc_spike")
        if e["spend_30d"] >= THRESHOLDS["waste_min_spend"] and e["clicks_30d"] < 10:
            flags.append("spend_no_clicks")
        out[camp] = {
            "category": e["category"],
            "spend_30d": round(e["spend_30d"], 0),
            "spend_7d": round(e["spend_7d"], 0),
            "spend_prior_7d": round(e["spend_prior_7d"], 0),
            "clicks_30d": e["clicks_30d"],
            "clicks_7d": e["clicks_7d"],
            "impressions_30d": e["impressions_30d"],
            "impressions_7d": e["impressions_7d"],
            "ctr_30d": round(ctr_30d, 4),
            "ctr_7d": round(ctr_7d, 4),
            "ctr_prior_7d": round(ctr_prior_7d, 4),
            "cpc_30d": round(cpc_30d, 0),
            "cpc_7d": round(cpc_7d, 0),
            "cpc_prior_7d": round(cpc_prior_7d, 0),
            "active_days_30d": active_days,
            "avg_daily_spend_30d": round(avg_daily_30d, 0),
            "spend_trend_pct": round(spend_trend_pct, 1),
            "ctr_trend_pct": round(ctr_trend_pct, 1),
            "cpc_trend_pct": round(cpc_trend_pct, 1),
            "flags": flags,
        }
    return out, {"start_7d": start_7d, "end": end_date, "start_30d": start_30d}


def compute_category_metrics(camp_metrics):
    cats = defaultdict(lambda: {
        "spend_30d": 0.0, "clicks_30d": 0, "impressions_30d": 0,
        "spend_7d": 0.0, "clicks_7d": 0, "impressions_7d": 0,
        "spend_prior_7d": 0.0, "campaign_count": 0,
    })
    for camp, m in camp_metrics.items():
        c = m["category"] or "OTHER"
        cats[c]["spend_30d"] += m["spend_30d"]
        cats[c]["clicks_30d"] += m["clicks_30d"]
        cats[c]["impressions_30d"] += m["impressions_30d"]
        cats[c]["spend_7d"] += m["spend_7d"]
        cats[c]["clicks_7d"] += m["clicks_7d"]
        cats[c]["impressions_7d"] += m["impressions_7d"]
        cats[c]["spend_prior_7d"] += m["spend_prior_7d"]
        cats[c]["campaign_count"] += 1
    out = {}
    for c, e in cats.items():
        ctr_30d = (e["clicks_30d"] / e["impressions_30d"]) if e["impressions_30d"] > 0 else 0
        cpc_30d = (e["spend_30d"] / e["clicks_30d"]) if e["clicks_30d"] > 0 else 0
        spend_trend = ((e["spend_7d"] - e["spend_prior_7d"]) / e["spend_prior_7d"] * 100) if e["spend_prior_7d"] > 0 else 0
        out[c] = {
            "spend_30d": round(e["spend_30d"], 0),
            "spend_7d": round(e["spend_7d"], 0),
            "clicks_30d": e["clicks_30d"],
            "impressions_30d": e["impressions_30d"],
            "ctr_30d": round(ctr_30d, 4),
            "cpc_30d": round(cpc_30d, 0),
            "spend_trend_7d_pct": round(spend_trend, 1),
            "campaign_count": e["campaign_count"],
        }
    return out


def compute_website_revenue(rev_data, start, end):
    """Gộp doanh thu từ 3 nguồn POS Pancake: WEBSITE + ZALO_OA + HOTLINE.

    (2026-04-24 update) LẤY TẤT CẢ ĐƠN — không loại trừ hoàn/huỷ/đang gửi.
    User request: bộ phận khác xử lý hoàn huỷ, phân tích quảng cáo cần doanh thu tổng.
    """
    groups = rev_data.get("source_groups", {})
    SRC_KEYS = ["WEBSITE", "ZALO_OA", "HOTLINE"]
    STATUSES = ["delivered", "returning", "returned", "canceled", "other"]  # tất cả
    EXCLUDED = []  # không exclude gì

    total = 0
    orders = 0
    by_status = {}
    by_source = {}

    for src_key in SRC_KEYS:
        src = groups.get(src_key, {}) or {}
        if not src:
            by_source[src_key] = {"revenue": 0, "orders": 0, "note": "Source group missing"}
            continue
        rsbd = src.get("order_revenue_by_status_by_date", {}) or {}
        cbsd = src.get("order_count_by_status_by_date", {}) or {}
        src_rev = 0
        src_orders = 0
        for st in STATUSES:
            for date, v in (rsbd.get(st) or {}).items():
                if in_range(date, start, end):
                    src_rev += v
                    total += v
                    if st not in by_status:
                        by_status[st] = {"revenue": 0, "orders": 0}
                    by_status[st]["revenue"] += v
            for date, c in (cbsd.get(st) or {}).items():
                if in_range(date, start, end):
                    src_orders += c
                    orders += c
                    if st not in by_status:
                        by_status[st] = {"revenue": 0, "orders": 0}
                    by_status[st]["orders"] += c
        for st in EXCLUDED:
            for date, v in (rsbd.get(st) or {}).items():
                if in_range(date, start, end):
                    if st not in by_status:
                        by_status[st] = {"revenue": 0, "orders": 0}
                    by_status[st]["revenue"] += v
            for date, c in (cbsd.get(st) or {}).items():
                if in_range(date, start, end):
                    if st not in by_status:
                        by_status[st] = {"revenue": 0, "orders": 0}
                    by_status[st]["orders"] += c
        by_source[src_key] = {
            "revenue": round(src_rev, 0),
            "orders": src_orders,
        }

    # Round revenue in by_status
    for st in by_status:
        by_status[st]["revenue"] = round(by_status[st]["revenue"], 0)

    return {
        "total_30d": round(total, 0),
        "orders_30d": orders,
        "by_status": by_status,
        "by_source": by_source,
        "note": (
            "Gộp 3 nguồn POS: WEBSITE + ZALO_OA + HOTLINE (filter 'Website' trên POS). "
            "Loại DUY + PHUONG_NAM (team FB Ads). Match: delivered + other. "
            "Excluded returning/returned/canceled/refunded."
        ),
    }


def compute_top_lists(camp_metrics):
    camps = list(camp_metrics.items())
    top_spenders = sorted(camps, key=lambda x: -x[1]["spend_30d"])[:5]
    low_ctr_with_spend = [(c, m) for c, m in camps if "low_ctr" in m["flags"] or "critical_low_ctr" in m["flags"]]
    low_ctr_with_spend.sort(key=lambda x: -x[1]["spend_30d"])
    spend_no_clicks = [(c, m) for c, m in camps if "spend_no_clicks" in m["flags"]]
    cpc_spike = [(c, m) for c, m in camps if "cpc_spike" in m["flags"]]
    cpc_spike.sort(key=lambda x: -x[1]["cpc_trend_pct"])
    trending_up_spend = sorted([c for c in camps if c[1]["spend_trend_pct"] > 20], key=lambda x: -x[1]["spend_trend_pct"])[:5]
    trending_down_spend = sorted([c for c in camps if c[1]["spend_trend_pct"] < -20], key=lambda x: x[1]["spend_trend_pct"])[:5]
    def fmt_camp_list(items, keys):
        return [{"campaign": c, **{k: m[k] for k in keys}} for c, m in items]
    return {
        "top_5_spenders_30d": fmt_camp_list(top_spenders, ["category", "spend_30d", "clicks_30d", "ctr_30d", "cpc_30d"]),
        "low_ctr_campaigns": fmt_camp_list(low_ctr_with_spend[:10], ["category", "spend_30d", "impressions_30d", "clicks_30d", "ctr_30d", "flags"]),
        "spend_no_clicks_campaigns": fmt_camp_list(spend_no_clicks, ["category", "spend_30d", "clicks_30d", "impressions_30d"]),
        "cpc_spike_campaigns": fmt_camp_list(cpc_spike[:5], ["category", "spend_30d", "cpc_7d", "cpc_prior_7d", "cpc_trend_pct"]),
        "trending_up_spend_7d": fmt_camp_list(trending_up_spend, ["category", "spend_7d", "spend_prior_7d", "spend_trend_pct"]),
        "trending_down_spend_7d": fmt_camp_list(trending_down_spend, ["category", "spend_7d", "spend_prior_7d", "spend_trend_pct"]),
    }


def compute_waste_estimate(camp_metrics):
    waste_items = []
    total_waste = 0
    for camp, m in camp_metrics.items():
        if m["spend_30d"] < THRESHOLDS["waste_min_spend"]:
            continue
        waste_reasons = []
        waste_amount = 0
        if "critical_low_ctr" in m["flags"]:
            waste_amount += m["spend_30d"] * 0.70
            waste_reasons.append(f"CTR {m['ctr_30d']*100:.2f}% qua thap (< 0.2%)")
        elif "low_ctr" in m["flags"]:
            waste_amount += m["spend_30d"] * 0.30
            waste_reasons.append(f"CTR {m['ctr_30d']*100:.2f}% thap (< 0.5%)")
        if "spend_no_clicks" in m["flags"]:
            waste_amount = max(waste_amount, m["spend_30d"] * 0.80)
            waste_reasons.append(f"Spend {m['spend_30d']:,.0f}d ma chi {m['clicks_30d']} click")
        if waste_amount > 0:
            waste_items.append({
                "campaign": camp, "category": m["category"],
                "wasted_30d_vnd": round(waste_amount, 0),
                "reasons": waste_reasons, "spend_30d": m["spend_30d"],
                "ctr_30d": m["ctr_30d"], "clicks_30d": m["clicks_30d"],
            })
            total_waste += waste_amount
    waste_items.sort(key=lambda x: -x["wasted_30d_vnd"])
    return {"total_wasted_30d_vnd": round(total_waste, 0), "items": waste_items}


def compute_search_term_insights(st_data):
    terms = st_data.get("term_aggregates", {})
    if not terms:
        return {"note": "No search term data available"}
    top_converting = sorted(
        [(t, m) for t, m in terms.items() if m["conversions_30d"] > 0],
        key=lambda x: -x[1]["conversions_30d"])[:10]
    top_waste = sorted(
        [(t, m) for t, m in terms.items()
         if m["spend_30d"] >= THRESHOLDS["term_waste_min_spend"]
         and m["conversions_30d"] == 0
         and "EXCLUDED" not in m.get("statuses", [])],
        key=lambda x: -x[1]["spend_30d"])[:15]
    neg_gap = sorted(
        [(t, m) for t, m in terms.items()
         if m.get("statuses") and "NONE" in m["statuses"]
         and m["spend_30d"] > THRESHOLDS["neg_gap_min_spend"]
         and m["conversions_30d"] == 0],
        key=lambda x: -x[1]["spend_30d"])[:15]
    mt_spend = defaultdict(lambda: {"spend": 0.0, "clicks": 0, "conversions": 0.0, "term_count": 0})
    for t, m in terms.items():
        for mt in (m.get("match_types") or ["UNKNOWN"]):
            mt_spend[mt]["spend"] += m["spend_30d"]
            mt_spend[mt]["clicks"] += m["clicks_30d"]
            mt_spend[mt]["conversions"] += m["conversions_30d"]
            mt_spend[mt]["term_count"] += 1
    match_type_breakdown = {
        mt: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "conversions_30d": round(e["conversions"], 2),
            "term_count": e["term_count"],
        } for mt, e in mt_spend.items()
    }
    total_terms = len(terms)
    terms_with_conversions = sum(1 for m in terms.values() if m["conversions_30d"] > 0)
    total_spend = sum(m["spend_30d"] for m in terms.values())
    def fmt_term_list(items, include_keys):
        return [{"search_term": t, **{k: m.get(k) for k in include_keys}} for t, m in items]
    return {
        "summary": {
            "total_unique_terms": total_terms,
            "terms_with_conversions": terms_with_conversions,
            "conv_rate_terms": round(terms_with_conversions / total_terms, 3) if total_terms else 0,
            "total_spend_30d": round(total_spend, 0),
        },
        "top_converting_terms": fmt_term_list(top_converting,
            ["spend_30d", "clicks_30d", "conversions_30d", "ctr_30d", "match_types", "statuses"]),
        "top_waste_terms": fmt_term_list(top_waste,
            ["spend_30d", "clicks_30d", "conversions_30d", "ctr_30d", "match_types", "statuses", "campaigns"]),
        "negative_keyword_gap": fmt_term_list(neg_gap,
            ["spend_30d", "clicks_30d", "conversions_30d", "match_types", "statuses", "campaigns"]),
        "match_type_breakdown": match_type_breakdown,
    }


def compute_placement_insights(pl_data):
    placements = pl_data.get("placement_aggregates", {})
    networks = pl_data.get("network_aggregates", {})
    if not placements and not networks:
        return {"note": "No placement data available"}
    top_waste_placements = sorted(
        [(p, m) for p, m in placements.items() if m["spend_30d"] > 0 and m["clicks_30d"] == 0],
        key=lambda x: -x[1]["spend_30d"])[:15]
    low_ctr_placements = sorted(
        [(p, m) for p, m in placements.items()
         if m["impressions_30d"] >= THRESHOLDS["min_impressions_to_judge"]
         and m["clicks_30d"] > 0
         and m["ctr_30d"] < THRESHOLDS["low_ctr"]],
        key=lambda x: -x[1]["spend_30d"])[:15]
    top_spend_placements = sorted(
        [(p, m) for p, m in placements.items() if m["spend_30d"] > 0],
        key=lambda x: -x[1]["spend_30d"])[:10]
    pt_agg = defaultdict(lambda: {"spend": 0.0, "clicks": 0, "impressions": 0, "count": 0})
    for p, m in placements.items():
        pt = m.get("placement_type", "") or "UNKNOWN"
        pt_agg[pt]["spend"] += m["spend_30d"]
        pt_agg[pt]["clicks"] += m["clicks_30d"]
        pt_agg[pt]["impressions"] += m["impressions_30d"]
        pt_agg[pt]["count"] += 1
    placement_type_breakdown = {
        pt: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "placement_count": e["count"],
        } for pt, e in pt_agg.items()
    }
    def fmt_pl_list(items, include_keys):
        return [{"placement": p, **{k: m.get(k) for k in include_keys}} for p, m in items]
    return {
        "summary": {
            "total_unique_placements": len(placements),
            "total_spend_30d": round(sum(m["spend_30d"] for m in placements.values()), 0),
        },
        "network_breakdown": networks,
        "placement_type_breakdown": placement_type_breakdown,
        "top_waste_placements": fmt_pl_list(top_waste_placements,
            ["spend_30d", "clicks_30d", "impressions_30d", "placement_type", "ad_network_type"]),
        "low_ctr_placements": fmt_pl_list(low_ctr_placements,
            ["spend_30d", "clicks_30d", "impressions_30d", "ctr_30d", "placement_type"]),
        "top_spend_placements": fmt_pl_list(top_spend_placements,
            ["spend_30d", "clicks_30d", "ctr_30d", "placement_type", "ad_network_type"]),
    }


def compute_ad_insights(ads_data):
    ads = ads_data.get("ad_aggregates", {})
    formats = ads_data.get("format_aggregates", {})
    if not ads:
        return {"note": "No ads data available"}
    banner_ads = [(k, m) for k, m in ads.items() if m["ad_format"] == "DISPLAY_BANNER"]
    top_spend_banners = sorted(banner_ads, key=lambda x: -x[1]["spend_30d"])[:10]
    worst_banners = sorted(
        [(k, m) for k, m in ads.items()
         if m["ad_format"] == "DISPLAY_BANNER"
         and m["impressions_30d"] >= THRESHOLDS["min_impressions_to_judge"]
         and m["ctr_30d"] < THRESHOLDS["very_low_ctr"]],
        key=lambda x: -x[1]["spend_30d"])[:10]
    money_pit_ads = sorted(
        [(k, m) for k, m in ads.items() if m["spend_30d"] >= THRESHOLDS["ad_waste_min_spend"] and m["clicks_30d"] == 0],
        key=lambda x: -x[1]["spend_30d"])[:10]
    def fmt_ad_list(items, include_keys):
        return [{"ad_id": ad_id, **{k: m.get(k) for k in include_keys}} for ad_id, m in items]
    return {
        "summary": {
            "total_ads": len(ads),
            "total_spend_30d": round(sum(m["spend_30d"] for m in ads.values()), 0),
        },
        "format_breakdown": formats,
        "top_spend_banners": fmt_ad_list(top_spend_banners,
            ["campaign", "ad_group_name", "ad_name", "ad_format", "spend_30d", "clicks_30d", "ctr_30d"]),
        "worst_performing_banners": fmt_ad_list(worst_banners,
            ["campaign", "ad_group_name", "ad_name", "spend_30d", "impressions_30d", "ctr_30d"]),
        "money_pit_ads": fmt_ad_list(money_pit_ads,
            ["campaign", "ad_group_name", "ad_name", "ad_format", "spend_30d", "impressions_30d"]),
    }


def compute_roas_proxy(category_metrics, website_rev):
    total_ga_spend_30d = sum(c["spend_30d"] for c in category_metrics.values())
    website_rev_30d = website_rev.get("total_30d", 0)
    if total_ga_spend_30d == 0:
        return {"roas_overall": 0, "note": "No Google Ads spend"}
    roas = website_rev_30d / total_ga_spend_30d
    return {
        "google_ads_spend_30d": round(total_ga_spend_30d, 0),
        "website_revenue_30d_vnd": website_rev_30d,
        "roas_overall": round(roas, 2),
        "target_roas": THRESHOLDS["roas_target"],
        "status": "healthy" if roas >= THRESHOLDS["roas_target"] else ("borderline" if roas >= THRESHOLDS["roas_target"] * 0.7 else "below_target"),
        "note": "ROAS = Pancake Website revenue (30d) / Google Ads spend (30d). Proxy — mua qua Zalo/Hotline sau khi thay Google Ads khong count vao day.",
    }


def main():
    print("[INFO] Loading input data...")
    ga_data = _load_json(GA_FILE)
    rev_data = _load_json(REV_FILE)
    st_data = _load_json(ST_FILE)
    pl_data = _load_json(PL_FILE)
    ads_data = _load_json(ADS_FILE)

    if not ga_data.get("campaigns_raw"):
        print("[FATAL] google-ads-spend.json missing or empty campaigns_raw", file=sys.stderr)
        sys.exit(1)

    print("[INFO] Computing per-campaign metrics...")
    camp_metrics, date_ranges = compute_campaign_metrics(ga_data)

    print("[INFO] Computing per-category metrics...")
    cat_metrics = compute_category_metrics(camp_metrics)

    print(f"[INFO] Computing Website revenue (30d)...")
    website_rev = compute_website_revenue(rev_data, date_ranges["start_30d"], date_ranges["end"])

    print("[INFO] Computing top lists + waste + ROAS...")
    top_lists = compute_top_lists(camp_metrics)
    waste = compute_waste_estimate(camp_metrics)
    roas = compute_roas_proxy(cat_metrics, website_rev)

    print("[INFO] Computing search term insights...")
    search_term_insights = compute_search_term_insights(st_data) if st_data else {"note": "search-terms.json not available"}

    print("[INFO] Computing placement insights...")
    placement_insights = compute_placement_insights(pl_data) if pl_data else {"note": "placement.json not available"}

    print("[INFO] Computing ad-level insights...")
    ad_insights = compute_ad_insights(ads_data) if ads_data else {"note": "ads.json not available"}

    print("[INFO] Computing spend breakdown by 9 categories x 5 periods...")
    spend_breakdown_by_period = compute_spend_breakdown_by_period(ga_data)
    for pk, pdata in spend_breakdown_by_period.items():
        print(f"  [{pk}] spend={pdata['total_spend']:,}đ / clicks={pdata['total_clicks']:,}")
        for ck, _ in CAMPAIGN_CATEGORY_ORDER:
            c = pdata["categories"][ck]
            if c["spend"] > 0:
                print(f"    {ck:20s} | {c['spend']:>13,}đ | {c['clicks']:>5} click | {c['campaigns_count']} camp")

    now_vn = datetime.now(timezone(timedelta(hours=7)))
    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source_data_date_range": date_ranges,
        "ga_account": {
            "id": ga_data.get("account_id", ""),
            "name": ga_data.get("account_name", ""),
        },
        "currency": "VND",
        "thresholds_used": THRESHOLDS,
        "summary": {
            "total_spend_30d_vnd": round(sum(m["spend_30d"] for m in camp_metrics.values()), 0),
            "total_clicks_30d": sum(m["clicks_30d"] for m in camp_metrics.values()),
            "total_impressions_30d": sum(m["impressions_30d"] for m in camp_metrics.values()),
            "active_campaigns_30d": len([m for m in camp_metrics.values() if m["active_days_30d"] > 0]),
            "total_campaigns": len(camp_metrics),
        },
        "roas_proxy": roas,
        "website_revenue_pancake": website_rev,
        # MỚI (2026-04-23 v2): chi phí Google Ads phân theo 9 nhóm chuẩn Doscom
        # (match tên chiến dịch) cho 5 period: yesterday/7d/this_month/30d/90d
        "spend_breakdown_by_period": spend_breakdown_by_period,
        "category_order": [{"key": k, "label": l} for k, l in CAMPAIGN_CATEGORY_ORDER],
        "per_category": cat_metrics,
        "per_campaign": camp_metrics,
        "top_lists": top_lists,
        "waste_estimate": waste,
        "search_term_insights": search_term_insights,
        "placement_insights": placement_insights,
        "ad_insights": ad_insights,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Wrote {OUT_FILE}")
    print(f"       Period: {date_ranges['start_30d']} -> {date_ranges['end']} (30d)")
    print(f"       Total spend 30d: {output['summary']['total_spend_30d_vnd']:,.0f}d")
    print(f"       Total clicks 30d: {output['summary']['total_clicks_30d']:,}")
    print(f"       Active campaigns: {output['summary']['active_campaigns_30d']}/{output['summary']['total_campaigns']}")
    print(f"       ROAS (proxy): {roas['roas_overall']}x ({roas['status']})")
    print(f"       Wasted spend: {waste['total_wasted_30d_vnd']:,.0f}d/30d ({len(waste['items'])} campaigns)")
    if search_term_insights.get("summary"):
        s = search_term_insights["summary"]
        print(f"       Search terms: {s['total_unique_terms']:,} unique ({s['terms_with_conversions']} con)")
        print(f"         Top waste: {len(search_term_insights.get('top_waste_terms', []))} | Neg gap: {len(search_term_insights.get('negative_keyword_gap', []))}")
    if placement_insights.get("summary"):
        p = placement_insights["summary"]
        print(f"       Placements: {p['total_unique_placements']:,} unique")
        print(f"         Waste: {len(placement_insights.get('top_waste_placements', []))} | Low CTR: {len(placement_insights.get('low_ctr_placements', []))}")
    if ad_insights.get("summary"):
        a = ad_insights["summary"]
        print(f"       Ads: {a['total_ads']:,} | Worst banners: {len(ad_insights.get('worst_performing_banners', []))} | Money-pit: {len(ad_insights.get('money_pit_ads', []))}")


if __name__ == "__main__":
    main()

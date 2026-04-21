#!/usr/bin/env python3
"""
Fetch Google Ads Search Terms Report từ Windsor.ai JSON API.
Transform thành data/google-ads-search-terms.json — agent AI đọc để phân tích
keyword hiệu quả, phát hiện negative keyword gap, tối ưu match type.

Fields (11): account_name, campaign, date, spend, clicks, impressions, datasource,
             search_term, conversions, search_term_match_type, search_term_view_status

Cron: mỗi 60 phút qua GitHub Actions (.github/workflows/fetch-google-ads-search-terms.yml).
"""

import os
import json
import sys
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────
API_KEY = os.environ.get("WINDSOR_API_KEY", "").strip()
ACCOUNT_NAME = os.environ.get("WINDSOR_GOOGLE_ADS_ACCOUNT_NAME", "MHDI").strip()

DATE_PRESET = "last_30d"  # Search terms chỉ cần 30 ngày là đủ
FIELDS = (
    "account_name,campaign,date,spend,clicks,impressions,datasource,"
    "search_term,conversions,search_term_match_type,search_term_view_status,"
    "search_top_impression_share,search_absolute_top_impression_share"
)
BASE_URL = "https://connectors.windsor.ai/all"


# ── Category detection (đồng bộ với fetch_google_ads_spend.py) ──
def detect_category(name: str) -> str:
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
        or "camera wifi" in n
        or "camera 4g" in n
        or "camera mini" in n
        or re.search(r"nlmt", n)):
        return "OTHER_CAM"
    return "OTHER"


def fetch_windsor_data() -> list:
    if not API_KEY:
        print("[FATAL] Missing WINDSOR_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    url = f"{BASE_URL}?api_key={API_KEY}&date_preset={DATE_PRESET}&fields={FIELDS}"
    print(f"[INFO] Fetching Windsor.ai search terms (date_preset={DATE_PRESET})")
    print(f"[INFO] Fields ({len(FIELDS.split(','))}): {FIELDS}")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:500]
        print(f"[FATAL] HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[FATAL] Windsor fetch failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[FATAL] Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or data.get("result") or []
    return []


def main():
    all_rows = fetch_windsor_data()
    print(f"[INFO] Got {len(all_rows)} rows total (all connectors)")

    # Filter chỉ Google Ads + account MHDI + row có search_term
    def valid(r):
        ds = (r.get("datasource", "") or "").lower()
        if "google" not in ds or "ad" not in ds:
            return False
        if ACCOUNT_NAME and (r.get("account_name", "") or "").strip() != ACCOUNT_NAME:
            return False
        term = (r.get("search_term", "") or "").strip()
        return bool(term)

    rows = [r for r in all_rows if valid(r)]
    print(f"[INFO] Filtered to {len(rows)} valid Google Ads search term rows")

    if not rows:
        print("[WARN] No search term data. Giữ nguyên file cũ, không overwrite.")
        sys.exit(0)

    terms_raw = []
    dates = []
    for r in rows:
        campaign = r.get("campaign", "") or ""
        date = r.get("date", "") or ""
        if date:
            dates.append(date)
        terms_raw.append({
            "campaign": campaign,
            "category": detect_category(campaign),
            "date": date,
            "search_term": (r.get("search_term", "") or "").strip(),
            "match_type": r.get("search_term_match_type", "") or "",
            "status": r.get("search_term_view_status", "") or "",
            "spend": float(r.get("spend", 0) or 0),
            "clicks": int(r.get("clicks", 0) or 0),
            "impressions": int(r.get("impressions", 0) or 0),
            "conversions": float(r.get("conversions", 0) or 0),
            "top_impression_share": float(r.get("search_top_impression_share", 0) or 0),
            "absolute_top_impression_share": float(r.get("search_absolute_top_impression_share", 0) or 0),
        })

    dates_sorted = sorted(set(dates))
    now_vn = datetime.now(timezone(timedelta(hours=7)))

    # Pre-aggregate: search_term → 30d totals (giúp compute_metrics nhanh hơn)
    agg = defaultdict(lambda: {
        "campaigns": set(),
        "match_types": set(),
        "statuses": set(),
        "spend": 0.0, "clicks": 0, "impressions": 0, "conversions": 0.0,
    })
    for t in terms_raw:
        key = t["search_term"]
        e = agg[key]
        e["campaigns"].add(t["campaign"])
        if t["match_type"]:
            e["match_types"].add(t["match_type"])
        if t["status"]:
            e["statuses"].add(t["status"])
        e["spend"] += t["spend"]
        e["clicks"] += t["clicks"]
        e["impressions"] += t["impressions"]
        e["conversions"] += t["conversions"]
        # Preserve max impression share seen (ranking SEO)
        top_is = t.get("top_impression_share", 0) or 0
        abs_top_is = t.get("absolute_top_impression_share", 0) or 0
        if "top_is" not in e: e["top_is"] = 0
        if "abs_top_is" not in e: e["abs_top_is"] = 0
        e["top_is"] = max(e["top_is"], top_is)
        e["abs_top_is"] = max(e["abs_top_is"], abs_top_is)

    term_aggregates = {
        term: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "conversions_30d": round(e["conversions"], 2),
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "cpc_30d": round(e["spend"] / e["clicks"], 0) if e["clicks"] > 0 else 0,
            "campaigns": sorted(list(e["campaigns"])),
            "match_types": sorted(list(e["match_types"])),
            "statuses": sorted(list(e["statuses"])),
            "top_impression_share": round(e.get("top_is", 0), 4),
            "abs_top_impression_share": round(e.get("abs_top_is", 0), 4),
        }
        for term, e in agg.items()
    }

    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source": "Windsor.ai JSON API (search terms, auto every 60min)",
        "account_name": ACCOUNT_NAME,
        "date_range": {
            "start": dates_sorted[0] if dates_sorted else "",
            "end": dates_sorted[-1] if dates_sorted else "",
        },
        "currency": "VND",
        "rows_raw": len(rows),
        "unique_search_terms": len(term_aggregates),
        "term_aggregates": term_aggregates,
    }

    out_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "google-ads-search-terms.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Wrote {out_path}")
    print(f"       Rows raw: {len(rows)} | Unique terms: {len(term_aggregates)}")
    print(f"       Date range: {output['date_range']['start']} → {output['date_range']['end']}")

    # Top 5 spending terms for quick sanity check
    top = sorted(term_aggregates.items(), key=lambda x: -x[1]["spend_30d"])[:5]
    print(f"\n       Top 5 search terms by spend 30d:")
    for term, m in top:
        conv = m["conversions_30d"]
        status = "🟢" if conv > 0 else "🔴"
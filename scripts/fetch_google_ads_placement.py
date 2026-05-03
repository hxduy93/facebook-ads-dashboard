#!/usr/bin/env python3
"""
Fetch Google Ads Display Network (GDN) Placement Report từ Windsor.ai JSON API.
Transform thành data/google-ads-placement.json — agent AI đọc để phát hiện placement
lãng phí, đề xuất site exclusion, phân tích hiệu quả Search vs Display vs YouTube.

Fields (9): account_name, campaign, date, spend, clicks, impressions,
            placement, placement_type, ad_network_type

ad_network_type values: SEARCH, CONTENT (= Display), YOUTUBE_SEARCH, YOUTUBE_WATCH, MIXED
placement_type values: WEBSITE, MOBILE_APPLICATION, YOUTUBE_VIDEO, YOUTUBE_CHANNEL

Cron: mỗi 60 phút qua GitHub Actions (.github/workflows/fetch-google-ads-placement.yml).
"""

import os
import json
import sys
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from collections import defaultdict

API_KEY = os.environ.get("WINDSOR_API_KEY", "").strip()
ACCOUNT_NAME = os.environ.get("WINDSOR_GOOGLE_ADS_ACCOUNT_NAME", "MHDI").strip()

DATE_PRESET = "last_30d"
FIELDS = (
    "account_name,campaign,date,spend,clicks,impressions,"
    "placement,placement_type,ad_network_type"
)
BASE_URL = "https://connectors.windsor.ai/all"


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
        or "camera wifi" in n or "camera 4g" in n or "camera mini" in n
        or re.search(r"nlmt", n)):
        return "OTHER_CAM"
    return "OTHER"


def fetch_windsor_data() -> list:
    if not API_KEY:
        print("[FATAL] Missing WINDSOR_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    url = f"{BASE_URL}?api_key={API_KEY}&date_preset={DATE_PRESET}&fields={FIELDS}"
    print(f"[INFO] Fetching Windsor.ai placement report (date_preset={DATE_PRESET})")
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
    print(f"[INFO] Got {len(all_rows)} rows total")

    # Filter: account MHDI + row có placement hoặc ad_network_type
    def valid(r):
        if ACCOUNT_NAME and (r.get("account_name", "") or "").strip() != ACCOUNT_NAME:
            return False
        # Giữ cả row network=SEARCH (placement=null) để tổng hợp spend theo network
        return True

    rows = [r for r in all_rows if valid(r)]
    print(f"[INFO] Filtered to {len(rows)} valid rows (MHDI account)")

    if not rows:
        print("[WARN] No placement data. Giữ nguyên file cũ, không overwrite.")
        sys.exit(0)

    placements_raw = []
    dates = []
    for r in rows:
        campaign = r.get("campaign", "") or ""
        date = r.get("date", "") or ""
        if date:
            dates.append(date)
        placements_raw.append({
            "campaign": campaign,
            "category": detect_category(campaign),
            "date": date,
            "placement": (r.get("placement", "") or "").strip(),
            "placement_type": r.get("placement_type", "") or "",
            "ad_network_type": r.get("ad_network_type", "") or "",
            "spend": float(r.get("spend", 0) or 0),
            "clicks": int(r.get("clicks", 0) or 0),
            "impressions": int(r.get("impressions", 0) or 0),
        })

    dates_sorted = sorted(set(dates))
    now_vn = datetime.now(timezone(timedelta(hours=7)))

    # Pre-aggregate by placement (chỉ với row có placement, bỏ SEARCH network)
    placement_agg = defaultdict(lambda: {
        "campaigns": set(), "placement_type": "", "ad_network_type": "",
        "spend": 0.0, "clicks": 0, "impressions": 0,
    })
    for p in placements_raw:
        if not p["placement"]:
            continue
        key = p["placement"]
        e = placement_agg[key]
        e["campaigns"].add(p["campaign"])
        e["placement_type"] = p["placement_type"] or e["placement_type"]
        e["ad_network_type"] = p["ad_network_type"] or e["ad_network_type"]
        e["spend"] += p["spend"]
        e["clicks"] += p["clicks"]
        e["impressions"] += p["impressions"]

    placement_aggregates = {
        placement: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "placement_type": e["placement_type"],
            "ad_network_type": e["ad_network_type"],
            "campaigns": sorted(list(e["campaigns"])),
        }
        for placement, e in placement_agg.items()
    }

    # Pre-aggregate by ad_network_type (để phân tích Search vs Display vs YouTube)
    network_agg = defaultdict(lambda: {
        "spend": 0.0, "clicks": 0, "impressions": 0, "campaigns": set(),
    })
    for p in placements_raw:
        nt = p["ad_network_type"] or "UNKNOWN"
        e = network_agg[nt]
        e["spend"] += p["spend"]
        e["clicks"] += p["clicks"]
        e["impressions"] += p["impressions"]
        e["campaigns"].add(p["campaign"])

    network_aggregates = {
        nt: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "cpc_30d": round(e["spend"] / e["clicks"], 0) if e["clicks"] > 0 else 0,
            "campaign_count": len(e["campaigns"]),
        }
        for nt, e in network_agg.items()
    }

    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source": "Windsor.ai JSON API (placement, auto every 60min)",
        "account_name": ACCOUNT_NAME,
        "date_range": {
            "start": dates_sorted[0] if dates_sorted else "",
            "end": dates_sorted[-1] if dates_sorted else "",
        },
        "currency": "VND",
        "rows_raw": len(rows),
        "unique_placements": len(placement_aggregates),
        "placement_aggregates": placement_aggregates,
        "network_aggregates": network_aggregates,
    }

    out_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "google-ads-placement.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Wrote {out_path}")
    print(f"       Rows raw: {len(rows)} | Unique placements: {len(placement_aggregates)}")
    print(f"       Date range: {output['date_range']['start']} → {output['date_range']['end']}")

    print(f"\n       Spend by network type 30d:")
    for nt, m in sorted(network_aggregates.items(), key=lambda x: -x[1]["spend_30d"]):
        print(f"         {nt:20s}: {m['spend_30d']:>12,.0f}đ · {m['clicks_30d']:>5} clicks · CTR {m['ctr_30d']*100:.2f}%")

    top_waste = sorted(
        [(k, v) for k, v in placement_aggregates.items() if v["spend_30d"] > 0 and v["clicks_30d"] == 0],
        key=lambda x: -x[1]["spend_30d"]
    )[:5]
    if top_waste:
        print(f"\n       Top 5 placements có spend mà 0 click (waste candidates):")
        for placement, m in top_waste:
            print(f"         [{m['spend_30d']:>10,.0f}đ · 0 clicks · {m['placement_type']}] {placement[:60]}")


if __name__ == "__main__":
    main()

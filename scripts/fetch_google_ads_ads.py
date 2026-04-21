#!/usr/bin/env python3
"""
Fetch Google Ads ads per ad-level (banner GDN + RSA info) từ Windsor.ai.
Transform thành data/google-ads-ads.json — agent AI đọc để phân tích:
  - Banner GDN (ad_name kiểu "300x250.gif", "160x600.gif") nào hiệu quả
  - RSA ad_id nào underperform (dù chưa lấy được text headline text)
  - Ad lỗi (spend cao, CTR thấp, 0 conversion)

Fields (11): account_name, campaign, ad_group_name, ad_id, ad_name, date,
             spend, clicks, impressions,
             ad_responsive_search_ad_headlines, ad_text_ad_description1

Note: RSA headline text hiện null (Windsor free trial limitation — có thể nâng cấp
      gói trả phí hoặc chuyển Google Ads API trực tiếp để lấy text thật).
      Agent sẽ flag ad_id + ad_name để user review manually trong Google Ads UI.

Cron: mỗi 60 phút qua GitHub Actions.
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
    "account_name,campaign,ad_group_name,ad_id,ad_name,date,"
    "spend,clicks,impressions,"
    "ad_responsive_search_ad_headlines,ad_text_ad_description1"
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


def detect_ad_format(ad_name: str) -> str:
    """Phân loại ad dựa trên ad_name.
    Banner GDN thường có tên dạng 'WxH.gif' hoặc 'WxH.png' hoặc 'WxH.jpg'.
    RSA thường không có tên (null hoặc 'Ad X').
    """
    name = (ad_name or "").strip().lower()
    if not name or name == "null":
        return "RSA"  # Không có tên → thường là RSA (Windsor không có text)
    if re.search(r"\d{2,4}x\d{2,4}\.(gif|png|jpg|jpeg|webp)", name):
        return "DISPLAY_BANNER"
    if re.search(r"(video|youtube|clip)", name):
        return "VIDEO"
    if re.search(r"^ad\s*\d+$", name):  # "Ad 1", "Ad 2"
        return "RSA"
    return "OTHER"


def fetch_windsor_data() -> list:
    if not API_KEY:
        print("[FATAL] Missing WINDSOR_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    url = f"{BASE_URL}?api_key={API_KEY}&date_preset={DATE_PRESET}&fields={FIELDS}"
    print(f"[INFO] Fetching Windsor.ai ads report (date_preset={DATE_PRESET})")
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

    def valid(r):
        if ACCOUNT_NAME and (r.get("account_name", "") or "").strip() != ACCOUNT_NAME:
            return False
        # Cần ít nhất ad_id để aggregate
        return bool(r.get("ad_id"))

    rows = [r for r in all_rows if valid(r)]
    print(f"[INFO] Filtered to {len(rows)} valid ad-level rows (MHDI account)")

    if not rows:
        print("[WARN] No ads data. Giữ nguyên file cũ, không overwrite.")
        sys.exit(0)

    ads_raw = []
    dates = []
    for r in rows:
        campaign = r.get("campaign", "") or ""
        ad_name = r.get("ad_name", "") or ""
        date = r.get("date", "") or ""
        if date:
            dates.append(date)

        headlines = r.get("ad_responsive_search_ad_headlines", None)
        description = r.get("ad_text_ad_description1", None)

        ads_raw.append({
            "campaign": campaign,
            "category": detect_category(campaign),
            "ad_group_name": r.get("ad_group_name", "") or "",
            "ad_id": str(r.get("ad_id", "")),
            "ad_name": ad_name,
            "ad_format": detect_ad_format(ad_name),
            "date": date,
            "spend": float(r.get("spend", 0) or 0),
            "clicks": int(r.get("clicks", 0) or 0),
            "impressions": int(r.get("impressions", 0) or 0),
            # Note: 2 field dưới thường null với Windsor free trial
            "rsa_headlines": headlines,
            "rsa_description_1": description,
        })

    dates_sorted = sorted(set(dates))
    now_vn = datetime.now(timezone(timedelta(hours=7)))

    # Pre-aggregate per ad (unique key = ad_id)
    ad_agg = defaultdict(lambda: {
        "campaign": "", "category": "", "ad_group_name": "",
        "ad_name": "", "ad_format": "",
        "spend": 0.0, "clicks": 0, "impressions": 0,
        "active_days": set(),
    })
    for a in ads_raw:
        key = a["ad_id"]
        e = ad_agg[key]
        if not e["campaign"]:
            e["campaign"] = a["campaign"]
            e["category"] = a["category"]
            e["ad_group_name"] = a["ad_group_name"]
            e["ad_name"] = a["ad_name"]
            e["ad_format"] = a["ad_format"]
        e["spend"] += a["spend"]
        e["clicks"] += a["clicks"]
        e["impressions"] += a["impressions"]
        if a["spend"] > 0 or a["clicks"] > 0:
            e["active_days"].add(a["date"])

    ad_aggregates = {
        ad_id: {
            "campaign": e["campaign"],
            "category": e["category"],
            "ad_group_name": e["ad_group_name"],
            "ad_name": e["ad_name"],
            "ad_format": e["ad_format"],
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "cpc_30d": round(e["spend"] / e["clicks"], 0) if e["clicks"] > 0 else 0,
            "active_days_30d": len(e["active_days"]),
        }
        for ad_id, e in ad_agg.items()
    }

    # Aggregate by ad_format (Banner GDN vs RSA vs Video)
    format_agg = defaultdict(lambda: {"spend": 0.0, "clicks": 0, "impressions": 0, "count": 0})
    for ad_id, m in ad_aggregates.items():
        fmt = m["ad_format"] or "UNKNOWN"
        format_agg[fmt]["spend"] += m["spend_30d"]
        format_agg[fmt]["clicks"] += m["clicks_30d"]
        format_agg[fmt]["impressions"] += m["impressions_30d"]
        format_agg[fmt]["count"] += 1

    format_aggregates = {
        fmt: {
            "spend_30d": round(e["spend"], 0),
            "clicks_30d": e["clicks"],
            "impressions_30d": e["impressions"],
            "ctr_30d": round(e["clicks"] / e["impressions"], 4) if e["impressions"] > 0 else 0,
            "ad_count": e["count"],
        }
        for fmt, e in format_agg.items()
    }

    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source": "Windsor.ai JSON API (ads, auto every 60min)",
        "account_name": ACCOUNT_NAME,
        "date_range": {
            "start": dates_sorted[0] if dates_sorted else "",
            "end": dates_sorted[-1] if dates_sorted else "",
        },
        "currency": "VND",
        "rows_raw": len(rows),
        "unique_ads": len(ad_aggregates),
        "notes": {
            "rsa_headlines_limitation": (
                "RSA headline text + description hiện null (Windsor free trial "
                "không expose asset text). Agent dùng ad_id + ad_name + metrics để "
                "flag ad underperform, user review text manually trên Google Ads UI."
            ),
        },
        "ad_aggregates": ad_aggregates,
        "format_aggregates": format_aggregates,
    }

    out_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "google-ads-ads.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n[DONE] Wrote {out_path}")
    print(f"       Rows raw: {len(rows)} | Unique ads: {len(ad_aggregates)}")
    print(f"       Date range: {output['date_range']['start']} → {output['date_range']['end']}")

    print(f"\n       Breakdown by ad format 30d:")
    for fmt, m in sorted(format_aggregates.items(), key=lambda x: -x[1]["spend_30d"]):
        print(f"         {fmt:18s}: {m['spend_30d']:>12,.0f}đ · {m['ad_count']:>3} ads · {m['clicks_30d']:>5} clicks · CTR {m['ctr_30d']*100:.2f}%")

    # Top 5 spending ads
    top = sorted(ad_aggregates.items(), key=lambda x: -x[1]["spend_30d"])[:5]
    print(f"\n       Top 5 ads by spend 30d:")
    for ad_id, m in top:
        print(f"         [{m['spend_30d']:>10,.0f}đ · {m['clicks_30d']:>4} clicks · CTR {m['ctr_30d']*100:.2f}% · {m['ad_format']}] {m['ad_name'] or '(no name)'} (id={ad_id})")


if __name__ == "__main__":
    main()
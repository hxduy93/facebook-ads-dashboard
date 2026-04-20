#!/usr/bin/env python3
"""
Fetch Google Ads spend from Windsor.ai JSON API (account MHDI 477-705-2298).
Transform thành data/google-ads-spend.json với schema by_category + campaigns_raw.

Schema phải khớp với dashboard (template.html — GOOGLE_CATEGORIES + GoogleAdsProfit):
- 4 category có mapping SP Pancake: MAYDO / DINHVI / GHIAM / CAMCALL
- 5 "OTHER_*" category detected từ tên campaign (re-categorize ở frontend
  thành micro: CAM4G, CAMWIFI, CAMNLMT, ANTIREC, RAZOR, OTHER_MISC)

Cron: mỗi 30 phút qua GitHub Actions (.github/workflows/fetch-google-ads.yml).
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
ACCOUNT_ID = os.environ.get("WINDSOR_GOOGLE_ADS_ACCOUNT_ID", "477-705-2298").strip()
ACCOUNT_NAME = os.environ.get("WINDSOR_GOOGLE_ADS_ACCOUNT_NAME", "MHDI").strip()

DATE_PRESET = "last_90d"
FIELDS = "campaign,date,spend,clicks,impressions"

BASE_URL = "https://connectors.windsor.ai/all"

# ── Category detection ─────────────────────────────────────────
# Đồng bộ với detect trong template.html (block GOOGLE_CATEGORIES).
def detect_category(name: str) -> str:
    n = (name or "").lower()
    # 4 main categories (có mapping SP Pancake)
    if "máy dò" in n or "tb dò" in n:
        return "MAYDO"
    if "tbđv gps" in n or "thiết bị định vị" in n or "shopping - 6/6 - đv" in n:
        return "DINHVI"
    if "tb ghi âm" in n or "thiết bị ghi âm" in n or (re.search(r"\bghi âm\b", n) and "chống" not in n):
        return "GHIAM"
    if "camera gọi 2 chiều" in n:
        return "CAMCALL"
    # OTHER_* (micro categories)
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
    # Fallback: các SP khác (Máy Massage, Rửa Hoa Quả, Thiết Bị Chăm Sóc...)
    return "OTHER"


def fetch_windsor_data() -> list:
    if not API_KEY:
        print("[FATAL] Missing WINDSOR_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    url = (
        f"{BASE_URL}"
        f"?api_key={API_KEY}"
        f"&connector=google_ads"
        f"&_account={ACCOUNT_ID}"
        f"&date_preset={DATE_PRESET}"
        f"&fields={FIELDS}"
    )

    print(f"[INFO] Fetching Windsor.ai data for account {ACCOUNT_ID} ({ACCOUNT_NAME})")
    print(f"[INFO] Date range: {DATE_PRESET} · fields: {FIELDS}")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:500]
        print(f"[FATAL] HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[FATAL] Windsor.ai fetch failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[FATAL] Invalid JSON response: {e}", file=sys.stderr)
        print(f"        Raw (first 500 chars): {raw[:500]}", file=sys.stderr)
        sys.exit(1)

    # Windsor có thể trả list trực tiếp hoặc wrap trong { "data": [...] } / { "result": [...] }
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or data.get("result") or []
    return []


def main():
    rows = fetch_windsor_data()
    print(f"[INFO] Got {len(rows)} rows from Windsor.ai")

    if not rows:
        print("[WARN] No data returned. Giữ nguyên file cũ, không overwrite.")
        sys.exit(0)

    by_category = defaultdict(lambda: {"_total": 0.0, "by_date": defaultdict(float)})
    campaigns_raw = []
    dates = []

    for r in rows:
        campaign = r.get("campaign", "") or ""
        cat = detect_category(campaign)
        spend = float(r.get("spend", 0) or 0)
        clicks = int(r.get("clicks", 0) or 0)
        impressions = int(r.get("impressions", 0) or 0)
        date = r.get("date", "") or ""
        if date:
            dates.append(date)

        by_category[cat]["_total"] += spend
        by_category[cat]["by_date"][date] += spend

        campaigns_raw.append({
            "campaign": campaign,
            "category": cat,
            "date": date,
            "spend": spend,
            "clicks": clicks,
            "impressions": impressions,
        })

    dates_sorted = sorted(set(dates))
    now_vn = datetime.now(timezone(timedelta(hours=7)))

    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source": "Windsor.ai JSON API (auto every 30min)",
        "account_id": ACCOUNT_ID,
        "account_name": ACCOUNT_NAME,
        "date_range": {
            "start": dates_sorted[0] if dates_sorted else "",
            "end": dates_sorted[-1] if dates_sorted else "",
        },
        "currency": "VND",
        "rows_raw": len(rows),
        "by_category": {
            k: {
                "_total": round(v["_total"], 4),
                "by_date": {d: round(s, 4) for d, s in v["by_date"].items()},
            }
            for k, v in by_category.items()
        },
        "campaigns_raw": campaigns_raw,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "google-ads-spend.json")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total = sum(v["_total"] for v in by_category.values())
    print(f"\n[DONE] Wrote {out_path}")
    print(f"       Total spend 90d: {total:,.0f}đ")
    print(f"       Unique campaigns: {len(set(r['campaign'] for r in campaigns_raw))}")
    print(f"       Categories:")
    for cat in sorted(by_category.keys()):
        unique_camps = len(set(r["campaign"] for r in campaigns_raw if r["category"] == cat))
        print(f"         {cat:12s}: {by_category[cat]['_total']:>14,.0f}đ · {unique_camps} camps")


if __name__ == "__main__":
    main()

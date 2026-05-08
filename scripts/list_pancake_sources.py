#!/usr/bin/env python3
"""
List Pancake order sources, group by staff prefix.

Pancake không có endpoint public list nguồn. Workaround: fetch ~10000 đơn
trong 180 ngày gần đây (mọi nguồn), extract field `order_sources` (ID) +
`order_sources_name` (name) per đơn, dedupe và group by prefix:
- DUY (name bắt đầu "DUY - ")
- PHUONG_NAM (name bắt đầu "PHƯƠNG NAM - ")
- FB_MESSENGER (id "-1", name "Facebook" — đơn nhắn tin qua page)
- OTHER (Hotline, Shopee, Tiktok, WEBSITE, ...)

Usage (GitHub Actions): trigger workflow `list-pancake-sources.yml`.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE = "https://pos.pancake.vn/api/v1"
LOOKBACK_DAYS = 180   # 6 tháng để cover các nguồn ít đơn
PAGE_SIZE = 100
MAX_PAGES = 200       # 200 × 100 = 20000 đơn — đủ cho shop trung bình

if not API_KEY or not SHOP_ID:
    sys.exit("ERROR: PANCAKE_API_KEY or PANCAKE_SHOP_ID not set")


def call_api(method, path, params):
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method=method,
                                 headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:300]
        return {"_error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}"}


def parse_field(val):
    """Pancake field có thể là string, CSV string, hoặc list. Return list of strings."""
    if val is None:
        return []
    if isinstance(val, list):
        return [str(v).strip() for v in val if v not in (None, "")]
    s = str(val).strip()
    if not s:
        return []
    if "," in s:
        return [p.strip() for p in s.split(",") if p.strip()]
    return [s]


def fetch_all_orders():
    """Fetch all orders trong lookback window (mọi nguồn)."""
    end_ts = int(time.time())
    start_ts = end_ts - LOOKBACK_DAYS * 86400
    sources_seen = {}   # id -> name
    total_orders = 0

    for page in range(1, MAX_PAGES + 1):
        params = {
            "api_key": API_KEY,
            "page": page,
            "page_size": PAGE_SIZE,
            "status": -1,
            "updateStatus": "inserted_at",
            "option_sort": "inserted_at_desc",
            "es_only": "true",
            "startDateTime": start_ts,
            "endDateTime": end_ts,
        }
        resp = call_api("POST", f"shops/{SHOP_ID}/orders/get_orders", params)
        if "_error" in resp:
            print(f"[WARN] page {page}: {resp['_error']}", file=sys.stderr)
            break
        batch = resp.get("data") or resp.get("orders") or []
        if not batch:
            print(f"[INFO] page {page}: empty -> stop", file=sys.stderr)
            break
        total_orders += len(batch)
        for o in batch:
            ids = parse_field(o.get("order_sources"))
            names = parse_field(o.get("order_sources_name"))
            for i, sid in enumerate(ids):
                name = names[i] if i < len(names) else ""
                if sid not in sources_seen or (not sources_seen[sid] and name):
                    sources_seen[sid] = name
        if page % 10 == 0 or page == 1:
            print(f"[INFO] page {page}: orders {total_orders}, "
                  f"unique sources {len(sources_seen)}", file=sys.stderr)
        if len(batch) < PAGE_SIZE:
            print(f"[INFO] page {page}: last page (batch < {PAGE_SIZE})",
                  file=sys.stderr)
            break
        time.sleep(0.2)

    return sources_seen, total_orders


def categorize(sid, name):
    """Return category key based on name prefix."""
    n = (name or "").upper().strip()
    if n.startswith("DUY -") or n.startswith("DUY-"):
        return "DUY"
    if n.startswith("PHƯƠNG NAM -") or n.startswith("PHUONG NAM -"):
        return "PHUONG_NAM"
    if sid == "-1" or n == "FACEBOOK":
        return "FB_MESSENGER"
    return "OTHER"


def main():
    print(f"\n=== Lookback {LOOKBACK_DAYS} days, max {MAX_PAGES} pages "
          f"× {PAGE_SIZE} ===\n", file=sys.stderr)

    sources, total = fetch_all_orders()

    if not sources:
        sys.exit("ERROR: Không extract được source nào")

    grouped = {"DUY": [], "PHUONG_NAM": [], "FB_MESSENGER": [], "OTHER": []}
    for sid, name in sources.items():
        cat = categorize(sid, name)
        grouped[cat].append((sid, name))

    # Sort each group by name
    for cat in grouped:
        grouped[cat].sort(key=lambda x: x[1].upper())

    # Print mapping (stdout — what user copies)
    print(f"\n# Stats: {total} orders fetched, {len(sources)} unique sources")
    print(f"#   DUY: {len(grouped['DUY'])} sources")
    print(f"#   PHUONG_NAM: {len(grouped['PHUONG_NAM'])} sources")
    print(f"#   FB_MESSENGER: {len(grouped['FB_MESSENGER'])} sources")
    print(f"#   OTHER: {len(grouped['OTHER'])} sources")

    for cat_label, cat_key in [
        ("DUY (FB Ads sources)", "DUY"),
        ("PHƯƠNG NAM (FB Ads sources)", "PHUONG_NAM"),
        ("FACEBOOK MESSENGER (đơn nhắn tin qua page)", "FB_MESSENGER"),
        ("OTHER (Hotline, Shopee, Tiktok, WEBSITE, ...)", "OTHER"),
    ]:
        print(f"\n========== {cat_label} ==========")
        items = grouped[cat_key]
        if not items:
            print("(empty)")
            continue
        print(f"{'ID':<14} | Name")
        print("-" * 70)
        for sid, name in items:
            print(f"{sid:<14} | {name or '(no name)'}")

    print(f"\nDone.")


if __name__ == "__main__":
    main()

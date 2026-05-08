#!/usr/bin/env python3
"""
List Pancake order sources for DUY và PHƯƠNG NAM.

Pancake không có endpoint public list nguồn. Workaround: dùng 2 saved_filters_id
đã có sẵn trong fetch_pancake_revenue.py để fetch đơn của riêng 2 nhân sự,
extract field `order_sources` (ID) + `order_sources_name` (name) per đơn.

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
LOOKBACK_DAYS = 60   # 60 ngày để đảm bảo cover hết nguồn
PAGE_SIZE = 100
MAX_PAGES_PER_GROUP = 30   # 30 × 100 = 3000 đơn / group

if not API_KEY or not SHOP_ID:
    sys.exit("ERROR: PANCAKE_API_KEY or PANCAKE_SHOP_ID not set")

# Saved filters từ fetch_pancake_revenue.py
STAFF_FILTERS = [
    {"key": "DUY",        "filter_id": "8350fe1d-fd9b-41d8-bb3a-f075a5e94df5"},
    {"key": "PHUONG_NAM", "filter_id": "78a874c7-0601-4416-a377-481dce360b87"},
]


def call_api(method, path, params):
    """Pancake style: api_key + params trong URL query, body rỗng."""
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


def parse_source_field(val):
    """Pancake `order_sources` có thể là:
    - String: "308004272" hoặc "-9"
    - String chứa CSV: "-1,842243695641184"
    - List: ["308004272"] (rare)
    Return list of ID strings."""
    if val is None:
        return []
    if isinstance(val, list):
        return [str(v).strip() for v in val if v not in (None, "")]
    s = str(val).strip()
    if not s:
        return []
    # CSV style?
    if "," in s:
        return [p.strip() for p in s.split(",") if p.strip()]
    return [s]


def parse_name_field(val):
    """`order_sources_name` cùng format. Return list of name strings."""
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


def fetch_for_filter(filter_id, key):
    """Fetch all orders for 1 saved_filter, dedupe sources."""
    end_ts = int(time.time())
    start_ts = end_ts - LOOKBACK_DAYS * 86400
    sources_seen = {}   # id -> name (first non-empty wins)
    total_orders = 0

    for page in range(1, MAX_PAGES_PER_GROUP + 1):
        params = {
            "api_key": API_KEY,
            "page": page,
            "page_size": PAGE_SIZE,
            "status": -1,
            "updateStatus": "inserted_at",
            "option_sort": "inserted_at_desc",
            "es_only": "true",
            "is_filter_multiple_source": "true",
            "saved_filters_id": filter_id,
            "startDateTime": start_ts,
            "endDateTime": end_ts,
        }
        resp = call_api("POST", f"shops/{SHOP_ID}/orders/get_orders", params)
        if "_error" in resp:
            print(f"[WARN] {key} page {page}: {resp['_error']}", file=sys.stderr)
            break
        batch = resp.get("data") or resp.get("orders") or []
        if not batch:
            break
        total_orders += len(batch)
        for o in batch:
            ids = parse_source_field(o.get("order_sources"))
            names = parse_name_field(o.get("order_sources_name"))
            for i, sid in enumerate(ids):
                name = names[i] if i < len(names) else ""
                if sid not in sources_seen or (not sources_seen[sid] and name):
                    sources_seen[sid] = name
        print(f"[INFO] {key} page {page}: +{len(batch)} (orders {total_orders}, "
              f"unique sources {len(sources_seen)})", file=sys.stderr)
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(0.3)

    return sources_seen, total_orders


def main():
    print(f"\n=== Lookback {LOOKBACK_DAYS} days, max {MAX_PAGES_PER_GROUP} "
          f"pages × {PAGE_SIZE} per staff ===\n", file=sys.stderr)

    all_results = {}
    for staff in STAFF_FILTERS:
        print(f"\n>>> Fetching {staff['key']} (filter_id={staff['filter_id']})",
              file=sys.stderr)
        sources, total = fetch_for_filter(staff["filter_id"], staff["key"])
        all_results[staff["key"]] = {"sources": sources, "total_orders": total}

    # Print final mapping (stdout — what user copies)
    print()
    for staff_key, data in all_results.items():
        sources = data["sources"]
        total = data["total_orders"]
        print(f"\n========== {staff_key} ==========")
        print(f"(extracted from {total} orders, {len(sources)} unique sources)")
        print(f"{'ID':<14} | Name")
        print("-" * 70)
        # Sort by name
        for sid, name in sorted(sources.items(), key=lambda x: x[1].upper()):
            print(f"{sid:<14} | {name or '(no name)'}")

    print(f"\n\nDone. Total unique sources: "
          f"DUY={len(all_results.get('DUY',{}).get('sources',{}))}, "
          f"PN={len(all_results.get('PHUONG_NAM',{}).get('sources',{}))}")


if __name__ == "__main__":
    main()

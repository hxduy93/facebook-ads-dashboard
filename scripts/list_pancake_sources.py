#!/usr/bin/env python3
"""
List unique Pancake order sources by sampling recent orders.

Pancake không có public endpoint `/order_sources` (đều 404). Workaround: fetch
~500 đơn gần đây của shop (mọi nguồn), extract field `order_sources` của từng
đơn, dedupe và in ra bảng (ID | Tên nguồn).

Usage (GitHub Actions): trigger workflow `.github/workflows/list-pancake-sources.yml`.

Output: bảng (ID | Tên nguồn) + tổng count, in ra stdout.
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
LOOKBACK_DAYS = 30   # Sample đơn 30 ngày gần đây — đủ cover mọi nguồn active
PAGE_SIZE = 100
MAX_PAGES = 10       # 10 × 100 = 1000 đơn — đủ thấy nguồn rare

if not API_KEY or not SHOP_ID:
    sys.exit("ERROR: PANCAKE_API_KEY or PANCAKE_SHOP_ID not set in env")


def call_api(method, path, params):
    """Pancake style: api_key + params luôn trong URL query string,
    POST với body rỗng. Trả về JSON parsed hoặc {'_error': ...}."""
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, method=method, headers={"Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:300]
        return {"_error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}"}


def dump_sample_order():
    """Fetch 1 đơn để inspect schema — hiển thị field source-related."""
    resp = call_api("POST", f"shops/{SHOP_ID}/orders/get_orders",
                    {"api_key": API_KEY, "page": 1, "page_size": 1,
                     "status": -1, "es_only": "true"})
    if "_error" in resp:
        print(f"[ERROR] Sample fetch failed: {resp['_error']}", file=sys.stderr)
        return
    data = resp.get("data") or resp.get("orders") or []
    if not data:
        print("[ERROR] No orders found in shop", file=sys.stderr)
        return
    order = data[0]
    print("\n=== Top-level keys của 1 đơn (snippet) ===", file=sys.stderr)
    interesting = ["order_sources", "source_id", "source", "partner_id",
                   "account_id", "account", "page_id", "channel",
                   "customer_referral_source", "id", "inserted_at"]
    for k in interesting:
        if k in order:
            v = order[k]
            snip = json.dumps(v, ensure_ascii=False)[:200] \
                   if isinstance(v, (dict, list)) else str(v)[:200]
            print(f"  {k:30} = {snip}", file=sys.stderr)
    print("=== End sample ===\n", file=sys.stderr)


def extract_source_info(order):
    """
    Return list of (id_str, name_str) tuples extracted from order.

    Pancake schema (theo Pancake docs):
    - `order_sources`: list of source ID (strings hoặc objects)
    - `order_sources_name`: list of source NAME tương ứng (theo cùng order)
    Các field khác như `partner_id`, `account_id` thường là cho Messenger/sàn,
    không phải nguồn đơn user-defined.
    """
    out = []
    src_ids = order.get("order_sources") or []
    src_names = order.get("order_sources_name") or []

    if isinstance(src_ids, list) and src_ids:
        # Pad names list if shorter
        for i, sid in enumerate(src_ids):
            sid_str = str(sid).strip() if not isinstance(sid, dict) \
                      else str(sid.get("id") or sid.get("_id") or "").strip()
            if not sid_str:
                continue
            name = ""
            if i < len(src_names):
                n = src_names[i]
                name = (str(n).strip() if not isinstance(n, dict)
                        else str(n.get("name") or n.get("title") or "").strip())
            out.append((sid_str, name))

    return out


def fetch_recent_orders(days=LOOKBACK_DAYS):
    """Fetch ~MAX_PAGES × PAGE_SIZE orders trong lookback window, mọi nguồn."""
    end_ts = int(time.time())
    start_ts = end_ts - days * 86400
    all_orders = []

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
            break
        all_orders.extend(batch)
        print(f"[INFO] page {page}: +{len(batch)} (total {len(all_orders)})",
              file=sys.stderr)
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(0.3)

    return all_orders


def main():
    # Step 1: dump 1 sample order schema (debug aid)
    dump_sample_order()

    # Step 2: fetch ~1000 orders, dedupe sources
    orders = fetch_recent_orders()
    if not orders:
        sys.exit("ERROR: Không fetch được order nào")

    # ID -> name (first non-empty wins)
    source_map = {}
    for o in orders:
        for sid, name in extract_source_info(o):
            if sid not in source_map or (not source_map[sid] and name):
                source_map[sid] = name

    if not source_map:
        print("\n!!! Không thấy field 'order_sources' trong đơn.", file=sys.stderr)
        print("!!! Cần inspect schema thủ công — xem dump sample ở trên.",
              file=sys.stderr)
        # Print 1 full order as JSON for debugging
        print("\n=== Full sample order (JSON) ===")
        print(json.dumps(orders[0], indent=2, ensure_ascii=False)[:5000])
        sys.exit(1)

    # Sort: DUY trước, PHƯƠNG NAM, sau đó alphabetical
    def sort_key(item):
        sid, name = item
        n = name.upper()
        if n.startswith("DUY"):
            return (0, n)
        if n.startswith("PHƯƠNG NAM") or n.startswith("PHUONG NAM"):
            return (1, n)
        return (2, n)

    items = sorted(source_map.items(), key=sort_key)

    print()
    print(f"{'ID':<14} | Tên nguồn")
    print("-" * 70)
    for sid, name in items:
        print(f"{sid:<14} | {name or '(no name)'}")
    print()
    print(f"Total: {len(items)} unique sources từ {len(orders)} đơn (lookback {LOOKBACK_DAYS}d)")


if __name__ == "__main__":
    main()

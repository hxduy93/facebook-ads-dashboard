#!/usr/bin/env python3
"""
Fetch revenue data from Pancake POS API and aggregate by product.

Output: data/product-revenue.json

Logic:
- Filter orders whose source/channel name contains "DUY" (case-insensitive)
- Map Pancake product codes -> 5 standard products (D1, DR1, Noma911, DA8.1, DA8.1 Pro)
- For combo SKUs, revenue = fixed base price (ignores SD card price)
- Group by product × date for last 30 days
"""

import os
import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import urllib.request
import urllib.error

# ── Config ─────────────────────────────────────────────
API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE_URL = "https://pos.pages.fm/api/v1"

# Product code -> standard product + base revenue (VND)
# Combo prices strip the SD-card portion to get the machine revenue only
PRODUCT_MAPPING = {
    "1580":        {"product": "D1",        "base_price": 2_500_000},
    "DR-011":      {"product": "DR1",       "base_price": 1_300_000},
    "29792739244": {"product": "Noma 911",  "base_price":   199_000},
    "3924":        {"product": "DA8.1",     "base_price": 1_250_000},
    "COMBO-058":   {"product": "DA8.1",     "base_price": 1_250_000},  # DA8.1 + 64GB
    "COMBO-059":   {"product": "DA8.1",     "base_price": 1_250_000},  # DA8.1 + 128GB
    "21257":       {"product": "DA8.1 Pro", "base_price": 1_550_000},
    "COMBO-060":   {"product": "DA8.1 Pro", "base_price": 1_550_000},  # Pro + 64GB
    "COMBO-061":   {"product": "DA8.1 Pro", "base_price": 1_550_000},  # Pro + 128GB
}

SOURCE_FILTER_KEYWORD = "DUY"   # only count orders whose source contains "DUY"
LOOKBACK_DAYS = 90              # tạm mở rộng để verify có đơn lịch sử


def fetch_orders(page=1, page_size=100, start_date=None, end_date=None, debug=False):
    """Fetch one page of orders from Pancake POS."""
    params = {
        "api_key": API_KEY,
        "page_number": page,
        "page_size": page_size,
    }
    if start_date:
        params["startDateTime"] = start_date.strftime("%Y-%m-%dT00:00:00")
    if end_date:
        params["endDateTime"] = end_date.strftime("%Y-%m-%dT23:59:59")

    url = f"{BASE_URL}/shops/{SHOP_ID}/orders?{urlencode(params)}"
    # Print safe URL (redact key) for debugging
    safe_url = url.replace(API_KEY, "***") if API_KEY else url
    print(f"[DEBUG] GET {safe_url}")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            print(f"[DEBUG] HTTP {resp.status} · {len(raw)} bytes")
            if debug:
                print(f"[DEBUG] Response body (first 2000 chars):\n{raw[:2000]}")
            parsed = json.loads(raw)
            if debug:
                print(f"[DEBUG] Top-level keys: {list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__}")
            return parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='ignore')[:2000]
        print(f"[ERROR] HTTP {e.code}: {body}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}", file=sys.stderr)
        raise


def source_matches(order):
    """Return True if order source/channel contains 'DUY' (case-insensitive)."""
    candidates = []
    for key in ("source", "source_name", "channel", "channel_name", "order_source", "order_sources"):
        v = order.get(key)
        if isinstance(v, str):
            candidates.append(v)
        elif isinstance(v, list):
            candidates.extend(str(x) for x in v)
        elif isinstance(v, dict):
            # e.g. {"name": "Duy - Noma911"}
            for k2 in ("name", "label", "title"):
                if k2 in v and isinstance(v[k2], str):
                    candidates.append(v[k2])

    # Some Pancake schemas put source under a nested account or page object
    for key in ("account", "page", "origin"):
        v = order.get(key)
        if isinstance(v, dict):
            for k2 in ("name", "page_name"):
                if k2 in v and isinstance(v[k2], str):
                    candidates.append(v[k2])

    joined = " | ".join(candidates).upper()
    return SOURCE_FILTER_KEYWORD.upper() in joined


def extract_items(order):
    """Return list of (product_code, quantity) from order line items."""
    items = []
    for li in order.get("items", []) or order.get("order_items", []) or []:
        # Pancake typically exposes: product_code / display_id / variation_id
        code = (
            li.get("product_display_id")
            or li.get("product_code")
            or li.get("display_id")
            or (li.get("variation_info") or {}).get("display_id")
            or (li.get("product") or {}).get("display_id")
            or (li.get("product") or {}).get("code")
        )
        qty = li.get("quantity", 1) or 1
        if code:
            items.append((str(code), int(qty)))
    return items


def aggregate(orders):
    """Aggregate filtered orders → {product: {total, orders, by_date: {date: total}}}"""
    result = {
        "D1":        {"total": 0, "orders": 0, "units": 0, "by_date": {}},
        "DR1":       {"total": 0, "orders": 0, "units": 0, "by_date": {}},
        "Noma 911":  {"total": 0, "orders": 0, "units": 0, "by_date": {}},
        "DA8.1":     {"total": 0, "orders": 0, "units": 0, "by_date": {}},
        "DA8.1 Pro": {"total": 0, "orders": 0, "units": 0, "by_date": {}},
    }

    filtered_count = 0
    for o in orders:
        if not source_matches(o):
            continue
        filtered_count += 1

        # Order date (YYYY-MM-DD)
        inserted_at = o.get("inserted_at") or o.get("created_at") or o.get("order_date") or ""
        date = inserted_at[:10] if inserted_at else "unknown"

        # Track which products this order touched (to count orders correctly)
        products_in_order = set()

        for code, qty in extract_items(o):
            mapping = PRODUCT_MAPPING.get(code)
            if not mapping:
                continue
            p = mapping["product"]
            revenue = mapping["base_price"] * qty
            result[p]["total"] += revenue
            result[p]["units"] += qty
            result[p]["by_date"][date] = result[p]["by_date"].get(date, 0) + revenue
            products_in_order.add(p)

        for p in products_in_order:
            result[p]["orders"] += 1

    return result, filtered_count


def main():
    if not API_KEY or not SHOP_ID:
        print("[FATAL] Missing PANCAKE_API_KEY or PANCAKE_SHOP_ID env var", file=sys.stderr)
        sys.exit(1)

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=LOOKBACK_DAYS)

    print(f"[INFO] Fetching Pancake orders {start_dt.date()} → {end_dt.date()}")

    all_orders = []
    page = 1
    while True:
        data = fetch_orders(page=page, page_size=100, start_date=start_dt, end_date=end_dt)
        batch = data.get("data", [])
        if not batch:
            break
        all_orders.extend(batch)
        print(f"[INFO] Page {page}: {len(batch)} orders (total {len(all_orders)})")
        # Pancake typically uses total_pages or has_next
        total_pages = data.get("total_pages") or data.get("page_total") or 0
        if total_pages and page >= total_pages:
            break
        if len(batch) < 100:
            break
        page += 1
        if page > 50:  # safety cap
            print("[WARN] Hit 50-page safety cap", file=sys.stderr)
            break

    print(f"[INFO] Fetched {len(all_orders)} orders total")

    # Debug: in sample order structure để verify parsing
    if all_orders:
        sample = all_orders[0]
        print(f"[DEBUG] Sample order keys: {list(sample.keys())[:30]}")
        src_keys = {k: sample.get(k) for k in ("source", "source_name", "channel", "channel_name", "order_sources") if k in sample}
        print(f"[DEBUG] Sample source fields: {json.dumps(src_keys, ensure_ascii=False)[:500]}")
        items_sample = (sample.get("items") or sample.get("order_items") or [])
        if items_sample:
            print(f"[DEBUG] Sample item keys: {list(items_sample[0].keys())[:30]}")
            print(f"[DEBUG] Sample item (trimmed): {json.dumps(items_sample[0], ensure_ascii=False)[:800]}")

    revenue, filtered_count = aggregate(all_orders)
    print(f"[INFO] {filtered_count} orders matched source filter '{SOURCE_FILTER_KEYWORD}'")

    for p, d in revenue.items():
        print(f"  {p:12s} | {d['total']:>15,}đ | {d['orders']:>4} đơn | {d['units']:>4} sp")

    output = {
        "generated_at": end_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "window_days": LOOKBACK_DAYS,
        "source_filter": SOURCE_FILTER_KEYWORD,
        "total_orders_fetched": len(all_orders),
        "orders_matched_filter": filtered_count,
        "products": revenue,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "product-revenue.json")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[INFO] Wrote {out_path}")


if __name__ == "__main__":
    if not API_KEY or not SHOP_ID:
        print("[ERROR] Missing PANCAKE_API_KEY or PANCAKE_SHOP_ID env var", file=sys.stderr)
        sys.exit(1)
    main()

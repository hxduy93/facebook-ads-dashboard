#!/usr/bin/env python3
"""
Inspect Pancake orders cho 1 ngày cụ thể, breakdown theo `order_sources_name`.

Mục đích: debug khi snapshot không khớp Pancake POS UI — tìm đơn nào ở nguồn nào.

Usage (GitHub Actions): trigger workflow `list-pancake-sources.yml`.
Default inspect ngày hôm qua VN time. Override bằng env DEBUG_DATE=YYYY-MM-DD.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE = "https://pos.pancake.vn/api/v1"

if not API_KEY or not SHOP_ID:
    sys.exit("ERROR: PANCAKE_API_KEY or PANCAKE_SHOP_ID not set")

# Parse target date (default = yesterday VN)
DEBUG_DATE = os.environ.get("DEBUG_DATE", "").strip()
if not DEBUG_DATE:
    vn_now = datetime.now(timezone.utc) + timedelta(hours=7)
    DEBUG_DATE = (vn_now - timedelta(days=1)).strftime("%Y-%m-%d")
print(f"[INFO] Inspecting date: {DEBUG_DATE}", file=sys.stderr)

# Window 7d centered on DEBUG_DATE
target_dt = datetime.strptime(DEBUG_DATE, "%Y-%m-%d")
start_ts = int((target_dt - timedelta(days=2)).timestamp())
end_ts = int((target_dt + timedelta(days=2, hours=23, minutes=59)).timestamp())


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


def fetch_all_orders():
    """Fetch all orders trong window (mọi nguồn)."""
    all_orders = []
    for page in range(1, 100):
        params = {
            "api_key": API_KEY,
            "page": page,
            "page_size": 100,
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
        if len(batch) < 100:
            break
        time.sleep(0.2)
    return all_orders


def main():
    print(f"\n=== Fetching orders trong window 4d quanh {DEBUG_DATE} ===\n",
          file=sys.stderr)
    orders = fetch_all_orders()
    print(f"[INFO] Total: {len(orders)} orders fetched", file=sys.stderr)

    # Filter orders on DEBUG_DATE
    target_orders = [o for o in orders
                     if (o.get("inserted_at") or "")[:10] == DEBUG_DATE]
    print(f"[INFO] Orders on {DEBUG_DATE}: {len(target_orders)}", file=sys.stderr)

    # Breakdown by order_sources_name
    breakdown = {}   # name -> {orders, revenue, ids}
    for o in target_orders:
        name = (o.get("order_sources_name") or "(none)").strip()
        sid = str(o.get("order_sources") or "?").strip()
        cod = o.get("cod") or o.get("total_price_after_sub_discount") or 0
        try:
            cod = float(cod)
        except (TypeError, ValueError):
            cod = 0
        if name not in breakdown:
            breakdown[name] = {"orders": 0, "revenue": 0.0, "ids": set()}
        breakdown[name]["orders"] += 1
        breakdown[name]["revenue"] += cod
        breakdown[name]["ids"].add(sid)

    # Categorize
    def cat(name):
        n = name.upper()
        if n.startswith("DUY -") or n.startswith("DUY-"):
            return "DUY"
        if n.startswith("PHƯƠNG NAM") or n.startswith("PHUONG NAM"):
            return "PHUONG_NAM"
        if name == "Facebook" or name == "(none)":
            return "FB_OR_NONE"
        return "OTHER"

    cats = {"DUY": [], "PHUONG_NAM": [], "FB_OR_NONE": [], "OTHER": []}
    for name, stat in breakdown.items():
        cats[cat(name)].append((name, stat))

    # Print breakdown
    print(f"\n========== ORDERS ON {DEBUG_DATE} — BREAKDOWN BY SOURCE ==========\n")
    for cat_label, cat_key in [
        ("DUY (nguồn tên 'DUY -')", "DUY"),
        ("PHƯƠNG NAM (nguồn tên 'PHƯƠNG NAM -')", "PHUONG_NAM"),
        ("Facebook generic / no source", "FB_OR_NONE"),
        ("OTHER (Hotline, Shopee, manual,...)", "OTHER"),
    ]:
        items = sorted(cats[cat_key], key=lambda x: x[1]["orders"], reverse=True)
        total_orders = sum(s["orders"] for _, s in items)
        total_rev = sum(s["revenue"] for _, s in items)
        print(f"--- {cat_label} ({total_orders} đơn, {total_rev:,.0f} VND) ---")
        if not items:
            print("  (0 đơn)\n")
            continue
        print(f"  {'Source name':<45} | {'Orders':>6} | {'Revenue (VND)':>15} | Source IDs")
        print("  " + "-" * 95)
        for name, stat in items:
            ids = ",".join(sorted(stat["ids"]))
            print(f"  {name:<45} | {stat['orders']:>6} | {stat['revenue']:>15,.0f} | {ids}")
        print()

    # Summary tổng
    total_all = len(target_orders)
    total_rev_all = sum(s["revenue"] for s in breakdown.values())
    duy_orders = sum(s["orders"] for _, s in cats["DUY"])
    duy_rev = sum(s["revenue"] for _, s in cats["DUY"])
    pn_orders = sum(s["orders"] for _, s in cats["PHUONG_NAM"])
    pn_rev = sum(s["revenue"] for _, s in cats["PHUONG_NAM"])

    print(f"\n========== SUMMARY ngày {DEBUG_DATE} ==========")
    print(f"  TỔNG: {total_all} đơn | {total_rev_all:,.0f} VND")
    print(f"  DUY (theo prefix): {duy_orders} đơn | {duy_rev:,.0f} VND")
    print(f"  PHƯƠNG NAM (theo prefix): {pn_orders} đơn | {pn_rev:,.0f} VND")
    print(f"  DUY+PN: {duy_orders+pn_orders} đơn | {duy_rev+pn_rev:,.0f} VND")


if __name__ == "__main__":
    main()

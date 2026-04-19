#!/usr/bin/env python3
"""
Fetch revenue data from Pancake POS API and aggregate by product × source group.

Output: data/product-revenue.json

Logic:
- Fetch 5 source groups: DUY, PHƯƠNG NAM, Website, Zalo OA, Hotline
- DUY + PHƯƠNG NAM: via saved_filters_id (UUID)
- Website / Zalo OA / Hotline: via explicit order_sources[] IDs
- Range: 90 ngày gần nhất
- Revenue per item: variation_info.retail_price × quantity (Pancake giá thật, đã tính discount)
- Breakdown theo status: delivered (3), returning (4), returned (5), canceled (6), other
- Aggregate per product × date × source cho 6 sản phẩm chính
"""

import os
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import urllib.request
import urllib.error
from collections import Counter

# ── Config ─────────────────────────────────────────────
API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE_URL = "https://pos.pancake.vn/api/v1"
LOOKBACK_DAYS = 90

# ── 5 SOURCE GROUPS — captured từ Pancake UI ───────────────────────
# Mỗi nhóm được fetch riêng và aggregate thành 1 bucket trong output.
# "filter_id" = saved filter UUID (POST kèm saved_filters_id).
# "sources"   = list order_sources[] payload để POST cùng (hoặc chỉ 1 ID).
# Nếu chỉ có filter_id mà không có sources → dùng saved filter nguyên gốc.
# Nếu chỉ có sources mà không có filter_id → dùng raw source IDs.

SOURCE_GROUPS = [
    {
        "key": "DUY",
        "label": "DUY",
        "filter_id": "8350fe1d-fd9b-41d8-bb3a-f075a5e94df5",
        "sources": [
            '["308004272"]', '["1536003777"]', '["615005571"]', '["308003603"]',
            '["922003735"]', '["1843001674"]', '["922002510"]', '["1843000628"]',
            '["307500561"]', '["921500725"]', '["921041344"]', '["307040304"]',
            '["39739"]', '["614046174"]', '["1842044041"]', '["307039298"]',
            '["1842043463"]', '["1228044436"]', '["614044869"]', '["921041902"]',
            '["1535037303"]', '["1228042142"]', '["1535038664"]',
            '["-1","842243695641184"]',
        ],
    },
    {
        "key": "PHUONG_NAM",
        "label": "PHƯƠNG NAM",
        "filter_id": "78a874c7-0601-4416-a377-481dce360b87",
        "sources": [
            '["1008799"]', '["1536008673"]', '["1229011407"]',
        ],
    },
    {
        "key": "WEBSITE",
        "label": "Website",
        "filter_id": None,  # sub-nhóm của Website saved filter, fetch bằng raw source ID
        "sources": ['["921043352"]'],
    },
    {
        "key": "ZALO_OA",
        "label": "Zalo OA",
        "filter_id": None,
        "sources": ['["37931"]'],
    },
    {
        "key": "HOTLINE",
        "label": "Hotline",
        "filter_id": None,
        "sources": ['["614042808"]'],
    },
]

# Pancake status codes
# 0=mới, 1=đã duyệt, 2=đã shipped, 3=đã giao, 4=đang hoàn, 5=đã hoàn, 6=đã hủy, 8=đang đóng, 9=pending
STATUS_DELIVERED = 3
STATUS_RETURNING = 4
STATUS_RETURNED  = 5
STATUS_CANCELED  = 6

# Product mapping (case-insensitive key)
# Mỗi mapping = list các (product, qty_per_unit). Giá lấy từ retail_price thật của Pancake,
# mapping chỉ cần biết 1 combo = mấy máy nào.
PRODUCT_MAPPING = {
    # Đơn lẻ
    "d1":         [("D1",        1)],
    "dr1 new":    [("DR1",       1)],
    "noma 911":   [("Noma 911",  1)],
    "noma 922":   [("Noma 922",  1)],
    "da8.1":      [("DA8.1",     1)],
    "da8.1 pro":  [("DA8.1 Pro", 1)],
    # Combo máy + thẻ nhớ
    "combo-058":  [("DA8.1",     1)],  # DA8.1 + 64GB
    "combo-059":  [("DA8.1",     1)],  # DA8.1 + 128GB
    "combo-060":  [("DA8.1 Pro", 1)],  # DA8.1 Pro + 64GB
    "combo-061":  [("DA8.1 Pro", 1)],  # DA8.1 Pro + 128GB
    # Combo Noma
    "combo-092":  [("Noma 911",  2)],           # 2 chai Noma 911
    "combo-103":  [("Noma 911",  1), ("Noma 922", 1)],  # Noma 911 + Noma 922
}

PRODUCT_LIST = ["D1", "DR1", "Noma 911", "Noma 922", "DA8.1", "DA8.1 Pro"]


def fetch_orders(group, page=1, page_size=100, start_date=None, end_date=None, max_retries=4):
    """Fetch 1 page đơn từ Pancake cho 1 source group."""
    params = [
        ("api_key", API_KEY),
        ("page", page),
        ("page_size", page_size),
        ("status", -1),
        ("updateStatus", "inserted_at"),
        ("option_sort", "inserted_at_desc"),
        ("es_only", "true"),
        ("is_filter_multiple_source", "true"),
    ]
    if group.get("filter_id"):
        params.append(("saved_filters_id", group["filter_id"]))
    if start_date:
        params.append(("startDateTime", int(start_date.timestamp())))
    if end_date:
        params.append(("endDateTime", int(end_date.timestamp())))
    for s in group.get("sources", []):
        params.append(("order_sources[]", s))

    url = f"{BASE_URL}/shops/{SHOP_ID}/orders/get_orders?{urlencode(params)}"

    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:200]
            print(f"[WARN] group={group['key']} HTTP {e.code} page={page} attempt={attempt}: {body}", file=sys.stderr)
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries:
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception as e:
            print(f"[WARN] group={group['key']} {type(e).__name__} page={page} attempt={attempt}: {e}", file=sys.stderr)
            if attempt < max_retries:
                time.sleep(2 ** attempt)
                continue
            return None
    return None


def fetch_all_orders_for_group(group, start_dt, end_dt):
    """Fetch tất cả orders của 1 source group trong date range."""
    all_orders = []
    page = 1
    consecutive_fails = 0
    while True:
        data = fetch_orders(group, page=page, page_size=100, start_date=start_dt, end_date=end_dt)
        if data is None:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print(f"[WARN] group={group['key']}: 3 pages fail liên tiếp, dừng fetch", file=sys.stderr)
                break
            page += 1
            time.sleep(3)
            continue
        consecutive_fails = 0
        batch = data.get("data") or data.get("orders") or []
        if not batch:
            break
        all_orders.extend(batch)
        print(f"[INFO] group={group['key']} page {page}: {len(batch)} đơn (tổng {len(all_orders)})")
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.3)
        if page > 200:
            print(f"[WARN] group={group['key']}: Hit 200-page safety cap", file=sys.stderr)
            break
    return all_orders


def extract_items(order):
    """Return list of (code, quantity, retail_price) from line items."""
    items = []
    for li in (order.get("items") or order.get("order_items") or []):
        vi = li.get("variation_info") or {}
        prod = li.get("product") or {}
        code = (
            vi.get("display_id")
            or prod.get("display_id")
            or li.get("display_id")
        )
        qty = int(li.get("quantity", 1) or 1)
        price = int(vi.get("retail_price") or 0)
        if code:
            items.append((str(code).strip(), qty, price))
    return items


def empty_bucket():
    return {
        p: {
            "total": 0,
            "orders": 0,
            "units": 0,
            "by_date": {},          # {date: revenue}
            "orders_by_date": {},   # {date: orders_count}  ← mới, để UI lọc số đơn theo dateRange
        }
        for p in PRODUCT_LIST
    }


def merge_buckets(*bucket_dicts):
    """Gộp nhiều per-product bucket dict thành 1 (cộng dồn total/orders/units/by_date/orders_by_date)."""
    result = empty_bucket()
    for bucket in bucket_dicts:
        for p in PRODUCT_LIST:
            src = bucket[p]
            dst = result[p]
            dst["total"]  += src["total"]
            dst["orders"] += src["orders"]
            dst["units"]  += src["units"]
            for date, amount in src["by_date"].items():
                dst["by_date"][date] = dst["by_date"].get(date, 0) + amount
            for date, cnt in (src.get("orders_by_date") or {}).items():
                dst["orders_by_date"][date] = dst["orders_by_date"].get(date, 0) + cnt
    return result


def aggregate(orders):
    """Aggregate orders vào 5 bucket theo status Pancake.

    Returns:
        buckets                         — {status_key: per_product_bucket}
        summary                         — {status_key: {orders, total}}
        total_orders                    — int tổng số đơn raw
        total_orders_by_date            — {date: orders_count} cấp nhóm (tất cả status)
        order_revenue_by_status_by_date — {status_key: {date: revenue}} cấp nhóm.
            MỚI: tổng `total_price_after_sub_discount` của đơn — KHÔNG phụ thuộc 6 SP chính.
            Dùng để tính "doanh thu tổng thực thu" khớp với Pancake aggs (cod+prepaid).
    """
    buckets = {
        "delivered": empty_bucket(),   # 3 — Đã giao
        "returning": empty_bucket(),   # 4 — Đang hoàn
        "returned":  empty_bucket(),   # 5 — Đã hoàn
        "canceled":  empty_bucket(),   # 6 — Đã hủy
        "other":     empty_bucket(),   # 0/1/2/8/9 — Đang xử lý
    }
    summary = {k: {"orders": 0, "total": 0} for k in buckets.keys()}
    total_orders = 0
    total_orders_by_date = {}  # date → số đơn bất kể status, để UI lọc theo dateRange
    # MỚI: {status: {date: tổng total_price_after_sub_discount}} — doanh thu THỰC THU theo đơn
    # (không bó hẹp 6 SP chính). Dùng cho box Staff / Source "Doanh thu tổng".
    order_revenue_by_status_by_date = {k: {} for k in buckets.keys()}
    # MỚI: {status: {date: orders_count}} — số đơn THEO STATUS theo ngày.
    # Dùng cho UI "chưa tính hoàn hủy" (loại status `returned` + `canceled`).
    order_count_by_status_by_date = {k: {} for k in buckets.keys()}

    for o in orders:
        total_orders += 1
        status = o.get("status")
        if status == STATUS_DELIVERED:
            bucket_key = "delivered"
        elif status == STATUS_RETURNING:
            bucket_key = "returning"
        elif status == STATUS_RETURNED:
            bucket_key = "returned"
        elif status == STATUS_CANCELED:
            bucket_key = "canceled"
        else:
            bucket_key = "other"

        bucket = buckets[bucket_key]
        # Order total thực (Pancake) — đã trừ discount cấp đơn
        order_total = int(o.get("total_price_after_sub_discount") or o.get("total_price") or 0)
        summary[bucket_key]["orders"] += 1
        summary[bucket_key]["total"] += order_total

        inserted_at = o.get("inserted_at") or o.get("created_at") or ""
        date = inserted_at[:10] if inserted_at else "unknown"
        total_orders_by_date[date] = total_orders_by_date.get(date, 0) + 1
        # Gộp doanh thu + số đơn vào status+date map
        order_revenue_by_status_by_date[bucket_key][date] = \
            order_revenue_by_status_by_date[bucket_key].get(date, 0) + order_total
        order_count_by_status_by_date[bucket_key][date] = \
            order_count_by_status_by_date[bucket_key].get(date, 0) + 1

        products_in_order = set()
        for code, qty, retail_price in extract_items(o):
            mapping = PRODUCT_MAPPING.get(code.lower())
            if not mapping:
                continue
            # Nếu combo có N sản phẩm + thẻ nhớ, retail_price là của cả combo.
            # Chia đều cho số sản phẩm (thường combo = máy + phụ kiện, máy chiếm >90% giá)
            # → Đơn giản: revenue per_unit = retail_price (toàn bộ giá combo gán cho sản phẩm chính đầu tiên trong mapping)
            # Với non-combo thì mapping có 1 entry nên dùng nguyên retail_price.
            for idx, (product, qty_per_unit) in enumerate(mapping):
                total_units = qty_per_unit * qty
                # Chỉ entry đầu tiên nhận full revenue; entry sau = 0 (để không double count giá combo)
                revenue = retail_price * qty if idx == 0 else 0
                bucket[product]["total"] += revenue
                bucket[product]["units"] += total_units
                bucket[product]["by_date"][date] = bucket[product]["by_date"].get(date, 0) + revenue
                products_in_order.add(product)

        # Đếm orders per product (tổng) + orders per product PER DATE (mới)
        for p in products_in_order:
            bucket[p]["orders"] += 1
            bucket[p]["orders_by_date"][date] = bucket[p]["orders_by_date"].get(date, 0) + 1

    return (buckets, summary, total_orders, total_orders_by_date,
            order_revenue_by_status_by_date, order_count_by_status_by_date)


def main():
    if not API_KEY or not SHOP_ID:
        print("[FATAL] Missing PANCAKE_API_KEY or PANCAKE_SHOP_ID", file=sys.stderr)
        sys.exit(1)

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=LOOKBACK_DAYS)

    print(f"[INFO] Fetching Pancake orders {start_dt.date()} → {end_dt.date()} ({LOOKBACK_DAYS}d)")
    print(f"[INFO] Source groups: {[g['label'] for g in SOURCE_GROUPS]}\n")

    # Per-group aggregates
    per_group = {}
    grand_total_orders = 0
    all_orders_combined = []

    for group in SOURCE_GROUPS:
        key = group["key"]
        label = group["label"]
        print(f"─── [{label}] ───────────────────────────────────")
        orders = fetch_all_orders_for_group(group, start_dt, end_dt)
        print(f"[INFO] group={key}: fetched {len(orders)} đơn")

        status_counter = Counter(o.get("status") for o in orders)
        print(f"[DEBUG] {key} status: {dict(status_counter.most_common())}")

        (buckets, summary, group_total, group_orders_by_date,
         group_order_rev_by_status, group_order_count_by_status) = aggregate(orders)
        products_all = merge_buckets(*buckets.values())

        print(f"[RESULT] {label}: {group_total} đơn")
        for st in ("delivered", "returning", "returned", "canceled", "other"):
            s = summary[st]
            print(f"  {st:10s}: {s['orders']:>5} đơn · {s['total']:>15,}đ")
        print(f"  Doanh thu / sản phẩm ({label}):")
        for p in PRODUCT_LIST:
            d = products_all[p]
            print(f"    {p:12s} | {d['total']:>15,}đ | {d['orders']:>4} đơn | {d['units']:>4} sp")
        print()

        per_group[key] = {
            "label": label,
            "total_orders": group_total,
            # MỚI: đơn theo ngày ở cấp nhóm, để UI lọc "tổng đơn của nhân sự" theo dateRange.
            "total_orders_by_date": group_orders_by_date,
            # MỚI: tổng doanh thu THỰC THU (total_price_after_sub_discount) per status per date.
            # Dùng cho box Staff/Source "doanh thu tổng" (khớp Pancake aggs), KHÔNG bó 6 SP chính.
            "order_revenue_by_status_by_date": group_order_rev_by_status,
            # MỚI: số đơn per status per date — để UI tính "số đơn chưa tính hoàn hủy"
            "order_count_by_status_by_date": group_order_count_by_status,
            "summary": summary,
            "products": products_all,
            "products_by_status": buckets,
        }
        grand_total_orders += group_total
        all_orders_combined.extend(orders)

    # ── Aggregate tổng hợp (all 5 groups combined) — giữ backward-compat với dashboard cũ ──
    print("─── [TỔNG HỢP 5 NHÓM] ───────────────────────────")
    (total_buckets, total_summary, total_count, total_orders_by_date,
     total_order_rev_by_status, total_order_count_by_status) = aggregate(all_orders_combined)
    total_products = merge_buckets(*total_buckets.values())
    print(f"[RESULT] Tổng 5 nhóm: {total_count} đơn")
    for st in ("delivered", "returning", "returned", "canceled", "other"):
        s = total_summary[st]
        print(f"  {st:10s}: {s['orders']:>5} đơn · {s['total']:>15,}đ")
    print("  Doanh thu / sản phẩm (tổng):")
    for p in PRODUCT_LIST:
        d = total_products[p]
        print(f"    {p:12s} | {d['total']:>15,}đ | {d['orders']:>4} đơn | {d['units']:>4} sp")

    output = {
        "generated_at": end_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "window_days": LOOKBACK_DAYS,
        "total_orders": total_count,
        # MỚI: tổng đơn theo ngày (tất cả 5 nhóm)
        "total_orders_by_date": total_orders_by_date,
        # MỚI: doanh thu THỰC THU per status per date (top-level, gộp 5 nguồn)
        "order_revenue_by_status_by_date": total_order_rev_by_status,
        # MỚI: số đơn per status per date (top-level, gộp 5 nguồn)
        "order_count_by_status_by_date": total_order_count_by_status,
        # Giữ format cũ cho các chỗ dashboard đang dùng (`summary`, `products`, `products_by_status`)
        "summary": total_summary,
        "products": total_products,
        "products_by_status": total_buckets,
        # MỚI: per-source breakdown
        "source_groups_order": [g["key"] for g in SOURCE_GROUPS],
        "source_groups": per_group,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "product-revenue.json")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n[INFO] Wrote {out_path}")


if __name__ == "__main__":
    main()
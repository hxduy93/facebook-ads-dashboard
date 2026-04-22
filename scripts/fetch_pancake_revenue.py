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

# Product mapping (case-insensitive key by `variation_info.id` từ Pancake).
# Mỗi mapping = list các (product, qty_per_unit). Giá lấy từ retail_price thật của Pancake,
# mapping chỉ cần biết 1 combo = mấy máy nào.
#
# Mở rộng từ 6 → 13 SP chính (2026-04-19) sau khi inspect Pancake thấy nhiều đơn Website
# bán máy dò D1 Pro/D2/D3/D4/D8 Pro, ghi âm DR4 Plus, định vị DV1 Pro — không match list cũ.
PRODUCT_MAPPING = {
    # ── Máy dò ──
    "d1":         [("D1",         1)],
    "d1 pro":     [("D1 Pro",     1)],
    "d2":         [("D2",         1)],
    "d3":         [("D3",         1)],
    "d4":         [("D4",         1)],
    "d8 pro":     [("D8 Pro",     1)],
    # ── Camera ──
    "da8.1":      [("DA8.1",      1)],
    "da8.1 pro":  [("DA8.1 Pro",  1)],
    # ── Ghi âm ──
    "dr1 new":    [("DR1",        1)],
    "dr1":        [("DR1",        1)],
    "dr4 plus":   [("DR4 Plus",   1)],
    # ── Định vị ──
    "dv1 pro":    [("DV1 Pro",    1)],
    # ── Noma ──
    "noma 911":   [("Noma 911",   1)],
    "noma 922":   [("Noma 922",   1)],
    # ── Combo máy + thẻ nhớ ──
    "combo-058":  [("DA8.1",      1)],  # DA8.1 + 64GB
    "combo-059":  [("DA8.1",      1)],  # DA8.1 + 128GB
    "combo-060":  [("DA8.1 Pro",  1)],  # DA8.1 Pro + 64GB
    "combo-061":  [("DA8.1 Pro",  1)],  # DA8.1 Pro + 128GB
    # ── Combo Noma ──
    "combo-092":  [("Noma 911",   2)],                          # 2 chai Noma 911
    "combo-103":  [("Noma 911",   1), ("Noma 922", 1)],         # 911 + 922
    # ── Combo Định vị (DV2 + Sim) — đếm vào DV1 Pro để có đại diện nhóm Định vị ──
    # (Khi nào user muốn tách DV1/DV2 riêng thì split ra. Hiện chỉ có 1 cột "DV1 Pro")
    "combo-068":  [("DV1 Pro",    1)],
    "combo-096":  [("DV1 Pro",    1)],
}

# Thứ tự cột trong dashboard (từ trái → phải).
# Sắp theo nhóm: Máy dò → Ghi âm → Định vị → Camera → Noma.
PRODUCT_LIST = [
    "D1", "D1 Pro", "D2", "D3", "D4", "D8 Pro",         # Máy dò (6)
    "DR1", "DR4 Plus",                                    # Ghi âm (2)
    "DV1 Pro",                                            # Định vị (1)
    "DA8.1", "DA8.1 Pro",                                 # Camera (2)
    "Noma 911", "Noma 922",                               # Noma (2)
]
# = 13 sản phẩm


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


def _num(v, default=0.0):
    """Parse float an toàn — giữ số lẻ (KHÔNG int-truncate). Dùng để khớp Pancake POS."""
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def order_revenue(order):
    """
    Doanh thu chính xác per order — ưu tiên cột COD trên Pancake POS UI.
    Fallback chain:
      1. cod / cod_amount / total_cod                → đúng cột COD
      2. total_price_after_sub_discount              → tổng đã giảm giá đơn
      3. total_price                                 → tổng chưa giảm
    Trả về float (giữ số lẻ). Fix "doanh thu làm tròn".
    """
    for key in ("cod", "cod_amount", "total_cod",
                "total_price_after_sub_discount", "total_price"):
        v = order.get(key)
        if v is not None and _num(v, 0) > 0:
            return _num(v)
    return 0.0


def extract_items(order):
    """Return list of (code, quantity, line_revenue) from line items.

    SKU code priority (theo phát hiện 2026-04-19):
      1. variation_info.id          ← thật sự chứa SKU code (vd: "D1 Pro", "DR1 New", "COMBO-092")
                                       cho các đơn manual / website / hotline
      2. variation_info.display_id  ← rỗng cho đa số đơn manual, có cho 1 số đơn sàn
      3. product.display_id         ← fallback nếu line không có variation
      4. line.display_id            ← rất rare, fallback cuối

    line_revenue priority (để khớp COD đến số lẻ, KHÔNG int-truncate):
      1. li.total_price_after_sub_discount   — line net revenue (sau chiết khấu dòng)
      2. li.total_price                      — line gross
      3. variation_info.retail_price × qty   — fallback list-price
    """
    items = []
    for li in (order.get("items") or order.get("order_items") or []):
        vi = li.get("variation_info") or {}
        prod = li.get("product") or {}
        code = (
            vi.get("id")
            or vi.get("display_id")
            or prod.get("display_id")
            or li.get("display_id")
        )
        qty = int(_num(li.get("quantity", 1), 1) or 1)

        line_rev = None
        for key in ("total_price_after_sub_discount", "total_price", "price_after_discount"):
            v = li.get(key)
            if v is not None and _num(v, 0) > 0:
                line_rev = _num(v)
                break
        if line_rev is None:
            retail = _num(vi.get("retail_price") or li.get("price") or 0)
            line_rev = retail * qty

        # Lấy thêm name để log unmapped variations (audit SP ngoài PRODUCT_MAPPING)
        name = (vi.get("name") or prod.get("name") or "").strip()
        if code:
            items.append((str(code).strip(), qty, line_rev, name))
    return items


# Dict tích lũy các variation codes KHÔNG có trong PRODUCT_MAPPING (audit mode)
# Format: {code_lower: {"name": str, "count_orders": int, "total_units": int, "total_revenue": float}}
UNMAPPED_VARIATIONS = {}


def empty_bucket():
    return {
        p: {
            "total": 0.0,           # doanh thu FLOAT (giữ số lẻ)
            "orders": 0,
            "units": 0,
            "by_date": {},          # {date: revenue}
            "orders_by_date": {},   # {date: orders_count}
            "units_by_date": {},    # {date: units_count}  ← MỚI cho tính Giá nhập × SL theo range
        }
        for p in PRODUCT_LIST
    }


def merge_buckets(*bucket_dicts):
    """Gộp nhiều per-product bucket dict thành 1 (cộng dồn total/orders/units/by_date/orders_by_date/units_by_date)."""
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
            for date, u in (src.get("units_by_date") or {}).items():
                dst["units_by_date"][date] = dst["units_by_date"].get(date, 0) + u
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
    summary = {k: {"orders": 0, "total": 0.0} for k in buckets.keys()}
    total_orders = 0
    total_orders_by_date = {}  # date → số đơn bất kể status, để UI lọc theo dateRange
    # MỚI: {status: {date: doanh thu}} — dùng COD của đơn (float). Khớp Pancake POS cột COD.
    order_revenue_by_status_by_date = {k: {} for k in buckets.keys()}
    # MỚI: {status: {date: orders_count}} — số đơn THEO STATUS theo ngày.
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
        # Order total — ưu tiên cột COD Pancake (float, không làm tròn)
        order_total = order_revenue(o)
        summary[bucket_key]["orders"] += 1
        summary[bucket_key]["total"] += order_total

        inserted_at = o.get("inserted_at") or o.get("created_at") or ""
        date = inserted_at[:10] if inserted_at else "unknown"
        total_orders_by_date[date] = total_orders_by_date.get(date, 0) + 1
        # Gộp doanh thu + số đơn vào status+date map
        order_revenue_by_status_by_date[bucket_key][date] = \
            order_revenue_by_status_by_date[bucket_key].get(date, 0.0) + order_total
        order_count_by_status_by_date[bucket_key][date] = \
            order_count_by_status_by_date[bucket_key].get(date, 0) + 1

        products_in_order = set()
        for code, qty, line_rev, name in extract_items(o):
            mapping = PRODUCT_MAPPING.get(code.lower())
            if not mapping:
                # AUDIT: log SP ngoài PRODUCT_MAPPING để sau bổ sung
                key = code.lower()
                if key not in UNMAPPED_VARIATIONS:
                    UNMAPPED_VARIATIONS[key] = {
                        "code": code,
                        "name": name,
                        "count_line_items": 0,
                        "total_units": 0,
                        "total_revenue": 0.0,
                    }
                UNMAPPED_VARIATIONS[key]["count_line_items"] += 1
                UNMAPPED_VARIATIONS[key]["total_units"] += qty
                UNMAPPED_VARIATIONS[key]["total_revenue"] += float(line_rev)
                # Cập nhật name nếu entry trước đó chưa có
                if not UNMAPPED_VARIATIONS[key]["name"] and name:
                    UNMAPPED_VARIATIONS[key]["name"] = name
                continue
            # Nếu combo có N sản phẩm + thẻ nhớ, line_rev là của cả combo.
            # Entry đầu tiên trong mapping nhận full revenue; entry sau = 0 (tránh double count).
            for idx, (product, qty_per_unit) in enumerate(mapping):
                total_units = qty_per_unit * qty
                revenue = float(line_rev) if idx == 0 else 0.0
                bucket[product]["total"] += revenue
                bucket[product]["units"] += total_units
                bucket[product]["by_date"][date] = bucket[product]["by_date"].get(date, 0.0) + revenue
                bucket[product]["units_by_date"][date] = (
                    bucket[product]["units_by_date"].get(date, 0) + total_units
                )
                products_in_order.add(product)

        # Đếm orders per product (tổng) + orders per product PER DATE
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
            print(f"  {st:10s}: {s['orders']:>5} đơn · {s['total']:>15,.0f}đ")
        print(f"  Doanh thu / sản phẩm ({label}):")
        for p in PRODUCT_LIST:
            d = products_all[p]
            print(f"    {p:12s} | {d['total']:>15,.2f}đ | {d['orders']:>4} đơn | {d['units']:>4} sp")
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
        print(f"  {st:10s}: {s['orders']:>5} đơn · {s['total']:>15,.0f}đ")
    print("  Doanh thu / sản phẩm (tổng):")
    for p in PRODUCT_LIST:
        d = total_products[p]
        print(f"    {p:12s} | {d['total']:>15,.2f}đ | {d['orders']:>4} đơn | {d['units']:>4} sp")


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

    # AUDIT: Dump UNMAPPED_VARIATIONS ra file để biết SP nào đang bán mà PRODUCT_MAPPING
    # chưa cover. Dashboard bảng Xếp hạng SP chỉ hiển thị đúng khi PRODUCT_MAPPING đủ.
    unmapped_out = os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "data", "pancake-unmapped.json"
    ))
    unmapped_list = sorted(
        UNMAPPED_VARIATIONS.values(),
        key=lambda x: -x.get("total_revenue", 0),
    )
    with open(unmapped_out, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": end_dt.strftime("%Y-%m-%d %H:%M UTC"),
            "window_days": LOOKBACK_DAYS,
            "note": (
                "Danh sach variation codes xuat hien trong don Pancake nhung KHONG "
                "co trong PRODUCT_MAPPING (scripts/fetch_pancake_revenue.py). Can bo "
                "sung vao PRODUCT_MAPPING + PRODUCT_LIST de dashboard bang Xep hang "
                "SP hien du revenue per-product."
            ),
            "unmapped_count": len(unmapped_list),
            "total_unmapped_revenue": round(sum(x["total_revenue"] for x in unmapped_list), 0),
            "unmapped_variations": unmapped_list,
        }, f, ensure_ascii=False, indent=2)
    print(f"[INFO] Wrote {unmapped_out}")
    print(f"       {len(unmapped_list)} unmapped variations · "
          f"total revenue {sum(x['total_revenue'] for x in unmapped_list)/1e6:.1f}tr")
    if unmapped_list:
        print(f"       Top 10 unmapped by revenue:")
        for u in unmapped_list[:10]:
            print(f"         [{u['total_revenue']/1e6:>6.1f}tr · {u['total_units']:>3} units] "
                  f"{u['code'][:40]:40s}  {u['name'][:50]}")


if __name__ == "__main__":
    main()
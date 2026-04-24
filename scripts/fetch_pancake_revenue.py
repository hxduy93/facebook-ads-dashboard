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
import re
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import urllib.request
import urllib.error
from collections import Counter


# ── Phân loại sản phẩm Doscom vào 9 nhóm chuẩn (2026-04-23 v2) ───────────
# 1. MAY_DO            — D1-D9 (máy dò nghe lén / máy dò kim loại)
# 2. CAMERA_WIFI       — DA* có "wifi" / các mã DA wifi (DA3.x, DA4, DA5, DA7, DA9...)
# 3. CAMERA_4G         — DA* có "4g"/"sim"/"nlmt" / các mã DA 4G (DA1 4G, DA2.x, DA5.1, DA6.x...)
# 4. CAMERA_VIDEO_CALL — DA8.1 và DA8.1 Pro (camera gọi video 2 chiều)
# 5. GHI_AM            — DR* (máy ghi âm)
# 6. CHONG_GHI_AM      — DI* (thiết bị chống ghi âm)
# 7. DINH_VI           — DV*, DT*, Air Tag (gồm định vị có SIM + thẻ định vị)
# 8. NOMA              — Noma*, A002, combo Noma, khăn lau, chà kính, bảo vệ lốp
# 9. OTHER             — Các SP khác (sim, thẻ nhớ, pin, phụ kiện...)

CATEGORY_ORDER = [
    ("MAY_DO",            "Máy dò"),
    ("CAMERA_WIFI",       "Camera wifi"),
    ("CAMERA_4G",         "Camera 4G"),
    ("CAMERA_VIDEO_CALL", "Camera gọi video 2 chiều"),
    ("GHI_AM",            "Máy ghi âm"),
    ("CHONG_GHI_AM",      "Chống ghi âm"),
    ("DINH_VI",           "Định vị"),
    ("NOMA",              "NOMA"),
    ("OTHER",             "Khác"),
]
CATEGORY_LABELS = dict(CATEGORY_ORDER)

# Mã DA hardcoded theo CLAUDE.md (fallback khi tên variation không có keyword rõ)
DA_WIFI_CODES = {
    "da1 pro wifi", "da3.1", "da3.1 pro", "da3.2", "da3.3", "da4",
    "da3 pro zoom", "da5", "da6.1 wifi", "da7", "da7.1", "da9",
}
DA_4G_CODES = {
    "da1 pro 4g", "da1 pro zoom", "da2.1", "da2.4", "da3 pro 4g",
    "da5.1", "da5.1 pro", "da6", "da6 pro", "da6.1 4g", "da6.2",
}


def classify_sku(name):
    """Phân 1 tên variation sản phẩm POS vào 1 trong 9 nhóm.

    Quy tắc ưu tiên từ trên xuống:
      1. Noma / A002 / phụ kiện Noma (chà kính, bảo vệ lốp, khăn lau...)
      2. DA8.1 / DA8.1 Pro → Camera gọi video 2 chiều
      3. DA* có keyword "4G", "Sim", "NLMT" → Camera 4G
      4. DA* có keyword "Wifi", "không dây" → Camera wifi
      5. DA* còn lại → tra bảng cứng DA_WIFI_CODES / DA_4G_CODES
      6. DR* → Ghi âm
      7. DI* → Chống ghi âm
      8. DV*, DT*, Air Tag → Định vị
      9. D1-D9 (không thuộc DA/DR/DI/DV/DT/DE) → Máy dò
      10. Còn lại → OTHER
    """
    if not name:
        return "OTHER"
    n = name.lower().strip()

    # 1. Noma + phụ kiện chăm sóc xe
    if ("noma" in n or "a002" in n or "chà kính" in n or "chat kinh" in n
            or "bảo vệ lốp" in n or "bao ve lop" in n or "tẩy ố" in n or "tay o" in n
            or "microfiber" in n or "khăn lau" in n or "khan lau" in n):
        return "NOMA"

    # 2. Camera gọi video 2 chiều — DA8.1 ưu tiên trước DA chung
    if re.search(r"\bda\s*8\.1", n):
        return "CAMERA_VIDEO_CALL"

    # 3-5. Camera DA*
    if re.search(r"\bda\s*\d", n):
        # Tín hiệu 4G: từ "4g", "nlmt", hoặc "sim" (trừ "thẻ nhớ")
        name_no_storage = n.replace("thẻ nhớ", "").replace("the nho", "")
        if ("4g" in n or "nlmt" in n or "năng lượng mặt trời" in n
                or "sim" in name_no_storage or "vstarcam" in n):
            return "CAMERA_4G"
        if "wifi" in n or "không dây" in n or "khong day" in n:
            return "CAMERA_WIFI"
        # Fallback: tra bảng cứng
        for code in DA_4G_CODES:
            if code in n:
                return "CAMERA_4G"
        for code in DA_WIFI_CODES:
            if code in n:
                return "CAMERA_WIFI"
        return "CAMERA_WIFI"  # Default cho DA không rõ

    # 6. Máy ghi âm
    if re.search(r"\bdr\s*\d", n) or "máy ghi âm" in n or "may ghi am" in n:
        return "GHI_AM"

    # 7. Chống ghi âm
    if re.search(r"\bdi\s*\d", n):
        return "CHONG_GHI_AM"

    # 8. Định vị
    if (re.search(r"\bdv\s*\d", n) or re.search(r"\bdt\s*\d", n)
            or "air tag" in n or "định vị" in n or "dinh vi" in n or "doscom tag" in n):
        return "DINH_VI"

    # 9. Máy dò — D1-D9 (không phải các prefix ở trên)
    if re.match(r"^d\s*\d", n) or "máy dò" in n or "may do" in n:
        return "MAY_DO"

    return "OTHER"


def classify_campaign(name):
    """Phân 1 tên chiến dịch Google Ads vào 1 trong 9 nhóm.

    Tên chiến dịch Doscom đặt theo quy ước (22 chiến dịch hiện tại):
      - "Search - Cam WIFI" / "RMK - Camera wifi" / "Cam mini"  → Camera wifi
      - "Search - Cam NLMT" / "Search - Sim 4G" / "RMK - Camera 4G" / "RMK - NLMT" → Camera 4G
      - "RMK - Camera Gọi 2 chiều"  → Camera video call
      - "Search - TB Dò Nghe Lén" / "RMK - Máy dò" → Máy dò
      - "Search - TB Ghi Âm" / "RMK - thiết bị ghi âm" → Ghi âm
      - "Search - TB Chống Ghi Âm" / "RMK - chống ghi âm" → Chống ghi âm
      - "Search - TBĐV GPS" / "RMK - thiết bị định vị" / "Shopping - ĐV" → Định vị
      - Còn lại (Máy cạo râu, Máy massage, Shopping gia dụng...) → Khác
    """
    if not name:
        return "OTHER"
    n = name.lower()

    # Camera gọi 2 chiều (ưu tiên trước camera chung)
    if "gọi 2 chiều" in n or "goi 2 chieu" in n or "2 chiều" in n:
        return "CAMERA_VIDEO_CALL"

    # Camera 4G - NLMT / Sim 4G / Camera 4G
    if "4g" in n or "nlmt" in n or "năng lượng" in n:
        return "CAMERA_4G"

    # Camera wifi - bao gồm "cam mini", "camera wifi"
    if "wifi" in n or "cam mini" in n or "camera mini" in n:
        return "CAMERA_WIFI"

    # Chống ghi âm (check trước ghi âm)
    if "chống ghi âm" in n or "chong ghi am" in n:
        return "CHONG_GHI_AM"

    # Máy ghi âm
    if "ghi âm" in n or "ghi am" in n:
        return "GHI_AM"

    # Máy dò
    if "dò nghe lén" in n or "do nghe len" in n or "máy dò" in n or "may do" in n or "tb dò" in n:
        return "MAY_DO"

    # Định vị - GPS, TBĐV, thiết bị định vị, ĐV
    if ("định vị" in n or "dinh vi" in n or "tbđv" in n or "tbdv" in n
            or "gps" in n or "- đv" in n or "-đv" in n or " đv" in n.replace("máy", "")):
        return "DINH_VI"

    # Noma (nếu có)
    if "noma" in n:
        return "NOMA"

    return "OTHER"

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


# ── 9 period chuẩn khớp UI (today/yesterday/this_week/last_week/this_month/last_month/last_7d/last_30d/last_90d) ──
PERIOD_LABELS_9 = {
    "today":      "Hôm nay",
    "yesterday":  "Hôm qua",
    "this_week":  "Tuần này",
    "last_week":  "Tuần trước",
    "this_month": "Tháng này",
    "last_month": "Tháng trước",
    "last_7d":    "7 ngày qua",
    "last_30d":   "30 ngày qua",
    "last_90d":   "90 ngày qua",
}


def _compute_period_dates_9(today_vn):
    """Tính date_range cho 9 period, theo ngày VN."""
    y = today_vn - timedelta(days=1)
    # Tuần này: Monday → today_vn (Mon=0, Sun=6)
    wd = today_vn.weekday()
    mon_this = today_vn - timedelta(days=wd)
    # Tuần trước: Monday tuần trước → Sunday tuần trước
    mon_last = mon_this - timedelta(days=7)
    sun_last = mon_this - timedelta(days=1)
    # Tháng này + tháng trước
    first_this_month = today_vn.replace(day=1)
    last_prev_month_day = first_this_month - timedelta(days=1)
    first_prev_month = last_prev_month_day.replace(day=1)
    return {
        "today":      (today_vn.isoformat(),        today_vn.isoformat()),
        "yesterday":  (y.isoformat(),                y.isoformat()),
        "this_week":  (mon_this.isoformat(),         today_vn.isoformat()),
        "last_week":  (mon_last.isoformat(),         sun_last.isoformat()),
        "this_month": (first_this_month.isoformat(), today_vn.isoformat()),
        "last_month": (first_prev_month.isoformat(), last_prev_month_day.isoformat()),
        "last_7d":    ((y - timedelta(days=6)).isoformat(),  y.isoformat()),
        "last_30d":   ((y - timedelta(days=29)).isoformat(), y.isoformat()),
        "last_90d":   ((y - timedelta(days=89)).isoformat(), y.isoformat()),
    }


# ── Build top products from raw orders (3 nguồn Website+Zalo+Hotline, tất cả SKU) ──
# Khác với `products` aggregate bị giới hạn bởi PRODUCT_MAPPING (13 SP) — function này
# gom TẤT CẢ variation.name xuất hiện trong đơn, cho 5 period chuẩn (yesterday/7d/tháng
# này/30d/90d) tính theo ngày VN. Dùng để hiển thị bảng "Top sản phẩm trong kỳ" chính
# xác 100% với POS, không silent-drop SP như DT2/DV1 mini/DR8/A002/...
def build_top_products_website_by_period(orders_list, today_vn, top_n=10):
    """Aggregate top products cho 3 nguồn Web+Zalo+Hotline theo 5 period (ngày VN).

    Logic (2026-04-24 update): LẤY TẤT CẢ ĐƠN (không loại trừ hoàn/huỷ/đang gửi).
    User request: "Lấy doanh thu của toàn bộ các đơn hàng, cột trạng thái không cần đắn đo.
    Bộ lọc website trên trình duyệt có bao nhiêu đơn thì lấy hết. Hoàn huỷ là của bộ phận khác."

    orders_list: list of orders đã fetch từ 3 nguồn Website+ZaloOA+Hotline
    today_vn: date object giờ VN
    top_n: số SP tối đa trả về mỗi period (default 10)
    """
    INCLUDE_ST = None   # None = không filter, lấy tất cả status
    EXCLUDE_ST = set()  # Không exclude gì

    periods = _compute_period_dates_9(today_vn)
    labels = PERIOD_LABELS_9

    # Pre-compute VN date cho mỗi đơn (parse 1 lần, reuse cho 9 period)
    orders_with_vn_date = []
    for o in orders_list:
        # 2026-04-24: KHÔNG filter status — lấy tất cả đơn
        ins_str = (o.get("inserted_at") or "")[:26]
        if not ins_str:
            continue
        try:
            dt_utc = datetime.fromisoformat(ins_str).replace(tzinfo=timezone.utc)
        except Exception:
            continue
        vn_date = (dt_utc + timedelta(hours=7)).date().isoformat()
        orders_with_vn_date.append((vn_date, o))

    result = {}
    for pk, (pstart, pend) in periods.items():
        prod_agg = {}   # name -> {revenue, units, order_ids(set)}
        order_ids_in_period = set()
        total_rev = 0.0

        for vn_date, o in orders_with_vn_date:
            if not (pstart <= vn_date <= pend):
                continue
            order_id = o.get("id")
            order_ids_in_period.add(order_id)
            total_rev += order_revenue(o)

            for li in (o.get("items") or []):
                vi = li.get("variation_info") or {}
                prod = li.get("product") or {}
                # Ưu tiên name (dễ đọc), fallback id/display_id nếu name rỗng
                name = (vi.get("name") or prod.get("name") or "").strip()
                if not name:
                    code = vi.get("id") or li.get("display_id") or ""
                    name = str(code).strip()
                if not name:
                    continue
                qty = int(_num(li.get("quantity", 1), 1) or 1)

                line_rev = 0.0
                for key in ("total_price_after_sub_discount", "total_price"):
                    v = li.get(key)
                    if v is not None and _num(v, 0) > 0:
                        line_rev = _num(v)
                        break
                if line_rev == 0.0:
                    retail = _num(vi.get("retail_price") or li.get("price") or 0)
                    line_rev = retail * qty

                if name not in prod_agg:
                    prod_agg[name] = {"revenue": 0.0, "units": 0, "order_ids": set()}
                prod_agg[name]["revenue"] += line_rev
                prod_agg[name]["units"] += qty
                prod_agg[name]["order_ids"].add(order_id)

        items = [
            {
                "product": n,
                "revenue": round(a["revenue"]),
                "orders":  len(a["order_ids"]),
                "units":   a["units"],
            }
            for n, a in prod_agg.items()
        ]
        items.sort(key=lambda x: x["revenue"], reverse=True)

        result[pk] = {
            "label":        labels[pk],
            "date_range":   {"start": pstart, "end": pend},
            "total_revenue": round(total_rev),
            "total_orders":  len(order_ids_in_period),
            "top_products":  items[:top_n],
        }
    return result


# ── Build category breakdown per period (3 nguồn Web+Zalo+Hotline, 9 nhóm chuẩn) ─
def build_category_breakdown_by_period(orders_list, today_vn):
    """Aggregate doanh thu theo 9 nhóm sản phẩm cho 5 period.

    Logic (2026-04-24 update): LẤY TẤT CẢ ĐƠN (không loại trừ hoàn/huỷ/đang gửi).
    User request: bộ phận khác xử lý hoàn huỷ, phân tích quảng cáo cần doanh thu tổng.

    Return:
      {period_key: {
         "label", "date_range", "total_revenue", "total_orders",
         "categories": { "MAY_DO": {revenue, orders, units, top_products}, ... }
      }}
    """
    # 2026-04-24: KHÔNG filter status
    INCLUDE_ST = None
    EXCLUDE_ST = set()

    periods = _compute_period_dates_9(today_vn)
    labels = PERIOD_LABELS_9

    # Pre-compute VN date + classify cho mỗi order/item
    processed = []  # list of (vn_date, order_id, order_items_with_category)
    for o in orders_list:
        # 2026-04-24: KHÔNG filter status — lấy tất cả đơn
        ins_str = (o.get("inserted_at") or "")[:26]
        if not ins_str:
            continue
        try:
            dt_utc = datetime.fromisoformat(ins_str).replace(tzinfo=timezone.utc)
        except Exception:
            continue
        vn_date = (dt_utc + timedelta(hours=7)).date().isoformat()
        order_id = o.get("id")

        items_classified = []
        for li in (o.get("items") or []):
            vi = li.get("variation_info") or {}
            prod = li.get("product") or {}
            name = (vi.get("name") or prod.get("name") or "").strip()
            if not name:
                code = vi.get("id") or li.get("display_id") or ""
                name = str(code).strip()
            if not name:
                continue

            qty = int(_num(li.get("quantity", 1), 1) or 1)
            line_rev = 0.0
            for key in ("total_price_after_sub_discount", "total_price"):
                v = li.get(key)
                if v is not None and _num(v, 0) > 0:
                    line_rev = _num(v)
                    break
            if line_rev == 0.0:
                retail = _num(vi.get("retail_price") or li.get("price") or 0)
                line_rev = retail * qty

            cat = classify_sku(name)
            items_classified.append({
                "name": name, "qty": qty, "revenue": line_rev, "category": cat,
            })

        processed.append((vn_date, order_id, items_classified))

    result = {}
    for pk, (pstart, pend) in periods.items():
        # Init all 9 categories
        cats = {ck: {"revenue": 0.0, "order_ids": set(), "units": 0, "products": {}}
                for ck, _ in CATEGORY_ORDER}
        all_order_ids = set()
        total_rev = 0.0

        for vn_date, order_id, items in processed:
            if not (pstart <= vn_date <= pend):
                continue
            all_order_ids.add(order_id)
            for it in items:
                cat = it["category"]
                c = cats[cat]
                c["revenue"] += it["revenue"]
                c["order_ids"].add(order_id)
                c["units"] += it["qty"]
                total_rev += it["revenue"]
                # aggregate top SP trong category
                pname = it["name"]
                if pname not in c["products"]:
                    c["products"][pname] = {"revenue": 0.0, "orders": set(), "units": 0}
                c["products"][pname]["revenue"] += it["revenue"]
                c["products"][pname]["orders"].add(order_id)
                c["products"][pname]["units"] += it["qty"]

        # Finalize
        out_cats = {}
        for ck, label in CATEGORY_ORDER:
            c = cats[ck]
            top_list = sorted(
                ({"product": n, "revenue": round(d["revenue"]), "orders": len(d["orders"]), "units": d["units"]}
                 for n, d in c["products"].items()),
                key=lambda x: -x["revenue"]
            )[:5]
            out_cats[ck] = {
                "label": label,
                "revenue": round(c["revenue"]),
                "orders": len(c["order_ids"]),
                "units": c["units"],
                "top_products": top_list,
            }

        result[pk] = {
            "label": labels[pk],
            "date_range": {"start": pstart, "end": pend},
            "total_revenue": round(total_rev),
            "total_orders": len(all_order_ids),
            "categories": out_cats,
        }
    return result


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
    per_group_orders = {}   # NEW: cache raw orders để build top_products_website_by_period
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
        per_group_orders[key] = orders  # NEW: cache cho build_top_products_website_by_period

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


    # ── Build top_products_website_by_period (3 nguồn Web+Zalo+Hotline, TẤT CẢ SKU) ──
    web_sources_orders = (
        per_group_orders.get("WEBSITE", []) +
        per_group_orders.get("ZALO_OA", []) +
        per_group_orders.get("HOTLINE", [])
    )
    today_vn = (end_dt + timedelta(hours=7)).date()
    top_products_website_by_period = build_top_products_website_by_period(
        web_sources_orders, today_vn, top_n=10
    )
    print("\n─── [TOP PRODUCTS WEBSITE (3 nguồn, all SKU) theo 5 period] ───")
    for pk, pdata in top_products_website_by_period.items():
        print(f"  {pk:12s} ({pdata['date_range']['start']} → {pdata['date_range']['end']}): "
              f"{pdata['total_revenue']:>15,.0f}đ / {pdata['total_orders']:>4} đơn / "
              f"{len(pdata['top_products'])} SP")

    # ── Build flat items list (cho JS compute dynamic theo mọi date range) ──
    # Mỗi item 1 row: date VN, order_id, name, quantity, revenue, category
    # Dùng key ngắn (d/oid/n/q/r/c) để giảm size JSON
    web_items_flat = []
    for _o in web_sources_orders:
        _ins = (_o.get("inserted_at") or "")[:26]
        if not _ins:
            continue
        try:
            _dt = datetime.fromisoformat(_ins).replace(tzinfo=timezone.utc)
        except Exception:
            continue
        _vd = (_dt + timedelta(hours=7)).date().isoformat()
        _oid = _o.get("id")
        for _li in (_o.get("items") or []):
            _vi = _li.get("variation_info") or {}
            _prod = _li.get("product") or {}
            _name = (_vi.get("name") or _prod.get("name") or "").strip()
            if not _name:
                _code = _vi.get("id") or _li.get("display_id") or ""
                _name = str(_code).strip()
            if not _name:
                continue
            _qty = int(_num(_li.get("quantity", 1), 1) or 1)
            _rev = 0.0
            for _key in ("total_price_after_sub_discount", "total_price"):
                _v = _li.get(_key)
                if _v is not None and _num(_v, 0) > 0:
                    _rev = _num(_v)
                    break
            if _rev == 0.0:
                _retail = _num(_vi.get("retail_price") or _li.get("price") or 0)
                _rev = _retail * _qty
            web_items_flat.append({
                "d":   _vd,
                "oid": _oid,
                "n":   _name,
                "q":   _qty,
                "r":   round(_rev),
                "c":   classify_sku(_name),
            })
    print(f"\n[INFO] web_items_flat: {len(web_items_flat)} items exported cho JS dynamic compute")

    # ── Build category_breakdown_by_period — 9 nhóm chuẩn Doscom ──
    category_breakdown_by_period = build_category_breakdown_by_period(
        web_sources_orders, today_vn
    )
    print("\n─── [CATEGORY BREAKDOWN (9 nhóm) theo 5 period] ───")
    for pk, pdata in category_breakdown_by_period.items():
        print(f"  [{pk}] {pdata['total_revenue']:,}đ / {pdata['total_orders']} đơn")
        for ck, _lbl in CATEGORY_ORDER:
            c = pdata["categories"][ck]
            if c["revenue"] > 0 or c["orders"] > 0:
                print(f"    {ck:20s} | {c['revenue']:>13,}đ | {c['orders']:>3} đơn | {c['units']:>3} SP")

    output = {
        "generated_at": end_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "window_days": LOOKBACK_DAYS,
        "total_orders": total_count,
        # MỚI: top SP tổng cho 3 nguồn Web+Zalo+Hotline, TẤT CẢ SKU (không filter MAPPING),
        # 5 period chuẩn (yesterday / last_7d / this_month / last_30d / last_90d) tính theo VN.
        "top_products_website_by_period": top_products_website_by_period,
        # MỚI (2026-04-23 v2): breakdown theo 9 nhóm chuẩn Doscom, cho cả 9 period.
        # Thay thế logic PRODUCT_MAPPING cũ (13 SP) bằng classify_sku() cover TẤT CẢ SKU.
        "category_breakdown_by_period": category_breakdown_by_period,
        # MỚI (2026-04-24): flat items từ 3 nguồn Web+Zalo+Hotline — cho JS compute
        # dynamic theo BẤT KỲ date range nào (kể cả custom). Không giới hạn 9 period.
        "web_items_flat": web_items_flat,
        # MỚI: thứ tự + label 9 nhóm để UI đọc và render đúng thứ tự
        "category_order": [{"key": k, "label": l} for k, l in CATEGORY_ORDER],
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
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
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import urllib.request
import urllib.error

# ── Config ─────────────────────────────────────────────
API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE_URL = "https://pos.pancake.vn/api/v1"  # internal endpoint cho get_orders

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

SOURCE_FILTER_KEYWORD = "DUY"   # legacy fallback
LOOKBACK_DAYS = 30              # 30 ngày đủ cho dashboard, giới hạn thời gian chạy

# Saved filter "DUY" trên Pancake — server-side filter, không cần match client-side
DUY_SAVED_FILTER_ID = "8350fe1d-fd9b-41d8-bb3a-f075a5e94df5"

# Legacy fallback (không còn dùng trực tiếp, giữ làm reference)
DUY_SOURCE_IDS = {
    "308004272", "1536003777", "615005571", "308003603",
    "922003735", "1843001674", "922002510", "1843000628",
    "307500561", "921500725", "921041344", "307040304",
    "39739", "614046174", "1842044041", "307039298",
    "1842043463", "1228044436", "614044869", "921041902",
    "1535037303", "1228042142", "1535038664",
}
DUY_PAGE_IDS = {"842243695641184"}


def fetch_orders(page=1, page_size=100, start_date=None, end_date=None, debug=False, max_retries=4):
    """Fetch một page đơn từ Pancake POS (dùng internal endpoint `orders/get_orders`
    với saved_filters_id=DUY để server-side filter đơn của Duy)."""
    params = {
        "api_key": API_KEY,
        "saved_filters_id": DUY_SAVED_FILTER_ID,
        "page": page,
        "page_size": page_size,
        "status": -1,              # tất cả trạng thái
        "updateStatus": "inserted_at",
        "option_sort": "inserted_at_desc",
        "es_only": "true",
    }
    if start_date:
        params["startDateTime"] = int(start_date.timestamp())  # Unix seconds
    if end_date:
        params["endDateTime"] = int(end_date.timestamp())

    url = f"{BASE_URL}/shops/{SHOP_ID}/orders/get_orders?{urlencode(params)}"
    safe_url = url.replace(API_KEY, "***") if API_KEY else url
    print(f"[DEBUG] POST {safe_url}")

    last_err = None
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
                print(f"[DEBUG] HTTP {resp.status} · {len(raw)} bytes (attempt {attempt})")
                if debug:
                    print(f"[DEBUG] Response body (first 2000 chars):\n{raw[:2000]}")
                parsed = json.loads(raw)
                if debug:
                    print(f"[DEBUG] Top-level keys: {list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__}")
                return parsed
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:500]
            print(f"[WARN] HTTP {e.code} (attempt {attempt}/{max_retries}): {body}", file=sys.stderr)
            last_err = e
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries:
                sleep_s = 2 ** attempt  # 2s, 4s, 8s, 16s
                print(f"[INFO] Retrying in {sleep_s}s...", file=sys.stderr)
                time.sleep(sleep_s)
                continue
            # 4xx không retry (trừ 429), hoặc đã hết lần → return None để caller tự xử lý
            print(f"[ERROR] Giving up after {attempt} attempt(s) at page {page}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[WARN] {type(e).__name__} (attempt {attempt}/{max_retries}): {e}", file=sys.stderr)
            last_err = e
            if attempt < max_retries:
                sleep_s = 2 ** attempt
                time.sleep(sleep_s)
                continue
            return None
    return None


def source_matches(order):
    """Return True if đơn này thuộc về Duy.

    Ưu tiên: match `order_sources` ID với whitelist DUY_SOURCE_IDS (chính xác 100%).
    Fallback: text match "DUY" trong các trường tên (khi không có ID).
    """
    # 1) ID match chính xác theo saved filter "DUY" của Pancake
    src_raw = order.get("order_sources")
    src_str = str(src_raw).strip() if src_raw is not None else ""
    if src_str in DUY_SOURCE_IDS:
        return True
    # Đơn có order_sources = "-1" → fallback theo page_id
    if src_str == "-1":
        pid = str(order.get("page_id", "")).strip()
        if pid in DUY_PAGE_IDS:
            return True

    # 2) Fallback text match (phòng trường hợp có nguồn mới chưa có trong whitelist)
    candidates = []
    # Các trường tên nguồn phổ biến
    for key in (
        "order_sources_name", "source_name", "channel_name",
        "source", "channel", "order_source",
    ):
        v = order.get(key)
        if isinstance(v, str):
            candidates.append(v)
        elif isinstance(v, list):
            for x in v:
                if isinstance(x, str):
                    candidates.append(x)
                elif isinstance(x, dict):
                    for k2 in ("name", "label", "title"):
                        if isinstance(x.get(k2), str):
                            candidates.append(x[k2])
        elif isinstance(v, dict):
            for k2 in ("name", "label", "title"):
                if isinstance(v.get(k2), str):
                    candidates.append(v[k2])

    # Các object lồng có thể chứa tên người phụ trách (marketer, seller)
    for key in ("marketer", "assigning_seller", "creator", "account", "page", "origin"):
        v = order.get(key)
        if isinstance(v, str):
            candidates.append(v)
        elif isinstance(v, dict):
            for k2 in ("name", "full_name", "page_name", "username"):
                if isinstance(v.get(k2), str):
                    candidates.append(v[k2])

    # p_utm_* fields đôi khi chứa nguồn quảng cáo
    for key in ("p_utm_source", "p_utm_medium", "p_utm_content", "p_utm_campaign"):
        v = order.get(key)
        if isinstance(v, str):
            candidates.append(v)

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
        # Server (Pancake) đã filter theo saved_filters_id=DUY → không cần match lại.
        # Giữ source_matches() chỉ để log/diagnostics, không dùng để loại đơn.
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
    total_entries = None  # sẽ lấy từ response đầu tiên
    cutoff_ts = start_dt  # chỉ dùng cho fallback parse local

    def order_time(o):
        """Lấy timestamp của đơn (ưu tiên inserted_at → updated_at → purchased_at)."""
        for k in ("inserted_at", "updated_at", "purchased_at", "last_update_at"):
            v = o.get(k)
            if v:
                try:
                    # Pancake ISO 8601 kiểu 2026-04-14T02:43:42.535411
                    s = v.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(s)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt
                except Exception:
                    continue
        return None

    # Dùng endpoint internal /orders/get_orders + saved_filters_id=DUY
    # Server đã filter theo nguồn + ngày (Unix timestamp), ta chỉ pagination.
    stop = False
    consecutive_fails = 0
    while not stop:
        data = fetch_orders(page=page, page_size=100, start_date=start_dt, end_date=end_dt, debug=(page == 1))

        # Page lỗi (sau retry vẫn fail) → bỏ qua page này, thử page kế tiếp
        if data is None:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print(f"[WARN] 3 pages liên tiếp fail, dừng fetch và dùng data đã có", file=sys.stderr)
                break
            page += 1
            time.sleep(3)
            continue
        consecutive_fails = 0

        if isinstance(data, list):
            batch = data
        elif isinstance(data, dict):
            batch = data.get("data") or data.get("orders") or data.get("result") or []
        else:
            batch = []
        if not batch:
            break

        # Filter client-side theo cutoff
        kept_this_page = 0
        for o in batch:
            ot = order_time(o)
            if ot is None:
                all_orders.append(o)  # không xác định được → giữ
                kept_this_page += 1
            elif ot >= cutoff_ts:
                all_orders.append(o)
                kept_this_page += 1
            else:
                # đơn cũ hơn cutoff → vì Pancake trả desc, có thể dừng luôn
                stop = True

        print(f"[INFO] Page {page}: fetched {len(batch)}, kept {kept_this_page} within {LOOKBACK_DAYS}d (total kept {len(all_orders)})")

        if len(batch) < 100:
            break
        page += 1
        # throttle để tránh rate limit / 500
        time.sleep(0.3)
        if page > 600:  # 59k đơn / 100 ≈ 590 pages — safety cap cao hơn
            print("[WARN] Hit 600-page safety cap", file=sys.stderr)
            break

    print(f"[INFO] Fetched {len(all_orders)} orders total (within {LOOKBACK_DAYS}d)")

    # Debug: in sample order structure để verify parsing
    if all_orders:
        sample = all_orders[0]
        print(f"[DEBUG] Sample order keys: {list(sample.keys())[:40]}")
        src_keys = {k: sample.get(k) for k in (
            "source", "source_name", "channel", "channel_name",
            "order_sources", "order_sources_name",
            "marketer", "assigning_seller", "creator",
            "p_utm_source", "p_utm_medium", "p_utm_content",
        ) if k in sample}
        print(f"[DEBUG] Sample source fields: {json.dumps(src_keys, ensure_ascii=False, default=str)[:800]}")

        # In 10 tên nguồn khác nhau để biết tên thật trông ra sao
        source_names_seen = set()
        for o in all_orders[:500]:
            for k in ("order_sources_name", "source_name", "channel_name"):
                v = o.get(k)
                if isinstance(v, str) and v.strip():
                    source_names_seen.add(v.strip())
        print(f"[DEBUG] Distinct source names (first 20): {list(source_names_seen)[:20]}")

        # Phân bố order_sources ID — top 30
        from collections import Counter
        src_counter = Counter()
        for o in all_orders:
            src_counter[str(o.get("order_sources", "N/A"))] += 1
        print(f"[DEBUG] Top 30 order_sources IDs (count): {src_counter.most_common(30)}")

        # Đếm số đơn match whitelist
        in_whitelist = sum(1 for o in all_orders if str(o.get("order_sources", "")) in DUY_SOURCE_IDS)
        print(f"[DEBUG] Orders with order_sources in DUY whitelist: {in_whitelist}/{len(all_orders)}")

        # ── Dump phân bố mã sản phẩm thực có trong line items ──
        from collections import Counter as _C
        code_counter = _C()
        for o in all_orders:
            for li in (o.get("items") or o.get("order_items") or []):
                for k in ("display_id", "product_display_id", "product_code",
                          "product_id", "variation_id", "barcode",
                          "sku", "product_sku"):
                    v = li.get(k)
                    if v:
                        code_counter[f"{k}={v}"] += 1
                prod = li.get("product") or {}
                for k in ("display_id", "code", "id"):
                    v = prod.get(k)
                    if v:
                        code_counter[f"product.{k}={v}"] += 1
                vi = li.get("variation_info") or {}
                for k in ("display_id", "sku", "code"):
                    v = vi.get(k)
                    if v:
                        code_counter[f"variation_info.{k}={v}"] += 1
        print("[DEBUG] Top 40 product identifiers seen in line items:")
        for k, v in code_counter.most_common(40):
            print(f"    {v:>5}x  {k}")
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

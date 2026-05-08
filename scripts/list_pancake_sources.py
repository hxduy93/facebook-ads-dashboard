#!/usr/bin/env python3
"""
List all Pancake order sources (one-shot debug).

Mục đích: lấy danh sách `id + name` của tất cả nguồn đơn (Pancake "order sources")
để map FB ad account -> source ID, từ đó tách doanh số FB-only per nhân sự
trong scripts/fetch_pancake_revenue.py.

Usage (local):
    PANCAKE_API_KEY=... PANCAKE_SHOP_ID=... python scripts/list_pancake_sources.py

Usage (GitHub Actions): trigger workflow `.github/workflows/list-pancake-sources.yml`.

Output: bảng (ID | Tên nguồn) + tổng count, in ra stdout.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

API_KEY = os.environ.get("PANCAKE_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE = "https://pos.pancake.vn/api/v1"

if not API_KEY or not SHOP_ID:
    sys.exit("ERROR: PANCAKE_API_KEY or PANCAKE_SHOP_ID not set in env")


def try_endpoint(method, path, params):
    """Call API, return parsed JSON or {'_error': msg}."""
    url = f"{BASE}/{path}"
    if method == "GET":
        url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, method="GET",
                                     headers={"Accept": "application/json"})
    else:
        body = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Accept": "application/json",
                     "Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:300]
        return {"_error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}"}


def normalize_sources(resp):
    """Pancake có vài shape khác nhau — extract list of {id, name}."""
    if not isinstance(resp, dict):
        return []
    raw = (resp.get("data") or resp.get("sources")
           or resp.get("order_sources") or resp.get("entries") or [])
    if isinstance(raw, dict):
        # Some Pancake endpoints wrap in {"data": {"items": [...]}}
        raw = raw.get("items") or raw.get("data") or []
    out = []
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict):
            continue
        sid = s.get("id") or s.get("source_id") or s.get("_id")
        name = (s.get("name") or s.get("display_name")
                or s.get("label") or s.get("title") or "")
        if sid:
            out.append({"id": str(sid), "name": str(name)})
    return out


def fetch_all_sources():
    """Try several endpoint shapes, return first that works."""
    candidates = [
        ("GET",  f"shops/{SHOP_ID}/order_sources"),
        ("POST", f"shops/{SHOP_ID}/order_sources"),
        ("GET",  f"shops/{SHOP_ID}/order_sources/get_list"),
        ("POST", f"shops/{SHOP_ID}/order_sources/get_list"),
        ("GET",  f"shops/{SHOP_ID}/sources"),
    ]
    all_sources = []
    seen_ids = set()
    last_error = None
    for method, path in candidates:
        print(f"[TRY] {method} /{path}", file=sys.stderr)
        # Pagination: try page 1..10 (Pancake usually small list, 200/page enough)
        for page in range(1, 11):
            params = {"api_key": API_KEY, "page": page, "page_size": 200}
            resp = try_endpoint(method, path, params)
            if "_error" in resp:
                last_error = resp["_error"]
                print(f"  page {page}: {last_error[:150]}", file=sys.stderr)
                break
            sources = normalize_sources(resp)
            if not sources:
                if page == 1:
                    print(f"  empty/wrong shape, top-level keys = "
                          f"{list(resp.keys())[:6]}", file=sys.stderr)
                break
            new = [s for s in sources if s["id"] not in seen_ids]
            for s in new:
                seen_ids.add(s["id"])
            all_sources.extend(new)
            print(f"  page {page}: +{len(new)} new (total {len(all_sources)})",
                  file=sys.stderr)
            if len(sources) < 200:
                break
        if all_sources:
            return all_sources, None
    return [], last_error


def fetch_sample_order():
    """Fallback: dump 1 order raw to inspect schema for source-like fields."""
    resp = try_endpoint("POST", f"shops/{SHOP_ID}/orders/get_orders",
                        {"api_key": API_KEY, "page": 1, "page_size": 1,
                         "status": -1})
    return resp


def main():
    sources, err = fetch_all_sources()

    if not sources:
        print("\n!!! Không fetch được order_sources qua endpoint nào.",
              file=sys.stderr)
        if err:
            print(f"!!! Last error: {err}", file=sys.stderr)
        print("\n[FALLBACK] Dump 1 sample order để inspect schema:\n")
        sample = fetch_sample_order()
        # Print top-level keys of first order so we can see source-related fields
        if isinstance(sample, dict):
            data = sample.get("data") or sample.get("orders") or []
            if data and isinstance(data, list):
                first = data[0]
                print("Top-level keys của 1 order:")
                for k in sorted(first.keys()):
                    v = first[k]
                    snippet = (json.dumps(v, ensure_ascii=False)[:120]
                               if not isinstance(v, (str, int, float, bool, type(None)))
                               else str(v)[:120])
                    print(f"  {k:30} = {snippet}")
            else:
                print(json.dumps(sample, indent=2, ensure_ascii=False)[:3000])
        sys.exit(1)

    # Sort: by name (DUY first, then PHƯƠNG NAM, then alphabetical)
    def sort_key(s):
        n = s["name"].upper()
        if n.startswith("DUY"):
            return (0, n)
        if n.startswith("PHƯƠNG NAM") or n.startswith("PHUONG NAM"):
            return (1, n)
        return (2, n)
    sources.sort(key=sort_key)

    print()
    print(f"{'ID':<14} | Tên nguồn")
    print("-" * 70)
    for s in sources:
        print(f"{s['id']:<14} | {s['name']}")
    print()
    print(f"Total: {len(sources)} order sources")


if __name__ == "__main__":
    main()

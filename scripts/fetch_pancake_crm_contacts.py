#!/usr/bin/env python3
"""
Fetch contacts (leads) from Pancake CRM API, parse UTM from `link` field,
aggregate by Facebook ad_id (utm_content) → connect FB Ads ↔ doanh số.

Input env:
  PANCAKE_CRM_API_KEY  — API key tạo trong CRM (Cấu hình → API Key)
  PANCAKE_SHOP_ID      — shop_id (giống POS, cùng 1 cửa hàng Pancake)

Output: data/pancake-crm-contacts.json
"""

import os
import sys
import json
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

API_KEY = os.environ.get("PANCAKE_CRM_API_KEY", "").strip()
SHOP_ID = os.environ.get("PANCAKE_SHOP_ID", "").strip()
BASE_URL = "https://pos.pancake.vn/api/v1"
TABLE = "Contact"
LOOKBACK_DAYS = 90  # match fetch_pancake_revenue.py window
PAGE_SIZE = 300     # max safe page size (đã test, server chấp nhận)
OUTPUT_FILE = "data/pancake-crm-contacts.json"


def http_get_json(url, max_retries=4):
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fb-ads-dashboard/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            wait = min(2 ** attempt, 16)
            print(f"  [retry {attempt}/{max_retries}] {e} — chờ {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Failed after {max_retries} retries: {last_err}")


def parse_utm_from_link(link):
    """Parse utm_* params + fbclid from a link string. Returns dict (empty if no link)."""
    out = {
        "utm_source": None, "utm_medium": None, "utm_campaign": None,
        "utm_content": None, "utm_term": None, "utm_id": None, "fbclid": None,
    }
    if not link or not isinstance(link, str):
        return out
    # Pancake hay nhét cả 2 query string vào nhau (link gốc + redirect). Bóc cả 2 lần.
    try:
        # Lấy mọi query param (kể cả query nằm trong URL nested)
        parts = link.split("?")
        for chunk in parts[1:]:
            for kv in chunk.split("&"):
                if "=" not in kv:
                    continue
                k, v = kv.split("=", 1)
                k = k.strip().lower()
                if k in out and not out[k]:  # giữ giá trị đầu tiên gặp
                    out[k] = urllib.parse.unquote(v)
    except Exception:
        pass
    return out


def parse_runner_field(s):
    """nguoi_chay_quang_cao thường có format 'STAFF - PRODUCT' hoặc 'PRODUCT - STAFF'."""
    if not s or not isinstance(s, str):
        return {"raw": s, "left": None, "right": None}
    parts = [p.strip() for p in s.split(" - ", 1)]
    return {
        "raw": s,
        "left": parts[0] if parts else None,
        "right": parts[1] if len(parts) > 1 else None,
    }


def fetch_all_contacts():
    """Cursor-paginate qua hết contacts trong LOOKBACK_DAYS gần nhất."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    # MongoDB-style filter (đã test ok)
    filter_obj = {"$and": [{"CreatedOn": {"$gte": cutoff_str}}]}
    filter_enc = urllib.parse.quote(json.dumps(filter_obj))

    all_entries = []
    cursor = None
    page = 1
    while True:
        params = [
            ("api_key", API_KEY),
            ("page", page),
            ("page_size", PAGE_SIZE),
            ("filter", json.dumps(filter_obj)),
        ]
        if cursor:
            params.append(("cursor", cursor))
        qs = urllib.parse.urlencode(params)
        url = f"{BASE_URL}/shops/{SHOP_ID}/crm/{TABLE}/records?{qs}"

        print(f"  page {page} (cursor={'yes' if cursor else 'no'}) — fetching…", file=sys.stderr)
        data = http_get_json(url)
        body = data.get("data", {}) if isinstance(data, dict) else {}
        entries = body.get("entries", []) or []
        new_cursor = body.get("cursor")

        if not entries:
            break
        all_entries.extend(entries)
        if not new_cursor or new_cursor == cursor:
            break
        cursor = new_cursor
        page += 1
        if page > 200:  # safety cap (200 * 300 = 60K, đủ cho 90 ngày)
            print("  [warn] hit page cap 200 — break", file=sys.stderr)
            break
        time.sleep(0.3)  # nhẹ tay với server

    return all_entries


def normalize_contact(e):
    """Bóc field cần dùng, parse UTM, parse runner field."""
    link = e.get("link") or e.get("pancake_link")
    utm = parse_utm_from_link(link)
    runner = parse_runner_field(e.get("nguoi_chay_quang_cao"))
    owner = e.get("Owner_obj") or {}
    return {
        "id": e.get("id"),
        "name": e.get("Name"),
        "phone": e.get("Phone"),
        "created_on": e.get("CreatedOn"),
        "modified_on": e.get("ModifiedOn"),
        "address": e.get("Address"),
        "note": e.get("Note"),
        "source_of_leads": e.get("SourceOfLeads"),
        "trang_thai": e.get("trang_thai"),
        "san_pham": e.get("san_pham"),
        "owner_name": owner.get("name"),
        "owner_id": owner.get("id"),
        "nguoi_chay_qc": runner["raw"],
        "nguoi_chay_qc_left": runner["left"],
        "nguoi_chay_qc_right": runner["right"],
        "link": link,
        **utm,
    }


def aggregate_by_utm_content(contacts):
    """Group theo utm_content (= ad_id Facebook) → đếm contact + breakdown theo ngày."""
    by_ad = {}
    for c in contacts:
        ad_id = c.get("utm_content")
        if not ad_id:
            continue
        day = (c.get("created_on") or "")[:10]
        if not day:
            continue
        if ad_id not in by_ad:
            by_ad[ad_id] = {
                "utm_content": ad_id,
                "utm_campaign": c.get("utm_campaign"),
                "utm_term": c.get("utm_term"),
                "total_contacts": 0,
                "contacts_by_date": {},
                "runners": {},
                "sources": {},
            }
        b = by_ad[ad_id]
        b["total_contacts"] += 1
        b["contacts_by_date"][day] = b["contacts_by_date"].get(day, 0) + 1
        r = c.get("nguoi_chay_qc") or "(none)"
        b["runners"][r] = b["runners"].get(r, 0) + 1
        s = c.get("source_of_leads") or "(none)"
        b["sources"][s] = b["sources"].get(s, 0) + 1
    return by_ad


def main():
    if not API_KEY or not SHOP_ID:
        print("[FATAL] Missing PANCAKE_CRM_API_KEY or PANCAKE_SHOP_ID env", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] Fetch Pancake CRM contacts — shop={SHOP_ID}, lookback={LOOKBACK_DAYS}d", file=sys.stderr)
    raw = fetch_all_contacts()
    print(f"[INFO] Got {len(raw):,} raw contacts", file=sys.stderr)

    contacts = [normalize_contact(e) for e in raw]
    with_utm = sum(1 for c in contacts if c.get("utm_content"))
    print(f"[INFO] {with_utm:,} / {len(contacts):,} có utm_content (FB ad_id)", file=sys.stderr)

    by_utm = aggregate_by_utm_content(contacts)
    print(f"[INFO] {len(by_utm):,} unique ad_id (utm_content)", file=sys.stderr)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "shop_id": SHOP_ID,
        "lookback_days": LOOKBACK_DAYS,
        "total_contacts": len(contacts),
        "contacts_with_utm_content": with_utm,
        "unique_ad_ids": len(by_utm),
        "by_utm_content": by_utm,
        # Không dump toàn bộ contacts (có PII: phone, address) — chỉ dump aggregated.
        # Nếu sau này cần raw để debug, mở comment dưới:
        # "contacts": contacts,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"[OK] Wrote {OUTPUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()

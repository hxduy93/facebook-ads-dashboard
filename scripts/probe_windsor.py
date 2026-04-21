#!/usr/bin/env python3
"""
Probe Windsor.ai JSON API — kiểm tra free trial có cap field ở API không.
Usage:
    python scripts/probe_windsor.py
Script sẽ hỏi API key nếu chưa có env var WINDSOR_API_KEY.
"""
import os
import sys
import json
import urllib.request
import urllib.error

def probe(label, fields, key):
    url = (
        "https://connectors.windsor.ai/all"
        f"?api_key={key}"
        "&date_preset=last_7d"
        f"&fields={fields}"
    )
    print(f"\n{'=' * 60}")
    print(f"TEST: {label}")
    print(f"Fields ({len(fields.split(','))}): {fields}")
    print(f"{'=' * 60}")
    try:
        raw = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:500]
        print(f"[HTTP ERROR {e.code}] {body}")
        return
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")
        return

    print(f"\n--- Raw response (first 500 chars) ---")
    print(raw[:500])

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[JSON PARSE ERROR] {e}")
        return

    print(f"\n--- Parsed ---")
    print(f"Type: {type(data).__name__}")

    if isinstance(data, dict):
        print(f"Top-level keys: {list(data.keys())}")
        # Unwrap phổ biến: { "data": [...] } hoặc { "result": [...] }
        for wrapper in ("data", "result", "rows"):
            if wrapper in data and isinstance(data[wrapper], list):
                rows = data[wrapper]
                print(f"Unwrap key='{wrapper}' → {len(rows)} rows")
                if rows:
                    print(f"Fields có trong row[0]: {list(rows[0].keys())}")
                    print(f"Row[0] sample: {json.dumps(rows[0], ensure_ascii=False, indent=2)[:400]}")
                return
        # Không có wrapper phổ biến → có thể là error
        print(f"No list wrapper found. Raw dict: {json.dumps(data, ensure_ascii=False, indent=2)[:500]}")
    elif isinstance(data, list):
        print(f"Rows: {len(data)}")
        if data:
            print(f"Fields có trong row[0]: {list(data[0].keys())}")
            print(f"Row[0] sample: {json.dumps(data[0], ensure_ascii=False, indent=2)[:400]}")
    else:
        print(f"Unexpected type: {data}")


def main():
    key = os.environ.get("WINDSOR_API_KEY", "").strip()
    if not key:
        key = input("Paste WINDSOR_API_KEY: ").strip()
    if not key:
        print("[FATAL] No API key provided.")
        sys.exit(1)

    # Test 1 — baseline 7 field (pipeline hiện tại)
    probe(
        "Baseline 7 fields (pipeline hiện tại)",
        "account_name,campaign,date,spend,clicks,impressions,datasource",
        key,
    )

    # Test 2 — 9 field (thêm search_term + conversions)
    probe(
        "9 fields (thêm search_term + conversions)",
        "account_name,campaign,date,spend,clicks,impressions,datasource,search_term,conversions",
        key,
    )

    # Test 3 — 11 field (thêm search_term_match_type + status)
    probe(
        "11 fields (thêm match_type + status)",
        "account_name,campaign,date,spend,clicks,impressions,datasource,search_term,conversions,search_term_match_type,search_term_view_status",
        key,
    )


if __name__ == "__main__":
    main()

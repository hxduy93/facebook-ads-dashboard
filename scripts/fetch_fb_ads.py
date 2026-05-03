#!/usr/bin/env python3
"""
Fetch Facebook Ads insights from Meta Marketing API for all 6 Doscom ad accounts.
Transform thành data/fb-ads-data.json với schema campaign-level 90 ngày.

6 ad accounts (BM "Yoday Media Retail"):
  - 927390616363424  Doscom - Công nghệ nâng tầm cuộc sống
  - 764394829882083  Doscom - Noma.vn - Giải Pháp Chăm Sóc Xe Hơi Toàn Diện
  - 1655506672244826 CÔNG TY TNHH DOSCOM HOLDINGS - Noma Việt Nam
  - 1449385949897024 CÔNG TY TNHH DOSCOM HOLDINGS - Công nghệ nâng tầm cuộc sống
  - 906015559004892  Doscom Mart
  - 1416634670476226 CÔNG TY TNHH DOSCOM HOLDINGS - Doscom Mart

Cron: mỗi 3 giờ qua GitHub Actions (.github/workflows/fetch-fb-ads.yml).
"""

import os
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────
ACCESS_TOKEN = os.environ.get("FB_ACCESS_TOKEN", "").strip()
API_VERSION = "v21.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

# 6 ad accounts Doscom
AD_ACCOUNTS = [
    {"id": "927390616363424",  "name": "Doscom - Công nghệ nâng tầm cuộc sống"},
    {"id": "764394829882083",  "name": "Doscom - Noma.vn - Giải Pháp Chăm Sóc Xe Hơi Toàn Diện"},
    {"id": "1655506672244826", "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Noma Việt Nam"},
    {"id": "1449385949897024", "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Công nghệ nâng tầm cuộc sống"},
    {"id": "906015559004892",  "name": "Doscom Mart"},
    {"id": "1416634670476226", "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Doscom Mart"},
]

# Fields to fetch from insights
INSIGHT_FIELDS = ",".join([
    "campaign_name",
    "campaign_id",
    "spend",
    "impressions",
    "clicks",
    "reach",
    "frequency",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "cost_per_action_type",
    "video_avg_time_watched_actions",
    "date_start",
    "date_stop",
])

# Lookback window
LOOKBACK_DAYS = 90


def api_request(url, max_retries=4):
    """Make GET request to FB API with retry + backoff."""
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:500]
            print(f"[WARN] HTTP {e.code} attempt={attempt}: {body}", file=sys.stderr)
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries:
                wait = 2 ** attempt
                print(f"[INFO] Waiting {wait}s before retry...", file=sys.stderr)
                time.sleep(wait)
                continue
            # Parse error message from FB API
            try:
                err = json.loads(body)
                msg = err.get("error", {}).get("message", body[:200])
            except Exception:
                msg = body[:200]
            print(f"[FATAL] FB API error: {msg}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[WARN] {type(e).__name__} attempt={attempt}: {e}", file=sys.stderr)
            if attempt < max_retries:
                time.sleep(2 ** attempt)
                continue
            return None
    return None


def fetch_account_insights(account_id, date_since, date_until):
    """Fetch campaign-level insights cho 1 account, tự động paginate."""
    all_data = []
    # ⚠ time_range JSON PHẢI URL-encode. Trước đây để raw {} → FB silently ignore parameter
    # → trả về empty data. Dùng urlencode để encode đúng JSON value trong URL.
    params = {
        "fields": INSIGHT_FIELDS,
        "level": "campaign",
        "time_range": json.dumps({"since": date_since, "until": date_until}, separators=(",", ":")),
        "time_increment": "1",
        "limit": "500",
        "access_token": ACCESS_TOKEN,
    }
    url = f"{BASE_URL}/act_{account_id}/insights?{urllib.parse.urlencode(params)}"

    # Log URL (redact token) để debug nếu fail
    safe_url = url.replace(ACCESS_TOKEN, "***TOKEN***")
    print(f"  [DEBUG] URL: {safe_url[:200]}...")

    page = 1
    while url:
        print(f"  [INFO] Page {page}...")
        data = api_request(url)
        if data is None:
            break

        batch = data.get("data", [])
        all_data.extend(batch)
        print(f"  [INFO] Got {len(batch)} rows (total {len(all_data)})")

        # Pagination
        paging = data.get("paging", {})
        url = paging.get("next")
        page += 1
        time.sleep(0.5)  # Rate limit friendly

    return all_data


def extract_action_value(actions, action_type):
    """Lấy value cho 1 action_type từ list actions FB API."""
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == action_type:
            return int(a.get("value", 0))
    return 0


def aggregate_campaigns(rows):
    """Aggregate daily rows thành campaign-level summary + by_date."""
    camps = defaultdict(lambda: {
        "campaign_id": "",
        "spend": 0.0,
        "impressions": 0,
        "clicks": 0,
        "reach": 0,
        "leads": 0,
        "link_clicks": 0,
        "landing_page_views": 0,
        "video_views": 0,
        "complete_registrations": 0,
        "messages": 0,
        "by_date": {},
    })

    for r in rows:
        name = r.get("campaign_name", "Unknown")
        c = camps[name]
        c["campaign_id"] = r.get("campaign_id", "")

        spend = float(r.get("spend", 0) or 0)
        impressions = int(r.get("impressions", 0) or 0)
        clicks = int(r.get("clicks", 0) or 0)
        reach = int(r.get("reach", 0) or 0)

        c["spend"] += spend
        c["impressions"] += impressions
        c["clicks"] += clicks
        c["reach"] += reach

        actions = r.get("actions", [])
        c["leads"] += extract_action_value(actions, "lead")
        c["link_clicks"] += extract_action_value(actions, "link_click")
        c["landing_page_views"] += extract_action_value(actions, "landing_page_view")
        c["video_views"] += extract_action_value(actions, "video_view")
        c["complete_registrations"] += extract_action_value(actions, "complete_registration")
        c["messages"] += extract_action_value(actions, "onsite_conversion.messaging_conversation_started_7d")

        date = r.get("date_start", "")
        if date:
            c["by_date"][date] = {
                "spend": spend,
                "impressions": impressions,
                "clicks": clicks,
                "reach": reach,
                "leads": extract_action_value(actions, "lead"),
                "link_clicks": extract_action_value(actions, "link_click"),
            }

    # Convert to list + compute CTR/CPC
    result = []
    for name, c in camps.items():
        ctr = (c["clicks"] / c["impressions"] * 100) if c["impressions"] > 0 else 0
        cpc = (c["spend"] / c["clicks"]) if c["clicks"] > 0 else 0
        cpm = (c["spend"] / c["impressions"] * 1000) if c["impressions"] > 0 else 0
        result.append({
            "campaign_name": name,
            "campaign_id": c["campaign_id"],
            "spend": round(c["spend"], 2),
            "impressions": c["impressions"],
            "clicks": c["clicks"],
            "reach": c["reach"],
            "ctr": round(ctr, 4),
            "cpc": round(cpc, 2),
            "cpm": round(cpm, 2),
            "leads": c["leads"],
            "link_clicks": c["link_clicks"],
            "landing_page_views": c["landing_page_views"],
            "video_views": c["video_views"],
            "complete_registrations": c["complete_registrations"],
            "messages": c["messages"],
            "by_date": dict(sorted(c["by_date"].items())),
        })

    result.sort(key=lambda x: x["spend"], reverse=True)
    return result


def main():
    if not ACCESS_TOKEN:
        print("[FATAL] Missing FB_ACCESS_TOKEN env var", file=sys.stderr)
        sys.exit(1)

    now_vn = datetime.now(timezone(timedelta(hours=7)))
    date_until = (now_vn - timedelta(days=1)).strftime("%Y-%m-%d")
    date_since = (now_vn - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    print(f"[INFO] FB Ads fetch: {date_since} → {date_until} ({LOOKBACK_DAYS} ngày)")
    print(f"[INFO] Fetching {len(AD_ACCOUNTS)} accounts...")

    accounts_data = []

    for acc in AD_ACCOUNTS:
        acc_id = acc["id"]
        acc_name = acc["name"]
        print(f"\n{'='*60}")
        print(f"[INFO] Account: {acc_name} ({acc_id})")

        rows = fetch_account_insights(acc_id, date_since, date_until)

        if not rows:
            print(f"[WARN] No data for account {acc_name}")
            accounts_data.append({
                "account_id": acc_id,
                "account_name": acc_name,
                "date_range": {"start": date_since, "end": date_until},
                "summary": {"spend": 0, "impressions": 0, "clicks": 0, "leads": 0},
                "campaigns": [],
                "rows_raw": 0,
            })
            continue

        campaigns = aggregate_campaigns(rows)
        total_spend = sum(c["spend"] for c in campaigns)
        total_clicks = sum(c["clicks"] for c in campaigns)
        total_impressions = sum(c["impressions"] for c in campaigns)
        total_leads = sum(c["leads"] for c in campaigns)
        total_reach = sum(c["reach"] for c in campaigns)

        accounts_data.append({
            "account_id": acc_id,
            "account_name": acc_name,
            "date_range": {"start": date_since, "end": date_until},
            "summary": {
                "spend": round(total_spend, 2),
                "impressions": total_impressions,
                "clicks": total_clicks,
                "reach": total_reach,
                "leads": total_leads,
                "ctr": round((total_clicks / total_impressions * 100) if total_impressions > 0 else 0, 4),
                "cpc": round((total_spend / total_clicks) if total_clicks > 0 else 0, 2),
            },
            "campaigns": campaigns,
            "rows_raw": len(rows),
        })

        print(f"  [DONE] {len(campaigns)} campaigns · Spend: {total_spend:,.0f}₫ · Clicks: {total_clicks:,} · Leads: {total_leads}")
        time.sleep(1)  # Rate limit between accounts

    # Build output
    output = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "source": f"FB Marketing API {API_VERSION} (auto every 3h)",
        "date_range": {"start": date_since, "end": date_until},
        "currency": "VND",
        "total_accounts": len(accounts_data),
        "total_summary": {
            "spend": round(sum(a["summary"]["spend"] for a in accounts_data), 2),
            "impressions": sum(a["summary"]["impressions"] for a in accounts_data),
            "clicks": sum(a["summary"]["clicks"] for a in accounts_data),
            "leads": sum(a["summary"].get("leads", 0) for a in accounts_data),
        },
        "accounts": accounts_data,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "fb-ads-data.json")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_spend = output["total_summary"]["spend"]
    total_leads = output["total_summary"]["leads"]
    print(f"\n{'='*60}")
    print(f"[DONE] Wrote {out_path}")
    print(f"       Total spend {LOOKBACK_DAYS}d: {total_spend:,.0f}₫")
    print(f"       Total leads: {total_leads}")
    print(f"       Accounts with data: {sum(1 for a in accounts_data if a['rows_raw'] > 0)}/{len(accounts_data)}")
    for a in accounts_data:
        s = a["summary"]
        print(f"         {a['account_name'][:40]:40s}: {s['spend']:>14,.0f}₫ · {len(a['campaigns'])} camps")


if __name__ == "__main__":
    main()

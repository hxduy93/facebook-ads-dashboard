"""
Facebook Ads Dashboard Auto-Updater
====================================
Fetches latest Facebook Ads data for 6 ad accounts under BM "Yoday Media
Retail", rebuilds index.html from template.html, and deploys to Netlify.

Run via GitHub Actions every 30 minutes. Requires these env vars:
  - FB_ACCESS_TOKEN   Facebook Marketing API long-lived token
  - NETLIFY_TOKEN     Netlify Personal Access Token
  - NETLIFY_SITE_ID   Netlify site UUID (from Site configuration > Site details)

Conversion metric = complete_registration (số lượt đăng ký hoàn tất).
"""
import os
import sys
import json
import io
import zipfile
from datetime import datetime, timedelta, timezone

import requests

# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------
FB_TOKEN        = os.environ["FB_ACCESS_TOKEN"]
# Netlify credentials are only required when this script is responsible for
# deploying (GitHub Actions cron path). When running INSIDE a Netlify build,
# Netlify publishes the generated file itself — these env vars aren't needed.
NETLIFY_TOKEN   = os.environ.get("NETLIFY_TOKEN", "")
NETLIFY_SITE_ID = os.environ.get("NETLIFY_SITE_ID", "")
# If SKIP_NETLIFY_DEPLOY is set (Netlify build env), generate index.html but
# skip the API deploy step — Netlify itself will publish the file.
SKIP_DEPLOY     = os.environ.get("SKIP_NETLIFY_DEPLOY", "").lower() in ("1", "true", "yes")

FB_API_VERSION = "v20.0"
DAYS_BACK      = 30  # last 30 days of data

# 6 ad accounts under BM "Yoday Media Retail".
# `staff`  = nhân sự cầm tài khoản (DUY / PHUONG_NAM) — dùng phân bổ ad spend cho tính LN.
ACCOUNTS = [
    {"id": "927390616363424",  "staff": "DUY",        "short": "Doscom - Công nghệ nâng tầm cuộc sống",                         "name": "Doscom - Công nghệ nâng tầm cuộc sống"},
    {"id": "764394829882083",  "staff": "PHUONG_NAM", "short": "Doscom - Noma.vn - Giải Pháp Chăm Sóc Xe Hơi Toàn Diện",        "name": "Doscom - Noma.vn - Giải Pháp Chăm Sóc Xe Hơi Toàn Diện"},
    {"id": "1655506672244826", "staff": "DUY",        "short": "CÔNG TY TNHH DOSCOM HOLDINGS - Noma Việt Nam",                  "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Noma Việt Nam"},
    {"id": "1449385949897024", "staff": "DUY",        "short": "CÔNG TY TNHH DOSCOM HOLDINGS - Công nghệ nâng tầm cuộc sống",   "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Công nghệ nâng tầm cuộc sống"},
    {"id": "906015559004892",  "staff": "PHUONG_NAM", "short": "Doscom Mart",                                                   "name": "Doscom Mart"},
    {"id": "1416634670476226", "staff": "PHUONG_NAM", "short": "CÔNG TY TNHH DOSCOM HOLDINGS - Doscom Mart",                    "name": "CÔNG TY TNHH DOSCOM HOLDINGS - Doscom Mart"},
]

# 13 SP tính lợi nhuận — khớp PRODUCT_LIST trong fetch_pancake_revenue.py
PROFIT_PRODUCTS = [
    "D1", "D1 Pro", "D2", "D3", "D4", "D8 Pro",
    "DR1", "DR4 Plus",
    "DV1 Pro",
    "DA8.1", "DA8.1 Pro",
    "Noma 911", "Noma 922",
]

# Map tên SP (PROFIT_PRODUCTS) → key Mã tên gọi trong xlsx Kho tổng (đã lowercase)
PRODUCT_TO_COST_KEY = {
    "D1":         "d1",
    "D1 Pro":     "d1 pro",
    "D2":         "d2",
    "D3":         "d3",
    "D4":         "d4",
    "D8 Pro":     "d8 pro",
    "DR1":        "dr1 new",     # xlsx: "DR1 New" đang KD (bản "DR1" cũ ngừng KD)
    "DR4 Plus":   "dr4 plus",
    "DV1 Pro":    "dv1 pro",
    "DA8.1":      "da8.1",
    "DA8.1 Pro":  "da8.1 pro",   # xlsx viết "DA8.1 PRO", đã lowercase
    "Noma 911":   "noma 911",
    "Noma 922":   "noma 922",
}

# Competitor data files (scraped via Chrome, not API)
COMPETITOR_BASELINE_FILE  = "data/competitor_baseline.json"
COMPETITOR_SNAPSHOTS_FILE = "data/competitor_snapshots.json"
KNOWN_COMPETITORS_FILE    = "known_competitors.json"

# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------
def detect_product(name: str):
    """Extract product tag từ campaign/ad — dùng cho 3 bucket legacy (D1/Noma911/DR1)."""
    if not name:
        return None
    n = name.lower()
    if "noma911" in n or "noma 911" in n:
        return "Noma911"
    if "dr1" in n:
        return "DR1"
    if "d1" in n:
        return "D1"
    return None


def detect_profit_product(name: str):
    """
    Extract 1 trong 13 PROFIT_PRODUCTS từ tên campaign — để phân bổ ad spend
    per nhân sự × sản phẩm cho tính lợi nhuận.

    Thứ tự check quan trọng (ưu tiên match cụ thể hơn):
      - "DA8.1 Pro" trước "DA8.1"
      - "Noma 922/911" trước generic
      - "D1 Pro", "D8 Pro" trước "D1", "D8"
      - "DR4 Plus" trước "DR4"
      - "DV1 Pro" trước "DV1"
    """
    if not name:
        return None
    n = name.lower().replace("_", " ").replace("-", " ")
    n = " ".join(n.split())

    # Camera DA8.1 — ưu tiên Pro
    if "da8.1 pro" in n or "da 8.1 pro" in n or "da8 1 pro" in n:
        return "DA8.1 Pro"
    if "da8.1" in n or "da 8.1" in n or "da8 1" in n:
        return "DA8.1"

    # Noma
    if "noma 922" in n or "noma922" in n:
        return "Noma 922"
    if "noma 911" in n or "noma911" in n:
        return "Noma 911"

    # DR
    if "dr4 plus" in n or "dr4plus" in n:
        return "DR4 Plus"
    if "dr1" in n:
        return "DR1"

    # DV
    if "dv1 pro" in n or "dv1pro" in n:
        return "DV1 Pro"

    # Máy dò D* — ưu tiên Pro/số lớn trước
    if "d1 pro" in n or "d1pro" in n:
        return "D1 Pro"
    if "d8 pro" in n or "d8pro" in n:
        return "D8 Pro"
    # Dò 2-ký-tự — match boundary để tránh "d10"/"d20" false positive
    import re
    for code in ("d1", "d2", "d3", "d4"):
        if re.search(rf"(?<![a-z0-9]){code}(?![a-z0-9])", n):
            return code.upper()
    return None

def extract_registrations(actions):
    """Pull complete_registration count from actions array."""
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == "complete_registration":
            try:
                return int(float(a.get("value", 0)))
            except (TypeError, ValueError):
                return 0
    return 0

def fb_get(url, params=None):
    """GET with retries for Facebook API."""
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=90)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                print(f"  retry {attempt+1} after HTTP {r.status_code}")
                continue
            r.raise_for_status()
        except requests.RequestException as e:
            if attempt == 2:
                raise
            print(f"  retry {attempt+1} after error: {e}")
    raise RuntimeError("fb_get failed after retries")

def fetch_insights(account_id: str, level: str):
    """Fetch daily insights for one account at a given level (account|campaign|ad)."""
    today = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d")
    since = (datetime.now(timezone(timedelta(hours=7))) - timedelta(days=DAYS_BACK - 1)).strftime("%Y-%m-%d")

    base_fields = ["spend", "impressions", "clicks", "reach", "actions"]
    if level in ("campaign", "ad"):
        base_fields += ["campaign_id", "campaign_name"]
    if level == "ad":
        base_fields += ["ad_id", "ad_name", "adset_id", "adset_name"]

    url = f"https://graph.facebook.com/{FB_API_VERSION}/act_{account_id}/insights"
    params = {
        "access_token": FB_TOKEN,
        "level": level,
        "time_range": json.dumps({"since": since, "until": today}),
        "time_increment": 1,
        "fields": ",".join(base_fields),
        "limit": 500,
    }

    rows = []
    while url:
        data = fb_get(url, params=params)
        rows.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = None  # next URL is fully-qualified
    return rows

def num(v, kind=float):
    try:
        return kind(v)
    except (TypeError, ValueError):
        return kind(0)

# -----------------------------------------------------------------------------
# COMPETITOR TRACKING (Chrome-scraped data, no API)
# -----------------------------------------------------------------------------
# Data is collected by manually scraping Facebook fanpages via Claude in Chrome.
# Two JSON files are used:
#   - data/competitor_baseline.json:  first-ever snapshot (fixed reference)
#   - data/competitor_snapshots.json: periodic snapshots for trending
#
# The dashboard shows: baseline vs latest snapshot, with change indicators.

def _load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f"   ! failed to parse {path}: {e}")
        return {}

def load_competitor_data():
    """Load baseline + snapshots and build the known_competitors data object."""
    print("→ loading competitor data (Chrome-scraped)")

    baseline = _load_json(COMPETITOR_BASELINE_FILE)
    snapshots = _load_json(COMPETITOR_SNAPSHOTS_FILE)
    known_list = _load_json(KNOWN_COMPETITORS_FILE).get("competitors", [])

    result = {
        "competitors": [],
        "baseline_date": baseline.get("scraped_date", ""),
        "fetched_at": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M"),
        "snapshots": snapshots.get("snapshots", []),
        "errors": [],
    }

    baseline_comps = {c["page_id"]: c for c in baseline.get("competitors", [])}

    for comp in baseline.get("competitors", []):
        page_id = comp.get("page_id", "")
        label = comp.get("label", "")

        # Find latest snapshot data for this competitor
        latest_snap = None
        all_snaps = snapshots.get("snapshots", [])
        if all_snaps:
            latest = all_snaps[-1]
            for s in latest.get("data", []):
                if s.get("page_id") == page_id:
                    latest_snap = s
                    break

        # Find matching known_competitors entry for page_url
        kc_entry = next((k for k in known_list if k.get("page_id") == page_id), {})

        result["competitors"].append({
            "page_id": page_id,
            "label": label,
            "page_url": kc_entry.get("page_url") or comp.get("page_url", ""),
            "category": comp.get("category", ""),
            "website": comp.get("website", ""),
            "bio": comp.get("bio", ""),
            "products": kc_entry.get("products", []),
            "notes": kc_entry.get("notes", ""),
            # Baseline metrics (fixed reference)
            "baseline_followers": comp.get("followers", 0),
            "baseline_likes": comp.get("likes"),
            "baseline_date": baseline.get("scraped_date", ""),
            # Latest metrics
            "current_followers": latest_snap.get("followers", comp.get("followers", 0)) if latest_snap else comp.get("followers", 0),
            "current_likes": latest_snap.get("likes") if latest_snap else comp.get("likes"),
            "current_top_post_likes": latest_snap.get("top_post_likes", 0) if latest_snap else 0,
            "current_top_post_comments": latest_snap.get("top_post_comments", 0) if latest_snap else 0,
            "current_top_post_shares": latest_snap.get("top_post_shares", 0) if latest_snap else 0,
            # Content analysis
            "recent_posts": comp.get("recent_posts", []),
            "analysis": comp.get("analysis", ""),
        })
        print(f"   ✓ {label}: followers={comp.get('followers', 0)}")

    print(f"   ✓ loaded {len(result['competitors'])} competitors from baseline")
    return result

# -----------------------------------------------------------------------------
# BUILD DATA OBJECT (same shape the HTML template expects)
# -----------------------------------------------------------------------------
def build_data():
    now_vn = datetime.now(timezone(timedelta(hours=7)))
    data = {
        "generated_at": now_vn.strftime("%Y-%m-%d %H:%M"),
        "accounts": [],
        "products": {"D1": [], "Noma911": [], "DR1": []},
        "campaigns": [],
        "ads": [],
    }

    for acc in ACCOUNTS:
        print(f"→ account {acc['short']} ({acc['id']})")

        # --- ACCOUNT LEVEL ---
        acc_rows = fetch_insights(acc["id"], "account")
        daily = []
        for r in acc_rows:
            daily.append({
                "date": r.get("date_start"),
                "spend": round(num(r.get("spend"))),
                "impressions": num(r.get("impressions"), int),
                "clicks": num(r.get("clicks"), int),
                "reach": num(r.get("reach"), int),
                "registrations": extract_registrations(r.get("actions")),
            })
        daily.sort(key=lambda x: x["date"])
        data["accounts"].append({
            "id": f"act_{acc['id']}",
            "short": acc["short"],
            "name": acc["name"],
            "daily": daily,
        })

        # --- CAMPAIGN LEVEL ---
        camp_rows = fetch_insights(acc["id"], "campaign")
        camps = {}
        for r in camp_rows:
            cid = r.get("campaign_id")
            if not cid:
                continue
            if cid not in camps:
                camps[cid] = {
                    "id": cid,
                    "name": r.get("campaign_name", ""),
                    "account_id": f"act_{acc['id']}",
                    "product": detect_product(r.get("campaign_name", "")),
                    "daily": [],
                }
            camps[cid]["daily"].append({
                "date": r.get("date_start"),
                "spend": round(num(r.get("spend"))),
                "impressions": num(r.get("impressions"), int),
                "clicks": num(r.get("clicks"), int),
                "registrations": extract_registrations(r.get("actions")),
            })
        for c in camps.values():
            c["daily"].sort(key=lambda x: x["date"])
            data["campaigns"].append(c)

        # --- AD LEVEL ---
        ad_rows = fetch_insights(acc["id"], "ad")
        ads = {}
        for r in ad_rows:
            aid = r.get("ad_id")
            if not aid:
                continue
            if aid not in ads:
                ads[aid] = {
                    "id": aid,
                    "name": r.get("ad_name", ""),
                    "account_id": f"act_{acc['id']}",
                    "campaign": r.get("campaign_name", ""),
                    "product": detect_product(r.get("campaign_name", "")),
                    "daily": [],
                }
            ads[aid]["daily"].append({
                "date": r.get("date_start"),
                "spend": round(num(r.get("spend"))),
                "impressions": num(r.get("impressions"), int),
                "clicks": num(r.get("clicks"), int),
                "registrations": extract_registrations(r.get("actions")),
            })
        for a in ads.values():
            a["daily"].sort(key=lambda x: x["date"])
            data["ads"].append(a)

    # --- PRODUCT AGGREGATES (from campaigns) ---
    for p in ("D1", "Noma911", "DR1"):
        bucket = {}
        for c in data["campaigns"]:
            if c["product"] != p:
                continue
            for d in c["daily"]:
                dt = d["date"]
                if dt not in bucket:
                    bucket[dt] = {"date": dt, "spend": 0, "registrations": 0, "impressions": 0, "clicks": 0}
                bucket[dt]["spend"]         += d["spend"]
                bucket[dt]["registrations"] += d["registrations"]
                bucket[dt]["impressions"]   += d["impressions"]
                bucket[dt]["clicks"]        += d["clicks"]
        data["products"][p] = sorted(bucket.values(), key=lambda x: x["date"])

    # --- AD SPEND PER STAFF × PROFIT PRODUCT -----------------------
    # Duy cầm 3 TK, Phương Nam cầm 3 TK; campaign name chứa tên SP → detect_profit_product.
    account_to_staff = {f"act_{a['id']}": a["staff"] for a in ACCOUNTS}
    ad_spend_by_staff = {"DUY": {}, "PHUONG_NAM": {}}
    for c in data["campaigns"]:
        staff = account_to_staff.get(c.get("account_id"))
        if not staff:
            continue
        prod = detect_profit_product(c.get("name", ""))
        if not prod:
            continue
        bucket = ad_spend_by_staff[staff].setdefault(prod, {"_total": 0.0, "by_date": {}})
        for d in c["daily"]:
            sp = float(d.get("spend") or 0)
            if sp <= 0:
                continue
            bucket["_total"] += sp
            bucket["by_date"][d["date"]] = bucket["by_date"].get(d["date"], 0.0) + sp
    data["ad_spend_by_staff"] = ad_spend_by_staff

    # Unassigned (campaign không detect được SP) để biết campaign cần đổi tên
    unassigned = {"DUY": 0.0, "PHUONG_NAM": 0.0}
    for c in data["campaigns"]:
        staff = account_to_staff.get(c.get("account_id"))
        if not staff or detect_profit_product(c.get("name", "")):
            continue
        for d in c["daily"]:
            unassigned[staff] += float(d.get("spend") or 0)
    data["ad_spend_unassigned"] = unassigned
    print(f"   ✓ ad spend by staff: DUY={sum(v['_total'] for v in ad_spend_by_staff['DUY'].values()):,.0f}đ · "
          f"PHUONG_NAM={sum(v['_total'] for v in ad_spend_by_staff['PHUONG_NAM'].values()):,.0f}đ · "
          f"unassigned: DUY={unassigned['DUY']:,.0f}đ / PN={unassigned['PHUONG_NAM']:,.0f}đ")

    # --- PANCAKE REVENUE (injected from data/product-revenue.json) ---
    try:
        data["revenue"] = _load_json("data/product-revenue.json")
        rev_total = sum(
            (p.get("total", 0) if isinstance(p, dict) else 0)
            for p in (data["revenue"].get("products") or {}).values()
        )
        print(f"   ✓ loaded revenue snapshot: {rev_total:,.0f}₫ (delivered, {data['revenue'].get('window_days', '?')}d)")
    except Exception as e:
        print(f"   ✗ revenue load failed: {e}")
        data["revenue"] = {}

    # --- PRODUCT COSTS (injected from data/product-costs.json) ------
    try:
        costs_raw = _load_json("data/product-costs.json") or {}
        products_cost = costs_raw.get("products") or {}
        profit_costs = {}
        missing = []
        for label in PROFIT_PRODUCTS:
            key = PRODUCT_TO_COST_KEY.get(label)
            entry = products_cost.get(key) if key else None
            if entry and entry.get("gia_nhap_vnd"):
                profit_costs[label] = {
                    "gia_nhap_vnd": entry.get("gia_nhap_vnd"),
                    "gia_ban_vnd": entry.get("gia_ban_vnd"),
                    "ma_ten_goi": entry.get("ma_ten_goi"),
                    "ten": entry.get("ten"),
                    "trang_thai": entry.get("trang_thai"),
                }
            else:
                profit_costs[label] = {"gia_nhap_vnd": None, "ma_ten_goi": None}
                missing.append(f"{label} (key={key!r})")
        data["product_costs"] = profit_costs
        data["profit_products"] = PROFIT_PRODUCTS
        ok_count = sum(1 for v in profit_costs.values() if v.get("gia_nhap_vnd"))
        print(f"   ✓ loaded product costs: {ok_count}/{len(PROFIT_PRODUCTS)} SP có giá nhập")
        if missing:
            print(f"   ⚠ missing: {', '.join(missing)}")
    except Exception as e:
        print(f"   ✗ cost catalog load failed: {e}")
        data["product_costs"] = {}
        data["profit_products"] = PROFIT_PRODUCTS

    # --- COMPETITOR TRACKING (Chrome-scraped data) ---
    try:
        data["known_competitors"] = load_competitor_data()
    except Exception as e:
        print(f"   ✗ competitor data load failed: {e}")
        data["known_competitors"] = {
            "competitors": [],
            "baseline_date": "",
            "fetched_at": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M"),
            "snapshots": [],
            "errors": [{"label": "*", "message": str(e)[:300]}],
        }

    return data

# -----------------------------------------------------------------------------
# HTML GENERATION
# -----------------------------------------------------------------------------
def generate_html(data_obj):
    with open("template.html", "r", encoding="utf-8") as f:
        template = f.read()

    # Serialize DATA object (safe for JS: no </script>)
    data_js_literal = json.dumps(data_obj, ensure_ascii=False, separators=(",", ":"))
    data_js_literal = data_js_literal.replace("</", "<\\/")
    injection = f"const DATA = {data_js_literal};"

    placeholder = "/*__DATA_PLACEHOLDER__*/"
    if placeholder not in template:
        raise RuntimeError(
            "template.html is missing the /*__DATA_PLACEHOLDER__*/ marker — "
            "this is where the generated DATA constant gets injected."
        )
    return template.replace(placeholder, injection)

# -----------------------------------------------------------------------------
# NETLIFY DEPLOY (file digest API — proper way to upload single file)
# -----------------------------------------------------------------------------
def deploy_netlify(html: str):
    import hashlib
    html_bytes = html.encode("utf-8")
    sha1 = hashlib.sha1(html_bytes).hexdigest()

    # Step 1: create deploy with file manifest
    create_resp = requests.post(
        f"https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/deploys",
        headers={
            "Authorization": f"Bearer {NETLIFY_TOKEN}",
            "Content-Type": "application/json",
        },
        json={"files": {"/index.html": sha1}, "async": False},
        timeout=60,
    )
    if create_resp.status_code >= 400:
        raise RuntimeError(f"Netlify create deploy failed {create_resp.status_code}: {create_resp.text[:500]}")
    deploy = create_resp.json()
    deploy_id = deploy["id"]

    # Step 2: upload required files (Netlify tells us which files it doesn't have yet)
    required = deploy.get("required", [])
    if sha1 in required:
        up_resp = requests.put(
            f"https://api.netlify.com/api/v1/deploys/{deploy_id}/files/index.html",
            headers={
                "Authorization": f"Bearer {NETLIFY_TOKEN}",
                "Content-Type": "application/octet-stream",
            },
            data=html_bytes,
            timeout=180,
        )
        if up_resp.status_code >= 400:
            raise RuntimeError(f"Netlify upload failed {up_resp.status_code}: {up_resp.text[:500]}")
        deploy = up_resp.json()

    return deploy

# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
def main():
    print("=" * 60)
    print(f"Facebook Ads Dashboard update — {datetime.now().isoformat()}")
    print("=" * 60)

    print("\n[1/3] Fetching Facebook Ads data...")
    data = build_data()
    print(f"      ✓ {len(data['accounts'])} accounts, "
          f"{len(data['campaigns'])} campaigns, "
          f"{len(data['ads'])} ads")
    total_reg = sum(sum(d['registrations'] for d in a['daily']) for a in data['accounts'])
    total_spend = sum(sum(d['spend'] for d in a['daily']) for a in data['accounts'])
    print(f"      ✓ last {DAYS_BACK} days: {total_reg} đăng ký, {total_spend:,.0f}₫ spend")

    print("\n[2/3] Generating HTML from template...")
    html = generate_html(data)
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"      ✓ wrote {len(html):,} bytes to index.html")

    if SKIP_DEPLOY:
        print("\n[3/3] Skipping Netlify API deploy (SKIP_NETLIFY_DEPLOY is set).")
        print("      Netlify build runner will publish index.html itself.")
    else:
        if not NETLIFY_TOKEN or not NETLIFY_SITE_ID:
            raise RuntimeError(
                "NETLIFY_TOKEN and NETLIFY_SITE_ID are required when SKIP_NETLIFY_DEPLOY is not set."
            )
        print("\n[3/3] Deploying to Netlify...")
        result = deploy_netlify(html)
        print(f"      ✓ deploy id:  {result.get('id')}")
        print(f"      ✓ state:      {result.get('state')}")
        print(f"      ✓ deploy url: {result.get('deploy_ssl_url') or result.get('ssl_url')}")

    print("\n✅ Done.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ ERROR: {e}", file=sys.stderr)
        sys.exit(1)

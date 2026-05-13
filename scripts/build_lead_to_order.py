#!/usr/bin/env python3
"""
Join Pancake CRM contacts với POS orders bằng phone_last9.

Input:
  data/pancake-crm-contacts.json   (có contacts_minimal)
  data/product-revenue.json        (có orders_minimal)

Output:
  data/lead-to-order.json
    by_ad_id: {ad_id: {
       leads, leads_with_order, leads_conversion_rate,
       orders_total, orders_delivered, orders_canceled, orders_other,
       revenue_total, revenue_delivered,
       utm_campaign  (lấy từ lead nào cũng được)
    }}
    unmatched_orders   — đơn không tìm thấy lead nào
    unmatched_leads    — lead chưa lên đơn
    summary            — tổng số liệu

Attribution: last-touch trong cửa sổ 60 ngày.
Với mỗi đơn (vn_date, phone9): tìm lead cùng phone9 có created_on <= vn_date và
chênh ≤ 60 ngày, lấy lead có created_on lớn nhất → đơn đó thuộc về ad_id của lead.
"""

import os
import sys
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CRM_FILE = os.path.join(ROOT, "data", "pancake-crm-contacts.json")
POS_FILE = os.path.join(ROOT, "data", "product-revenue.json")
OUT_FILE = os.path.join(ROOT, "data", "lead-to-order.json")

ATTRIBUTION_WINDOW_DAYS = 60
PANCAKE_STATUS = {
    0: "moi", 1: "da_duyet", 2: "da_shipped", 3: "delivered",
    4: "returning", 5: "returned", 6: "canceled", 8: "dong_goi", 9: "pending",
}


# Whitelist staff thực tế trong CRM Doscom (xác nhận 2026-05-12 với user).
# Field nguoi_chay_qc trong Pancake không nhất quán — đôi khi "STAFF - PRODUCT",
# đôi khi "PRODUCT - STAFF". Map keys = upper-case canonical, values = display name.
# "NAM" là viết tắt của "PHƯƠNG NAM" → cùng 1 staff.
# "WEBSITE" là entry standalone gom các nguồn Zalo OA / Hotline / Website (không phải ad FB).
STAFF_WHITELIST = {
    "DUY": "DUY",
    "PHƯƠNG NAM": "PHƯƠNG NAM",
    "PHUONG NAM": "PHƯƠNG NAM",
    "NAM": "PHƯƠNG NAM",
    "WEBSITE": "WEBSITE",
}


def staff_from_qc(qc):
    """Bóc tên staff từ field nguoi_chay_qc. Check cả left/right vì format không
    nhất quán ('STAFF - PRODUCT' hoặc 'PRODUCT - STAFF'). Return canonical name."""
    if not qc or not isinstance(qc, str):
        return None
    qc = qc.strip()
    if not qc:
        return None
    canon = STAFF_WHITELIST.get(qc.upper())
    if canon:
        return canon
    if " - " in qc:
        for p in qc.split(" - ", 1):
            canon = STAFF_WHITELIST.get(p.strip().upper())
            if canon:
                return canon
    return None


def product_from_qc(qc):
    """Bóc tên product = phần KHÔNG match staff whitelist."""
    if not qc or not isinstance(qc, str) or " - " not in qc:
        return None
    parts = [p.strip() for p in qc.split(" - ", 1)]
    for p in parts:
        if p and p.upper() not in STAFF_WHITELIST:
            return p
    return None


def parse_iso_date(s):
    """Parse 'YYYY-MM-DDTHH:MM:SS...Z' hoặc 'YYYY-MM-DD' → date object."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except Exception:
            return None


def main():
    if not os.path.exists(CRM_FILE):
        print(f"[FATAL] Missing {CRM_FILE}", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(POS_FILE):
        print(f"[FATAL] Missing {POS_FILE}", file=sys.stderr)
        sys.exit(1)

    with open(CRM_FILE, encoding="utf-8") as f:
        crm = json.load(f)
    with open(POS_FILE, encoding="utf-8") as f:
        pos = json.load(f)

    contacts = crm.get("contacts_minimal") or []
    orders = pos.get("orders_minimal") or []
    print(f"[INFO] Loaded {len(contacts)} contacts, {len(orders)} orders")

    if not contacts:
        print("[FATAL] CRM file không có contacts_minimal — cần re-run fetch-pancake-crm "
              "với version mới (đã có phone9)", file=sys.stderr)
        sys.exit(2)
    if not orders:
        print("[FATAL] POS file không có orders_minimal — cần re-run fetch-pancake "
              "với version mới (đã có phone9)", file=sys.stderr)
        sys.exit(2)

    # ── Index leads by phone9 ──
    # 2026-05-12: bao gồm CẢ lead không có ad_id (vd: nguoi_chay_qc='WEBSITE' từ
    # Zalo OA / Hotline / Website — không qua UTM Facebook). Lead vẫn có phone9
    # nên vẫn join được với order, và staff='WEBSITE' vẫn được aggregate.
    leads_by_phone = defaultdict(list)
    for c in contacts:
        p9 = c.get("phone9")
        if not p9:
            continue
        created = parse_iso_date(c.get("created_on"))
        if not created:
            continue
        leads_by_phone[p9].append({
            "ad_id": c.get("ad_id"),
            "utm_campaign": c.get("utm_campaign"),
            "created": created,
            "trang_thai": c.get("trang_thai"),
            "owner_name": c.get("owner_name"),
            "nguoi_chay_qc": c.get("nguoi_chay_qc"),
        })
    for p9 in leads_by_phone:
        leads_by_phone[p9].sort(key=lambda x: x["created"], reverse=True)
    print(f"[INFO] {len(leads_by_phone):,} unique phone9 trong CRM")

    # ── Attribute mỗi order ──
    by_ad = defaultdict(lambda: {
        "leads": 0,
        "leads_phone9_set": set(),
        "leads_with_order_phone9_set": set(),
        "orders_total": 0,
        "orders_delivered": 0,
        "orders_canceled": 0,
        "orders_other": 0,
        "revenue_total": 0.0,
        "revenue_delivered": 0.0,
        "utm_campaign": None,
        "owner_name_counter": defaultdict(int),
        "nguoi_chay_qc_counter": defaultdict(int),
    })
    by_qc = defaultdict(lambda: {
        "leads": 0,
        "leads_phone9_set": set(),
        "leads_with_order_phone9_set": set(),
        "orders_total": 0,
        "orders_delivered": 0,
        "orders_canceled": 0,
        "orders_other": 0,
        "revenue_total": 0.0,
        "revenue_delivered": 0.0,
        "ad_ids_set": set(),
        "ad_id_revenue": defaultdict(float),
        "products_counter": defaultdict(int),
    })
    # 2026-05-13: Cross-aggregation by (staff, utm_campaign) — feed cho bảng UTM
    # trên dashboard. Key = (staff_canonical, utm_campaign_str). Mỗi bucket dùng
    # cho 1 row trong UI: leads + orders + revenue + product chính (từ nguoi_chay_qc).
    by_staff_utm = defaultdict(lambda: {
        "leads": 0,
        "leads_phone9_set": set(),
        "leads_with_order_phone9_set": set(),
        "orders_total": 0,
        "orders_delivered": 0,
        "orders_canceled": 0,
        "orders_other": 0,
        "revenue_total": 0.0,
        "revenue_delivered": 0.0,
        "products_counter": defaultdict(int),
        "ad_ids_set": set(),
    })
    # Count leads per ad_id + per qc-staff
    for c in contacts:
        ad_id = c.get("ad_id")
        p9 = c.get("phone9")

        # by_ad chỉ count contact có ad_id (= từ UTM Facebook ad)
        if ad_id:
            bucket = by_ad[ad_id]
            bucket["leads"] += 1
            if p9:
                bucket["leads_phone9_set"].add(p9)
            if not bucket["utm_campaign"]:
                bucket["utm_campaign"] = c.get("utm_campaign")
            if c.get("owner_name"):
                bucket["owner_name_counter"][c["owner_name"]] += 1
            if c.get("nguoi_chay_qc"):
                bucket["nguoi_chay_qc_counter"][c["nguoi_chay_qc"]] += 1

        # by_qc count tất cả contact match staff whitelist (bao gồm WEBSITE không có ad_id)
        staff = staff_from_qc(c.get("nguoi_chay_qc"))
        prod = product_from_qc(c.get("nguoi_chay_qc"))
        if staff:
            qb = by_qc[staff]
            qb["leads"] += 1
            if p9:
                qb["leads_phone9_set"].add(p9)
            if ad_id:
                qb["ad_ids_set"].add(ad_id)
            if prod:
                qb["products_counter"][prod] += 1

        # by_staff_utm — chỉ count lead có cả staff + utm_campaign + ad_id
        # (UTM table chỉ có ý nghĩa cho lead từ Facebook ad, có utm gắn vào campaign)
        utm = c.get("utm_campaign")
        if staff and utm and ad_id:
            sb = by_staff_utm[(staff, utm)]
            sb["leads"] += 1
            if p9:
                sb["leads_phone9_set"].add(p9)
            sb["ad_ids_set"].add(ad_id)
            if prod:
                sb["products_counter"][prod] += 1

    unmatched_orders_sample = []
    matched_orders = 0
    skipped_no_phone = 0

    for o in orders:
        p9 = o.get("phone9")
        if not p9:
            skipped_no_phone += 1
            continue
        candidates = leads_by_phone.get(p9, [])
        if not candidates:
            if len(unmatched_orders_sample) < 20:
                unmatched_orders_sample.append({
                    "order_id": o.get("order_id"),
                    "phone9": p9,
                    "vn_date": o.get("vn_date"),
                    "source_name": o.get("source_name"),
                    "cod": o.get("cod"),
                })
            continue

        # Last-touch attribution: lead gần nhất TRƯỚC order trong cửa sổ 60 ngày
        order_date = parse_iso_date(o.get("vn_date"))
        attr_lead = None
        if order_date:
            for lead in candidates:  # đã sort DESC
                delta = (order_date - lead["created"]).days
                if -1 <= delta <= ATTRIBUTION_WINDOW_DAYS:
                    # Cho phép order sớm hơn lead 1 ngày (timezone slack)
                    attr_lead = lead
                    break
        if not attr_lead:
            # Order ngoài window — vẫn match phone nhưng không attribute. Coi như "pre-lead order".
            if len(unmatched_orders_sample) < 20:
                unmatched_orders_sample.append({
                    "order_id": o.get("order_id"),
                    "phone9": p9,
                    "vn_date": o.get("vn_date"),
                    "source_name": o.get("source_name"),
                    "cod": o.get("cod"),
                    "note": "phone match nhưng ngoài window 60d",
                    "nearest_lead_created": candidates[0]["created"].isoformat() if candidates else None,
                })
            continue

        matched_orders += 1
        cod = float(o.get("cod") or 0)
        status = o.get("status")
        ad_id = attr_lead.get("ad_id")

        # by_ad chỉ count đơn có ad_id (= từ UTM Facebook ad)
        if ad_id:
            bucket = by_ad[ad_id]
            bucket["orders_total"] += 1
            bucket["leads_with_order_phone9_set"].add(p9)
            bucket["revenue_total"] += cod
            if status == 3:
                bucket["orders_delivered"] += 1
                bucket["revenue_delivered"] += cod
            elif status == 6:
                bucket["orders_canceled"] += 1
            else:
                bucket["orders_other"] += 1

        # by_qc count đơn theo staff — kể cả lead không có ad_id (WEBSITE)
        staff = staff_from_qc(attr_lead.get("nguoi_chay_qc"))
        if staff:
            qb = by_qc[staff]
            qb["orders_total"] += 1
            qb["leads_with_order_phone9_set"].add(p9)
            qb["revenue_total"] += cod
            if ad_id:
                qb["ad_id_revenue"][ad_id] += cod
            if status == 3:
                qb["orders_delivered"] += 1
                qb["revenue_delivered"] += cod
            elif status == 6:
                qb["orders_canceled"] += 1
            else:
                qb["orders_other"] += 1

        # by_staff_utm — chỉ count đơn nếu lead có cả staff + utm + ad_id
        utm = attr_lead.get("utm_campaign")
        if staff and utm and ad_id:
            sb = by_staff_utm[(staff, utm)]
            sb["orders_total"] += 1
            sb["leads_with_order_phone9_set"].add(p9)
            sb["revenue_total"] += cod
            if status == 3:
                sb["orders_delivered"] += 1
                sb["revenue_delivered"] += cod
            elif status == 6:
                sb["orders_canceled"] += 1
            else:
                sb["orders_other"] += 1

    # ── Finalize ──
    out_by_ad = {}
    total_leads = 0
    total_leads_with_order = 0
    total_orders = 0
    total_revenue = 0.0
    total_revenue_delivered = 0.0
    for ad_id, b in by_ad.items():
        leads = b["leads"]
        leads_with_order = len(b["leads_with_order_phone9_set"])
        top_owner = max(b["owner_name_counter"].items(), key=lambda x: x[1])[0] \
            if b["owner_name_counter"] else None
        top_runner = max(b["nguoi_chay_qc_counter"].items(), key=lambda x: x[1])[0] \
            if b["nguoi_chay_qc_counter"] else None
        out_by_ad[ad_id] = {
            "ad_id": ad_id,
            "utm_campaign": b["utm_campaign"],
            "leads": leads,
            "leads_with_phone9": len(b["leads_phone9_set"]),
            "leads_with_order": leads_with_order,
            "leads_conversion_rate": round(leads_with_order / leads * 100, 2) if leads else 0.0,
            "orders_total": b["orders_total"],
            "orders_delivered": b["orders_delivered"],
            "orders_canceled": b["orders_canceled"],
            "orders_other": b["orders_other"],
            "revenue_total": round(b["revenue_total"]),
            "revenue_delivered": round(b["revenue_delivered"]),
            "top_owner": top_owner,
            "top_nguoi_chay_qc": top_runner,
        }
        total_leads += leads
        total_leads_with_order += leads_with_order
        total_orders += b["orders_total"]
        total_revenue += b["revenue_total"]
        total_revenue_delivered += b["revenue_delivered"]

    # ── Finalize by_qc (staff-level từ nguoi_chay_qc) ──
    out_by_qc = {}
    for staff, q in by_qc.items():
        leads = q["leads"]
        leads_with_order = len(q["leads_with_order_phone9_set"])
        top_ads = sorted(q["ad_id_revenue"].items(), key=lambda x: -x[1])[:5]
        top_products = sorted(q["products_counter"].items(), key=lambda x: -x[1])[:5]
        out_by_qc[staff] = {
            "staff": staff,
            "leads": leads,
            "leads_with_phone9": len(q["leads_phone9_set"]),
            "leads_with_order": leads_with_order,
            "leads_conversion_rate": round(leads_with_order / leads * 100, 2) if leads else 0.0,
            "orders_total": q["orders_total"],
            "orders_delivered": q["orders_delivered"],
            "orders_canceled": q["orders_canceled"],
            "orders_other": q["orders_other"],
            "revenue_total": round(q["revenue_total"]),
            "revenue_delivered": round(q["revenue_delivered"]),
            "unique_ad_ids": len(q["ad_ids_set"]),
            "top_ad_ids_by_revenue": [{"ad_id": a, "revenue": round(r)} for a, r in top_ads],
            "top_products_by_leads": [{"product": p, "leads": n} for p, n in top_products],
        }
    # Sort theo revenue_total DESC để dashboard render từ cao xuống thấp
    out_by_qc = dict(sorted(out_by_qc.items(), key=lambda kv: -kv[1]["revenue_total"]))

    # ── Finalize by_staff_utm (cross: staff × utm_campaign) ──
    # Output shape: {staff_canonical: [rows]} — frontend render 1 bảng per staff.
    # Mỗi row: utm_campaign, product (top từ nguoi_chay_qc), leads, orders, conv%, revenue.
    out_by_staff_utm = defaultdict(list)
    for (staff, utm), s in by_staff_utm.items():
        leads = s["leads"]
        leads_with_order = len(s["leads_with_order_phone9_set"])
        top_product = max(s["products_counter"].items(), key=lambda x: x[1])[0] \
            if s["products_counter"] else None
        out_by_staff_utm[staff].append({
            "utm_campaign": utm,
            "product": top_product,
            "leads": leads,
            "leads_with_phone9": len(s["leads_phone9_set"]),
            "leads_with_order": leads_with_order,
            "leads_conversion_rate": round(leads_with_order / leads * 100, 2) if leads else 0.0,
            "orders_total": s["orders_total"],
            "orders_delivered": s["orders_delivered"],
            "orders_canceled": s["orders_canceled"],
            "orders_other": s["orders_other"],
            "revenue_total": round(s["revenue_total"]),
            "revenue_delivered": round(s["revenue_delivered"]),
            "unique_ad_ids": len(s["ad_ids_set"]),
        })
    # Sort rows trong mỗi staff theo revenue_total DESC
    for staff in out_by_staff_utm:
        out_by_staff_utm[staff].sort(key=lambda r: -r["revenue_total"])
    out_by_staff_utm = dict(out_by_staff_utm)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "crm_generated_at": crm.get("generated_at"),
        "pos_generated_at": pos.get("generated_at"),
        "attribution_window_days": ATTRIBUTION_WINDOW_DAYS,
        "summary": {
            "total_leads_with_ad_id": total_leads,
            "total_leads_with_order": total_leads_with_order,
            "leads_conversion_rate": round(total_leads_with_order / total_leads * 100, 2)
                if total_leads else 0.0,
            "total_orders_attributed": total_orders,
            "total_orders_in_pos": len(orders),
            "orders_skipped_no_phone": skipped_no_phone,
            "orders_unmatched": len(orders) - matched_orders - skipped_no_phone,
            "revenue_attributed_total": round(total_revenue),
            "revenue_attributed_delivered": round(total_revenue_delivered),
            "unique_ad_ids_with_orders": sum(1 for v in out_by_ad.values() if v["orders_total"] > 0),
            "unique_qc_staff": len(out_by_qc),
        },
        "by_ad_id": out_by_ad,
        "by_nguoi_chay_qc": out_by_qc,
        "by_staff_utm": out_by_staff_utm,
        "unmatched_orders_sample": unmatched_orders_sample,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"[OK] Wrote {OUT_FILE}")
    print(f"     {total_leads:,} leads → {total_leads_with_order:,} có đơn "
          f"({out['summary']['leads_conversion_rate']}%)")
    print(f"     {total_orders:,} đơn attributed / {len(orders):,} tổng đơn "
          f"({skipped_no_phone:,} skip do thiếu phone, "
          f"{len(orders) - matched_orders - skipped_no_phone:,} unmatched)")
    print(f"     Revenue attributed: {total_revenue:,.0f}đ "
          f"(delivered: {total_revenue_delivered:,.0f}đ)")
    print(f"     {len(out_by_qc)} staff QC — top 5 by revenue:")
    for i, (staff, v) in enumerate(list(out_by_qc.items())[:5], 1):
        print(f"       {i}. {staff:<15s} leads={v['leads']:>4} orders={v['orders_total']:>4} "
              f"conv={v['leads_conversion_rate']:>5.1f}% rev={v['revenue_total']:,}đ")


if __name__ == "__main__":
    main()

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


def staff_from_qc(qc):
    """Bóc tên staff từ field nguoi_chay_qc có format 'STAFF - PRODUCT'.
    'DUY - DR1' → 'DUY'. None nếu trống."""
    if not qc or not isinstance(qc, str):
        return None
    parts = qc.split(" - ", 1)
    s = parts[0].strip() if parts else ""
    return s or None


def product_from_qc(qc):
    """Bóc tên product từ field nguoi_chay_qc 'STAFF - PRODUCT' → 'PRODUCT'."""
    if not qc or not isinstance(qc, str):
        return None
    parts = qc.split(" - ", 1)
    if len(parts) < 2:
        return None
    p = parts[1].strip()
    return p or None


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
    # Mỗi phone9 có thể có nhiều lead (khách gọi lại, nhiều ad). Sort by created_on DESC
    # để khi attribute đơn lấy lead gần nhất trước đơn.
    leads_by_phone = defaultdict(list)
    for c in contacts:
        p9 = c.get("phone9")
        ad_id = c.get("ad_id")
        if not p9 or not ad_id:
            continue
        created = parse_iso_date(c.get("created_on"))
        if not created:
            continue
        leads_by_phone[p9].append({
            "ad_id": ad_id,
            "utm_campaign": c.get("utm_campaign"),
            "created": created,
            "trang_thai": c.get("trang_thai"),
            "owner_name": c.get("owner_name"),
            "nguoi_chay_qc": c.get("nguoi_chay_qc"),
        })
    for p9 in leads_by_phone:
        leads_by_phone[p9].sort(key=lambda x: x["created"], reverse=True)
    print(f"[INFO] {len(leads_by_phone):,} unique phone9 có lead với ad_id")

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
    # Count leads per ad_id + per qc-staff
    for c in contacts:
        ad_id = c.get("ad_id")
        p9 = c.get("phone9")
        if not ad_id:
            continue
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

        staff = staff_from_qc(c.get("nguoi_chay_qc"))
        if staff:
            qb = by_qc[staff]
            qb["leads"] += 1
            if p9:
                qb["leads_phone9_set"].add(p9)
            qb["ad_ids_set"].add(ad_id)
            prod = product_from_qc(c.get("nguoi_chay_qc"))
            if prod:
                qb["products_counter"][prod] += 1

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

        ad_id = attr_lead["ad_id"]
        bucket = by_ad[ad_id]
        bucket["orders_total"] += 1
        bucket["leads_with_order_phone9_set"].add(p9)
        cod = float(o.get("cod") or 0)
        bucket["revenue_total"] += cod
        status = o.get("status")
        if status == 3:
            bucket["orders_delivered"] += 1
            bucket["revenue_delivered"] += cod
        elif status == 6:
            bucket["orders_canceled"] += 1
        else:
            bucket["orders_other"] += 1
        matched_orders += 1

        # Attribute đơn cho staff (= left part của nguoi_chay_qc của lead match)
        staff = staff_from_qc(attr_lead.get("nguoi_chay_qc"))
        if staff:
            qb = by_qc[staff]
            qb["orders_total"] += 1
            qb["leads_with_order_phone9_set"].add(p9)
            qb["revenue_total"] += cod
            qb["ad_id_revenue"][ad_id] += cod
            if status == 3:
                qb["orders_delivered"] += 1
                qb["revenue_delivered"] += cod
            elif status == 6:
                qb["orders_canceled"] += 1
            else:
                qb["orders_other"] += 1

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

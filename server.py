#!/usr/bin/env python3

from __future__ import annotations

import datetime as dt
import gzip
import json
import mimetypes
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "public"
DATA_FILE = STATIC_DIR / "chatbot_data.js"
SHEET_DATA_FILE = STATIC_DIR / "sheet_report_data.js"
LEVANTA_BASE = "https://app.levanta.io/api/creator/v1"
DEFAULT_MONTHS = [
    ("February", 1, 2026),
    ("March", 2, 2026),
    ("April", 3, 2026),
    ("May", 4, 2026),
    ("June", 5, 2026),
]
DEFAULT_MARKETPLACES = ["US", "CA", "UK", "FR", "DE"]
MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


def number(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def money(value):
    return round(number(value), 2)


def first_present_number(source, keys):
    for key in keys:
        value = source.get(key)
        if value is None or value == "":
            continue
        return money(value)
    return None


def first_present_string(source, keys):
    for key in keys:
        value = source.get(key) if isinstance(source, dict) else None
        if value is None or value == "":
            continue
        return str(value).strip()
    return ""


def levanta_revenue_made(item):
    return first_present_number(
        item,
        (
            "revenueMade",
            "sales",
            "revenue",
            "salesAmount",
            "totalSales",
        ),
    ) or 0.0


def levanta_commission_made(item):
    direct = first_present_number(
        item,
        (
            "commissionMade",
            "totalCommission",
            "commissionOwed",
            "expectedPaymentAmount",
        ),
    )
    if direct is not None:
        return direct
    return money(number(item.get("commission")) + number(item.get("cpcCommission")))


def normalize(value):
    return "".join(ch for ch in str(value or "").lower().replace("&", "and") if ch.isalnum())


def tier_rank(offer):
    return {
        "Tier 1": 1,
        "Tier 2": 2,
        "Tier 3": 3,
        "Tier 4": 4,
        "BLACK TIER": 9,
    }.get(str((offer or {}).get("tier") or ""), 8)


def best_offer(candidates):
    valid = [offer for offer in candidates if offer]
    if not valid:
        return {}
    return sorted(
        valid,
        key=lambda offer: (
            tier_rank(offer),
            -number(offer.get("salesAmount")),
            str(offer.get("brand") or ""),
        ),
    )[0]


def safe_brand_match(offer_brand, merchant_name):
    if not offer_brand or not merchant_name:
        return False
    if offer_brand == merchant_name:
        return True
    shorter = min(len(offer_brand), len(merchant_name))
    longer = max(len(offer_brand), len(merchant_name))
    return shorter >= 5 and shorter / longer >= 0.65 and (
        offer_brand in merchant_name or merchant_name in offer_brand
    )


def load_static_data():
    if not DATA_FILE.exists():
        return {}, {}, {}, []
    text = DATA_FILE.read_text(encoding="utf-8")
    prefix = "window.CHATBOT_DATA="
    if not text.startswith(prefix):
        return {}, {}, {}, []
    payload = json.loads(text[len(prefix) :].rstrip(";\n"))
    raw_by_id = {}
    raw_by_brand = {}
    offers = payload.get("offers", [])
    for offer in offers:
        merchant_id = str(offer.get("merchantId") or "").strip()
        brand = normalize(offer.get("brand"))
        if merchant_id:
            raw_by_id.setdefault(merchant_id, []).append(offer)
        if brand:
            raw_by_brand.setdefault(brand, []).append(offer)
    by_id = {merchant_id: best_offer(matches) for merchant_id, matches in raw_by_id.items()}
    by_brand = {brand: best_offer(matches) for brand, matches in raw_by_brand.items()}
    return payload, by_id, by_brand, offers


STATIC_DATA, OFFERS_BY_ID, OFFERS_BY_BRAND, STATIC_OFFERS = load_static_data()


def load_sheet_payment_cycles():
    if not SHEET_DATA_FILE.exists():
        return {}
    text = SHEET_DATA_FILE.read_text(encoding="utf-8")
    prefix = "window.SHEET_REPORT_DATA="
    if not text.startswith(prefix):
        return {}
    payload = json.loads(text[len(prefix) :].rstrip(";\n"))
    cycles = {}
    for sheet in payload.get("sheets", []):
        for row in sheet.get("rows", []):
            cycle = number(row.get("Payment Cycle"))
            if cycle <= 0:
                continue
            for key in payment_cycle_keys(
                row.get("Merchant ID") or row.get("Merchant Id") or row.get("merchantId"),
                row.get("Merchant Name") or row.get("Brand") or row.get("brand"),
            ):
                cycles[key] = int(round(cycle))
    return cycles


def payment_cycle_keys(merchant_id, merchant_name):
    keys = []
    clean_id = str(merchant_id or "").strip()
    clean_name = normalize(merchant_name)
    if clean_id:
        keys.append(f"id:{clean_id}")
    if clean_name:
        keys.append(f"name:{clean_name}")
    return keys


SHEET_PAYMENT_CYCLES = load_sheet_payment_cycles()


def sheet_payment_cycle_for(merchant_id, merchant_name):
    for key in payment_cycle_keys(merchant_id, merchant_name):
        cycle = SHEET_PAYMENT_CYCLES.get(key)
        if cycle and cycle > 0:
            return cycle
    return 0


def explicit_payment_cycle_from(source):
    keys = (
        "paymentCycle",
        "payment_cycle",
        "paymentCycleDays",
        "payment_cycle_days",
        "paymentTermDays",
        "payment_terms_days",
        "paymentTermsDays",
        "paymentDelayDays",
        "payoutDelayDays",
        "netDays",
        "net_days",
    )
    for key in keys:
        cycle = number(source.get(key) if isinstance(source, dict) else None)
        if cycle > 0:
            return int(round(cycle))
    return 0


def resolve_payment_cycle(record, offer, network):
    sheet_cycle = sheet_payment_cycle_for(
        (record or {}).get("merchantId") or (record or {}).get("brand_id") or (offer or {}).get("merchantId"),
        (record or {}).get("merchantName") or (record or {}).get("brand") or (offer or {}).get("brand"),
    )
    if sheet_cycle > 0:
        return normalized_payment_cycle(sheet_cycle, (offer or {}).get("network") or network)
    api_cycle = explicit_payment_cycle_from(record or {})
    if api_cycle > 0:
        return normalized_payment_cycle(api_cycle, network or (offer or {}).get("network"))
    return normalized_payment_cycle(None, network or (offer or {}).get("network"))


def infer_region_from_text(value):
    parts = str(value or "").replace("-", " ").replace("_", " ").replace("(", " ").replace(")", " ").split()
    aliases = {"USA": "US", "GB": "UK"}
    for part in reversed(parts):
        clean = "".join(ch for ch in part.upper() if ch.isalpha())
        clean = aliases.get(clean, clean)
        if clean in {"US", "UK", "DE", "FR", "CA", "AU"}:
            return clean
    return ""


def normalize_region(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    marketplace = re.sub(r"^https?://", "", raw, flags=re.I)
    marketplace = re.sub(r"^www\.", "", marketplace, flags=re.I)
    marketplace = marketplace.split("/")[0].split("?")[0].split("#")[0].lower()
    compact = re.sub(r"[^a-z0-9.]+", "", marketplace)
    aliases = {
        "amazon.com": "US",
        "com": "US",
        "us": "US",
        "usa": "US",
        "unitedstates": "US",
        "amazon.ca": "CA",
        "ca": "CA",
        "can": "CA",
        "canada": "CA",
        "amazon.co.uk": "UK",
        "amazon.uk": "UK",
        "co.uk": "UK",
        "uk": "UK",
        "gb": "UK",
        "gbr": "UK",
        "unitedkingdom": "UK",
        "amazon.fr": "FR",
        "fr": "FR",
        "fra": "FR",
        "france": "FR",
        "amazon.de": "DE",
        "de": "DE",
        "deu": "DE",
        "germany": "DE",
        "deutschland": "DE",
    }
    return aliases.get(compact, raw.upper())


def region_from_item(item, marketplace, offer=None):
    brand = item.get("brand") if isinstance(item.get("brand"), dict) else {}
    region = first_present_string(
        item,
        (
            "region",
            "marketplace",
            "marketPlace",
            "marketplaceCode",
            "country",
            "countryCode",
            "locale",
        ),
    ) or first_present_string(brand, ("region", "marketplace", "country", "countryCode"))
    region = normalize_region(region)
    if region and region != "ALL":
        return region
    if marketplace and str(marketplace).lower() != "all":
        return normalize_region(marketplace)
    return normalize_region(infer_region_from_text((offer or {}).get("brand") or brand.get("name")))


def offer_for_payment(merchant_id, merchant_name):
    clean_id = str(merchant_id or "").strip()
    if clean_id and clean_id in OFFERS_BY_ID:
        return OFFERS_BY_ID[clean_id]

    clean_name = normalize(merchant_name)
    if clean_name and clean_name in OFFERS_BY_BRAND:
        return OFFERS_BY_BRAND[clean_name]

    fuzzy = [
        offer
        for offer in STATIC_OFFERS
        if safe_brand_match(normalize(offer.get("brand")), clean_name)
    ]
    return best_offer(fuzzy)


def availability_date(year, zero_based_month, payment_cycle=None):
    # Levanta invoice API uses zero-based report months. If the sheet gives us a
    # merchant-specific payment cycle, use report-month day 2 + that cycle.
    if payment_cycle:
        try:
            return (dt.date(year, zero_based_month + 1, 2) + dt.timedelta(days=int(float(payment_cycle)))).isoformat()
        except (TypeError, ValueError):
            pass

    # Default rule: checkable on day 3 two calendar months after report month.
    month_index = zero_based_month + 2
    y = year + month_index // 12
    m = month_index % 12 + 1
    return dt.date(y, m, 3).isoformat()


def normalized_payment_cycle(value=None, network=None):
    if str(network or "").strip().lower() == "wayward":
        return 105
    cycle = number(value)
    return int(round(cycle)) if cycle > 0 else 60


TIER_ORDER = {
    "Tier 1": 1,
    "Tier 2": 2,
    "Tier 3": 3,
    "Tier 4": 4,
    "BLACK TIER": 9,
}


def offer_sort_key(offer):
    return (
        TIER_ORDER.get(str(offer.get("tier") or ""), 8),
        -number(offer.get("salesAmount")),
    )


def offers_for_brand(merchant_name):
    brand_key = normalize(merchant_name)
    if not brand_key:
        return []
    return [
        offer
        for offer in STATIC_DATA.get("offers", [])
        if normalize(offer.get("brand")) == brand_key
    ]


def offer_for_payment_source(merchant_id="", merchant_name="", network=None):
    merchant_id = str(merchant_id or "").strip()
    if merchant_id and merchant_id in OFFERS_BY_ID:
        offer = OFFERS_BY_ID[merchant_id]
        if normalize(network) != "levanta" or normalize(offer.get("network")) == "levanta":
            return offer

    candidates = offers_for_brand(merchant_name)
    if normalize(network) == "levanta":
        levanta_candidates = [
            offer
            for offer in candidates
            if normalize(offer.get("network")) == "levanta"
        ]
        if levanta_candidates:
            return sorted(levanta_candidates, key=offer_sort_key)[0]

    brand_key = normalize(merchant_name)
    return OFFERS_BY_BRAND.get(brand_key) or (sorted(candidates, key=offer_sort_key)[0] if candidates else {})


def payment_status(raw_status, expected, paid, available_date, baseline_date=None):
    raw = str(raw_status or "").lower()
    today = dt.date.today()
    cycle_due = dt.date.fromisoformat(available_date) if available_date else None
    baseline_due = dt.date.fromisoformat(baseline_date) if baseline_date else cycle_due
    remaining = max(0.0, expected - paid)
    if raw == "paid" or (expected > 0 and paid >= expected - 0.01 and "late" not in raw and "unpaid" not in raw):
        return "Paid"
    if expected <= 0 and paid <= 0:
        if "pending" in raw:
            return "Pending"
        return "Unknown"
    if baseline_due and today <= baseline_due:
        return "Pending"
    if cycle_due and today > cycle_due and remaining > 0.01:
        return "Overdue"
    if paid > 0 and remaining > 0.01:
        return "Partial"
    return "Unpaid" if remaining > 0.01 or "pending" in raw or "late" in raw or "unpaid" in raw else "Unknown"


def payment_merchant_key(record):
    return str(record.get("merchantId") or normalize(record.get("merchantName") or record.get("brand"))).strip()


def has_payable_payment_amount(record):
    return any(
        number(record.get(key)) > 0
        for key in ("commissionMade", "expectedPaymentAmount", "paidAmount", "remainingAmount")
    )


def has_payment_revenue_or_commission(record):
    return number(record.get("revenueMade")) > 0 or number(record.get("commissionMade")) > 0


def is_trackable_payment_record(record):
    return has_payment_revenue_or_commission(record)


def pending_placeholder_record(source, month_name, zero_based_month, year):
    source_merchant_id = str(source.get("merchantId") or "").strip()
    merchant_name = str(source.get("merchantName") or source.get("brand") or source_merchant_id or "Unknown merchant").strip()
    offer = offer_for_payment_source(source_merchant_id, merchant_name, source.get("network"))
    merchant_id = str(offer.get("merchantId") or source_merchant_id).strip()
    levanta_brand_id = str(source.get("levantaBrandId") or "").strip()
    if not levanta_brand_id and normalize(source.get("network")) == "levanta" and source_merchant_id != merchant_id:
        levanta_brand_id = source_merchant_id
    network = source.get("network") or offer.get("network") or "Levanta"
    payment_cycle = resolve_payment_cycle(source, offer, network)
    month_key = f"{year}-{zero_based_month + 1:02d}"
    return {
        "id": f"{merchant_id or normalize(merchant_name)}::{month_key}::pending-placeholder",
        "merchantId": merchant_id,
        "levantaBrandId": levanta_brand_id,
        "merchantName": merchant_name,
        "network": network,
        "region": source.get("region") or region_from_item(source, source.get("marketplace"), offer),
        "tier": source.get("tier") or offer.get("tier") or "Unknown",
        "category": source.get("category") or offer.get("category") or offer.get("levantaCategory") or "Uncategorized",
        "categoryPath": source.get("categoryPath") or offer.get("categoryPath"),
        "mainCategory": source.get("mainCategory") or offer.get("mainCategory"),
        "subCategory": source.get("subCategory") or offer.get("subCategory"),
        "mainCategoryCn": source.get("mainCategoryCn") or offer.get("mainCategoryCn"),
        "subCategoryCn": source.get("subCategoryCn") or offer.get("subCategoryCn"),
        "reportMonth": month_name,
        "reportYear": year,
        "reportMonthKey": month_key,
        "revenueMade": 0,
        "commissionMade": 0,
        "expectedPaymentAmount": 0,
        "paidAmount": 0,
        "remainingAmount": 0,
        "paymentCycle": payment_cycle,
        "paymentAvailabilityDate": availability_date(year, zero_based_month, payment_cycle),
        "expectedPaymentDate": availability_date(year, zero_based_month, payment_cycle),
        "paymentStatus": "Pending",
        "rawStatus": "pending",
        "lastCheckedDate": dt.date.today().isoformat(),
        "currency": source.get("currency") or "USD",
        "isPlaceholder": True,
        "notes": "No Levanta invoice row found yet; marked pending until the month becomes payable or Levanta returns a final status.",
    }


def with_pending_placeholders(records, months):
    existing = {
        f"{payment_merchant_key(record)}::{record.get('reportMonthKey')}"
        for record in records
        if payment_merchant_key(record)
    }
    merchants = {}
    for record in records:
        key = payment_merchant_key(record)
        if key and key not in merchants:
            merchants[key] = record

    additions = []
    for merchant_key, merchant in merchants.items():
        for month_name, zero_based_month, year in months:
            month_key = f"{year}-{zero_based_month + 1:02d}"
            key = f"{merchant_key}::{month_key}"
            if key in existing:
                continue
            additions.append(pending_placeholder_record(merchant, month_name, zero_based_month, year))
            existing.add(key)
    return records + additions


def levanta_get(path, params, api_key):
    url = f"{LEVANTA_BASE}{path}?{urlencode(params)}"
    last_error = ""
    for attempt in range(3):
        request = Request(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "User-Agent": "YeahPromos-Offer-Intelligence/1.0",
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError:
            raise
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            last_error = str(error)
        if attempt < 2:
            time.sleep(1 + attempt)
    raise URLError(last_error[:500])


def fetch_invoice_items(month, year, api_key, marketplace="all"):
    cursor = None
    items = []
    while True:
        params = {
            "limit": 100,
            "marketplace": str(marketplace or "all").lower(),
            "month": month,
            "year": year,
        }
        if cursor:
            params["cursor"] = cursor
        data = levanta_get("/invoices/items", params, api_key)
        items.extend(data.get("items", []))
        cursor = data.get("cursor")
        if not cursor:
            break
    return items


def invoice_item_identity(item):
    brand = item.get("brand") if isinstance(item.get("brand"), dict) else {}
    for key in ("id", "invoiceItemId", "invoice_item_id", "paymentId", "transactionId"):
        value = str(item.get(key) or "").strip()
        if value:
            return f"id::{value}"
    brand_id = str(brand.get("id") or item.get("brandId") or "").strip()
    brand_name = str(brand.get("name") or item.get("brandName") or item.get("merchantName") or "").strip()
    region = first_present_string(
        item,
        ("region", "marketplace", "marketPlace", "marketplaceCode", "country", "countryCode", "locale"),
    )
    return "::".join(
        [
            normalize(brand_id or brand_name),
            normalize_region(region),
            str(item.get("status") or ""),
            str(item.get("currency") or ""),
            f"{levanta_revenue_made(item):.2f}",
            f"{levanta_commission_made(item):.2f}",
        ]
    )


def marketplaces_from_query(query):
    raw = ",".join(query.get("marketplaces", []) + query.get("marketplace", []))
    if not raw:
        return DEFAULT_MARKETPLACES
    values = [normalize_region(part) for part in raw.replace("|", ",").split(",")]
    values = [value for value in values if value]
    if not values or "ALL" in values:
        return ["all"]
    return values


def fetch_invoice_items_for_marketplaces(month, year, api_key, marketplaces):
    if marketplaces == ["all"]:
        return [(item, "all") for item in fetch_invoice_items(month, year, api_key, "all")]

    rows = []
    errors = []
    seen = set()
    for marketplace in marketplaces:
        try:
            for item in fetch_invoice_items(month, year, api_key, marketplace):
                key = invoice_item_identity(item)
                if key in seen:
                    continue
                seen.add(key)
                rows.append((item, marketplace))
        except HTTPError as error:
            errors.append((marketplace, error))

    if rows and errors:
        failed = ", ".join(marketplace for marketplace, _error in errors)
        raise URLError(f"Levanta marketplace sync incomplete for {failed}; refusing partial payment data")
    if rows:
        return rows

    try:
        return [(item, "all") for item in fetch_invoice_items(month, year, api_key, "all")]
    except HTTPError:
        if errors:
            raise errors[0][1]
        raise


def months_from_query(query):
    start = query.get("start", ["2026-02"])[0]
    end = query.get("end", ["2026-06"])[0]
    try:
        start_year, start_month = [int(part) for part in start.split("-", 1)]
        end_year, end_month = [int(part) for part in end.split("-", 1)]
    except ValueError:
        return DEFAULT_MONTHS

    months = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        months.append((MONTH_NAMES[month - 1], month - 1, year))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months[:18]


def normalize_invoice_item(item, month_name, zero_based_month, year, marketplace="all"):
    brand = item.get("brand") or {}
    levanta_brand_id = str(brand.get("id") or "").strip()
    merchant_name = str(brand.get("name") or "").strip()
    offer = offer_for_payment_source(levanta_brand_id, merchant_name, "Levanta")
    merchant_id = str(offer.get("merchantId") or levanta_brand_id).strip()
    revenue_made = levanta_revenue_made(item)
    commission_made = levanta_commission_made(item)
    expected = commission_made
    raw = str(item.get("status") or "unknown")
    paid = expected if raw.lower() == "paid" else money(item.get("paidAmount"))
    remaining = max(0.0, money(expected - paid))
    payment_cycle = resolve_payment_cycle({**item, "merchantId": merchant_id, "merchantName": merchant_name}, offer, offer.get("network") or "Levanta")
    available = availability_date(year, zero_based_month, payment_cycle)
    baseline_available = availability_date(year, zero_based_month, 60)
    month_key = f"{year}-{zero_based_month + 1:02d}"
    status = payment_status(raw, expected, paid, available, baseline_available)
    note_by_status = {
        "Paid": "Payment confirmed by Levanta API.",
        "Pending": "Payment is still inside the 60-day network baseline.",
        "Unpaid": f"Payment has passed the 60-day baseline but is not past the {payment_cycle}-day payment cycle.",
        "Overdue": f"Payment is past the {payment_cycle}-day payment cycle and needs follow-up.",
        "Partial": "Partial payment found; remaining amount needs follow-up.",
    }
    return {
        "id": f"{merchant_id or normalize(merchant_name)}::{month_key}::{normalize(merchant_name)}",
        "merchantId": merchant_id,
        "levantaBrandId": levanta_brand_id,
        "merchantName": merchant_name,
        "network": "Levanta",
        "region": region_from_item(item, marketplace, offer),
        "tier": offer.get("tier") or "Unknown",
        "category": offer.get("category") or offer.get("levantaCategory") or "Uncategorized",
        "categoryPath": offer.get("categoryPath"),
        "mainCategory": offer.get("mainCategory"),
        "subCategory": offer.get("subCategory"),
        "mainCategoryCn": offer.get("mainCategoryCn"),
        "subCategoryCn": offer.get("subCategoryCn"),
        "reportMonth": month_name,
        "reportYear": year,
        "reportMonthKey": month_key,
        "revenueMade": revenue_made,
        "commissionMade": commission_made,
        "expectedPaymentAmount": expected,
        "paidAmount": paid,
        "remainingAmount": remaining,
        "paymentCycle": payment_cycle,
        "paymentAvailabilityDate": available,
        "expectedPaymentDate": available,
        "paymentStatus": status,
        "rawStatus": raw,
        "lastCheckedDate": dt.date.today().isoformat(),
        "currency": item.get("currency") or "USD",
        "notes": note_by_status.get(status, "Payment status returned by Levanta API needs review."),
    }


def payment_summary(records):
    merchant_ids = {record.get("merchantId") or record.get("merchantName") for record in records}
    unpaid = {record.get("merchantId") or record.get("merchantName") for record in records if record.get("paymentStatus") == "Unpaid"}
    pending = {record.get("merchantId") or record.get("merchantName") for record in records if record.get("paymentStatus") == "Pending"}
    paid = {record.get("merchantId") or record.get("merchantName") for record in records if record.get("paymentStatus") == "Paid"}
    overdue = {record.get("merchantId") or record.get("merchantName") for record in records if record.get("paymentStatus") == "Overdue"}
    return {
        "recordCount": len(records),
        "merchantCount": len([mid for mid in merchant_ids if mid]),
        "totalRevenueMade": money(sum(number(record.get("revenueMade")) for record in records)),
        "totalCommissionMade": money(sum(number(record.get("commissionMade")) for record in records)),
        "totalPaidAmount": money(sum(number(record.get("paidAmount")) for record in records)),
        "totalRemainingAmount": money(sum(number(record.get("remainingAmount")) for record in records)),
        "totalUnpaidAmount": money(sum(number(record.get("remainingAmount")) for record in records if record.get("paymentStatus") == "Unpaid")),
        "totalPendingAmount": money(sum(number(record.get("remainingAmount")) for record in records if record.get("paymentStatus") == "Pending")),
        "totalOverdueAmount": money(sum(number(record.get("remainingAmount")) for record in records if record.get("paymentStatus") == "Overdue")),
        "unpaidMerchantCount": len([mid for mid in unpaid if mid]),
        "pendingMerchantCount": len([mid for mid in pending if mid]),
        "paidMerchantCount": len([mid for mid in paid if mid]),
        "overdueMerchantCount": len([mid for mid in overdue if mid]),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "OfferChatbot/1.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/levanta/payments":
            self.handle_payments_api(parsed)
            return
        self.handle_static(parsed.path)

    def handle_payments_api(self, parsed):
        api_key = os.environ.get("LEVANTA_API_KEY", "").strip()
        if not api_key:
            self.send_json(503, {"ok": False, "source": "fallback", "error": "LEVANTA_API_KEY is not configured"})
            return
        query = parse_qs(parsed.query)
        months = months_from_query(query)
        marketplaces = marketplaces_from_query(query)
        records = []
        try:
            for month_name, zero_based_month, year in months:
                for item, marketplace in fetch_invoice_items_for_marketplaces(zero_based_month, year, api_key, marketplaces):
                    records.append(normalize_invoice_item(item, month_name, zero_based_month, year, marketplace))
        except HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            self.send_json(error.code, {"ok": False, "source": "levanta-api", "error": body})
            return
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"ok": False, "source": "levanta-api", "error": str(error)})
            return

        records = [record for record in with_pending_placeholders(records, months) if is_trackable_payment_record(record)]

        self.send_json(
            200,
            {
                "ok": True,
                "source": "levanta-api",
                "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "marketplaces": marketplaces,
                "records": records,
                "summary": payment_summary(records),
            },
        )

    def handle_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        should_compress = accepts_gzip and (
            content_type.startswith("text/")
            or content_type in {
                "application/javascript",
                "application/json",
                "application/x-javascript",
            }
            or target.suffix in {".js", ".css", ".html", ".json"}
        )
        if should_compress:
            body = gzip.compress(body, compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if should_compress:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


def main():
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Offer chatbot server listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

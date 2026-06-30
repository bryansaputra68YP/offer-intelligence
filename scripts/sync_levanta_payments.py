#!/usr/bin/env python3

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


CHATBOT_PREFIX = "window.CHATBOT_DATA="


def read_chatbot_payload(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith(CHATBOT_PREFIX):
        raise ValueError(f"{path} does not look like a chatbot data payload")
    return json.loads(text[len(CHATBOT_PREFIX) :].rstrip(";\n"))


def write_chatbot_payload(path: Path, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(f"{CHATBOT_PREFIX}{body};\n", encoding="utf-8")
    temp_path.replace(path)


def month_key(month: tuple[str, int, int]) -> str:
    _name, zero_based_month, year = month
    return f"{year}-{zero_based_month + 1:02d}"


def fetch_payment_records(months: list[tuple[str, int, int]], api_key: str) -> list[dict]:
    records = []
    for month_name, zero_based_month, year in months:
        items = server.fetch_invoice_items(zero_based_month, year, api_key)
        print(f"Fetched {len(items)} Levanta invoice items for {month_name} {year}")
        for item in items:
            records.append(server.normalize_invoice_item(item, month_name, zero_based_month, year))
    return records


def source_url_with_window(source_url: str, start: str, end: str) -> str:
    parts = urlsplit(source_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["start"] = start
    query["end"] = end
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def fetch_payment_records_from_source(source_url: str, start: str, end: str) -> tuple[list[dict], str]:
    url = source_url_with_window(source_url, start, end)
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "YeahPromos-Offer-Intelligence-PaymentSync/1.0",
        },
    )
    last_error = ""
    for attempt in range(3):
        try:
            with urlopen(request, timeout=240) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            last_error = str(error)
            if attempt < 2:
                time.sleep(1 + attempt)
    else:
        raise ValueError(f"Payment source request failed after retries: {last_error}")
    if not payload.get("ok"):
        raise ValueError(f"Payment source returned an error: {payload.get('error') or payload}")
    records = payload.get("records") or []
    print(f"Fetched {len(records)} payment records from {url}")
    return records, str(payload.get("checkedAt") or "")


def validate_payment_records(records: list[dict], months: list[tuple[str, int, int]]) -> dict:
    if not records:
        raise ValueError("Levanta sync produced no payment records; refusing to overwrite static data")

    counts_by_key = collections.Counter(record.get("reportMonthKey") for record in records)
    placeholders_by_key = collections.Counter(
        record.get("reportMonthKey") for record in records if record.get("isPlaceholder")
    )
    missing = [month_key(month) for month in months if counts_by_key[month_key(month)] == 0]
    if missing:
        raise ValueError(f"Levanta sync is missing payment rows for {', '.join(missing)}; refusing to overwrite static data")

    invalid_pending = [
        record
        for record in records
        if record.get("isPlaceholder") and str(record.get("paymentStatus") or "").lower() != "pending"
    ]
    if invalid_pending:
        raise ValueError("Pending placeholder validation failed; refusing to overwrite static data")

    return {
        "recordCount": len(records),
        "countsByMonth": dict(sorted(counts_by_key.items())),
        "placeholdersByMonth": dict(sorted(placeholders_by_key.items())),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Levanta payments and update public/chatbot_data.js.")
    parser.add_argument("--start", default="2026-03", help="First report month, formatted YYYY-MM.")
    parser.add_argument("--end", default="2026-06", help="Last report month, formatted YYYY-MM.")
    parser.add_argument("--data-file", default=str(ROOT / "public" / "chatbot_data.js"), help="Path to chatbot_data.js.")
    parser.add_argument(
        "--source-url",
        default=os.environ.get("PAYMENT_SYNC_SOURCE_URL", ""),
        help="Optional Vercel payment API URL. When set, GitHub pulls records from Vercel instead of reading LEVANTA_API_KEY.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate without writing chatbot_data.js.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_file = Path(args.data_file)
    payload = read_chatbot_payload(data_file)
    months = server.months_from_query({"start": [args.start], "end": [args.end]})

    source_url = str(args.source_url or "").strip()
    checked_at = ""
    if source_url:
        raw_records, checked_at = fetch_payment_records_from_source(source_url, args.start, args.end)
    else:
        api_key = os.environ.get("LEVANTA_API_KEY", "").strip()
        if not api_key:
            print("Set PAYMENT_SYNC_SOURCE_URL or LEVANTA_API_KEY for payment sync.", file=sys.stderr)
            return 2
        raw_records = fetch_payment_records(months, api_key)

    records = [
        record
        for record in server.with_pending_placeholders(raw_records, months)
        if server.is_trackable_payment_record(record)
    ]
    validation = validate_payment_records(records, months)
    checked_at = checked_at or dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

    payload["paymentRecords"] = records
    payload.setdefault("summary", {})["paymentSummary"] = server.payment_summary(records)
    payload["summary"]["paymentLastCheckedAt"] = checked_at
    payload["summary"]["paymentSyncWindow"] = {"start": args.start, "end": args.end}
    payload.setdefault("sources", {})["payments"] = (
        f"Vercel Levanta API {args.start}..{args.end}" if source_url else f"Levanta API {args.start}..{args.end}"
    )

    print(json.dumps({"checkedAt": checked_at, **validation}, ensure_ascii=False, indent=2))
    if not args.dry_run:
        write_chatbot_payload(data_file, payload)
        print(f"Updated {data_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from http.server import BaseHTTPRequestHandler
import datetime as dt
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

from server import (
    fetch_invoice_items,
    is_trackable_payment_record,
    months_from_query,
    normalize_invoice_item,
    payment_summary,
    with_pending_placeholders,
)


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        api_key = os.environ.get("LEVANTA_API_KEY", "").strip()
        if not api_key:
            self.send_json(503, {"ok": False, "source": "fallback", "error": "LEVANTA_API_KEY is not configured"})
            return

        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        months = months_from_query(query)
        records = []
        try:
            for month_name, zero_based_month, year in months:
                for item in fetch_invoice_items(zero_based_month, year, api_key):
                    records.append(normalize_invoice_item(item, month_name, zero_based_month, year))
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
                "records": records,
                "summary": payment_summary(records),
            },
        )

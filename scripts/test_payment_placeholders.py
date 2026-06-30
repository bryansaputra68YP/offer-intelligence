#!/usr/bin/env python3

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def assert_true(value, label):
    if not value:
        raise AssertionError(label)


def load_static_payload():
    text = (ROOT / "public" / "chatbot_data.js").read_text(encoding="utf-8")
    match = re.match(r"window\.CHATBOT_DATA=(.*);\s*$", text, re.S)
    assert_true(match, "chatbot_data.js should expose window.CHATBOT_DATA")
    return json.loads(match.group(1))


def load_static_payment_records():
    return load_static_payload().get("paymentRecords", [])


def main() -> int:
    payload = load_static_payload()
    records = payload.get("paymentRecords", [])
    offers = payload.get("offers", [])
    with_placeholders = server.with_pending_placeholders(records, server.DEFAULT_MONTHS)
    trackable = [record for record in with_placeholders if server.is_trackable_payment_record(record)]
    trackable_ids = {record.get("id") for record in trackable}

    placeholder_months = collections.Counter(
        record.get("reportMonth") for record in with_placeholders if record.get("isPlaceholder")
    )
    trackable_months = collections.Counter(record.get("reportMonth") for record in trackable)

    assert_true(placeholder_months["May"] > 0, "May pending placeholders should be generated")
    assert_true(placeholder_months["June"] > 0, "June pending placeholders should be generated")
    assert_true(trackable_months["May"] > 0, "May pending placeholders should survive payment filtering")
    assert_true(trackable_months["June"] > 0, "June pending placeholders should survive payment filtering")

    sample_placeholder = next(record for record in with_placeholders if record.get("isPlaceholder") and record.get("reportMonth") == "May")
    assert_true(not server.has_payable_payment_amount(sample_placeholder), "sample placeholder should have zero payable amount")
    assert_true(server.is_trackable_payment_record(sample_placeholder), "zero-amount pending placeholder should be trackable")
    assert_true(sample_placeholder.get("id") in trackable_ids, "sample placeholder should remain in filtered records")

    expected_renpho_ids = {
        "RENPHO Group": "362938",
        "RENPHO Wellness": "363199",
    }
    for merchant_name, merchant_id in expected_renpho_ids.items():
        renpho_rows = [record for record in records if record.get("merchantName") == merchant_name]
        assert_true(renpho_rows, f"{merchant_name} payment rows should exist")
        for record in renpho_rows:
            assert_true(record.get("merchantId") == merchant_id, f"{merchant_name} should use Levanta MID {merchant_id}")
            assert_true(record.get("levantaBrandId"), f"{merchant_name} should preserve the Levanta API brand id")

        sample = server.normalize_invoice_item(
            {
                "brand": {"id": renpho_rows[0].get("levantaBrandId"), "name": merchant_name},
                "sales": 1,
                "totalCommission": 0.1,
                "status": "pending",
            },
            "June",
            5,
            2026,
        )
        assert_true(sample.get("merchantId") == merchant_id, f"live sync should map {merchant_name} to Levanta MID {merchant_id}")

    corrected_direct_id_sample = server.normalize_invoice_item(
        {
            "brand": {"id": "387793", "name": "RENPHO Group"},
            "sales": 1,
            "totalCommission": 0.1,
            "status": "pending",
        },
        "June",
        5,
        2026,
    )
    assert_true(
        corrected_direct_id_sample.get("merchantId") == "362938",
        "Levanta payment rows should not keep the direct RENPHO Group MID",
    )

    direct_renpho_ids = {"387792", "387793"}
    for offer in offers:
        if str(offer.get("merchantId")) not in direct_renpho_ids:
            continue
        assert_true(not offer.get("paymentState"), "direct Renpho offers should not inherit Levanta payment state")
        assert_true(
            offer.get("paymentStatus") == "No payment issue found",
            "direct Renpho offers should not inherit Levanta paid status",
        )

    print(
        "Payment placeholder tests passed:",
        {
            "static": len(records),
            "withPlaceholders": len(with_placeholders),
            "trackable": len(trackable),
            "placeholderMonths": dict(placeholder_months),
            "trackableMonths": dict(trackable_months),
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

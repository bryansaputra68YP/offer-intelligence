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


def load_static_payment_records():
    text = (ROOT / "public" / "chatbot_data.js").read_text(encoding="utf-8")
    match = re.match(r"window\.CHATBOT_DATA=(.*);\s*$", text, re.S)
    assert_true(match, "chatbot_data.js should expose window.CHATBOT_DATA")
    return json.loads(match.group(1)).get("paymentRecords", [])


def main() -> int:
    records = load_static_payment_records()
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

# Offer Intelligence

![CI](https://github.com/bryansaputra68YP/offer-intelligence/actions/workflows/ci.yml/badge.svg)

Internal YeahPromos Amazon offer intelligence dashboard for offer ranking, category analysis, Tier 2 publisher strategy, payment follow-up, and chatbot-based lookup.

## What Is Included

- Static dashboard UI in `public/`.
- Prebuilt browser payloads:
  - `public/chatbot_data.js`
  - `public/sheet_report_data.js`
- Google Sheet and Feishu category intelligence for main-category and subcategory search.
- Recommendation chatbot with English and Chinese prompt support.
- Tier 2 publisher recommendation rules in `public/tier2_recommendation_rules.js`.
- Tier sheet category-wise reporting and multi-sheet XLSX exports.
- Levanta payment API helpers in `server.py` and `api/levanta/payments.py`.
- Data rebuild and regression scripts in `scripts/`.
- GitHub Actions CI in `.github/workflows/ci.yml`.

## Current Behavior

### Category Logic

Main category logic is based on the Google Sheet `Category` value when it is present.

- Tier 1 `Category`: column 22
- Tier 2 `Category`: column 22
- Tier 3 `Category`: column 12
- Tier 4 `Category`: column 13

The dashboard and chatbot use this fallback order for the displayed main category:

```text
sheetCategory -> mainCategory -> feishuMainCategory -> non-Feishu category -> remaining category -> levantaCategory -> Uncategorized
```

Feishu main category, subcategory, and category path values remain searchable metadata, so prompts can still match subcategory phrases such as `robot vacuum`, but main-category grouping is driven by the Google Sheet category first.

### Tier Pages and XLSX Exports

Each tier page (`Tier 1`, `Tier 2`, `Tier 3`, `Tier 4`, and `BLACK TIER`) renders a category-wise report above the sheet table. The category report uses the current tier filters and groups rows by displayed category.

- The on-page category report shows merchants, revenue, orders, conversion, EPC, and the top merchant per category.
- Category groups are calculated from the filtered tier rows, so search, network/agency, country, EPC, and revenue filters update the category report.
- Tier XLSX downloads include the selected tier sheet plus a `Category Summary` sheet.
- Tier XLSX downloads also include an `Offer List` sheet with `Merchant ID`, `Merchant Name`, `Category`, and `Avg Commission Rate`.
- `Avg Commission Rate` is rounded up to a whole percentage for export.

### Dashboard Category Report

The dashboard renders a standalone category-wise report from the tier sheet rows. It has its own tier checkbox filter and is independent of the main dashboard filters.

- `All Tier 1-4` selects `Tier 1`, `Tier 2`, `Tier 3`, and `Tier 4` only.
- `BLACK TIER` is available as a separate checkbox and is not included in the all-tier shortcut.
- The report groups selected tier merchants by displayed category and shows merchants, revenue, orders, conversion, EPC, AOV, top merchants, and tier mix.

Manual test case:

1. Open `http://127.0.0.1:8765` and confirm the dashboard category report defaults to `Tier 1`, `Tier 2`, `Tier 3`, and `Tier 4` with `BLACK TIER` unchecked.
2. Confirm the current exported data shows `6,302` rows, `48` categories, `$2,166,390.16` revenue, and `21,843` orders for the default Tier 1-4 view.
3. Clear the tier selection, check only `Tier 3`, and confirm the report updates to `370` rows, `26` categories, `$514,930.55` revenue, `4,056` orders, and Tier mix values that only use `T3`.
4. Check `BLACK TIER`, then click `All Tier 1-4`; confirm `BLACK TIER` is cleared again and the report returns to the default Tier 1-4 totals.

### Chatbot Intent Flow

The chatbot separates merchant-name lookup from category search:

- `Shokz` or `Shokz offers` searches for that merchant's offers.
- `Electronics`, `Beauty offers`, or known subcategory phrases search by category.
- `Shokz Electronics` is treated as a category-aware query when the category term is known.
- `Find ASIN B0D2HKCMBP` searches offers containing that ASIN.
- Payment prompts such as `April unpaid payments` use the saved or live Levanta payment data.

The chatbot also supports flexible metric filters and ranking phrases:

- `aov above 100`
- `epc lower than 1`
- `conversion above 10%`
- `offers with highest revenue`
- `10 offers with highest commission`

Metric ranking still keeps tier priority first, then sorts within that priority by the requested metric.

### Tier 2 Publisher Strategy

Tier 2 recommendations read publisher counts such as `14/20` as `14 of 20 publishers are producing orders` and use the derived success rate in the recommendation idea.

- Green offers are optimization-only: keep and scale the publishers that already work, and do not bring more publishers to the offer.
- Non-green offers below the 20-30 publisher test-pool target should add qualified publishers to validate sales and orders.
- Mature pools with low success rate should replace or rotate weaker publishers rather than adding more of the same traffic.
- Red or declining offers should add fresh qualified test publishers to recover sales/orders and reduce Tier 3 risk.

### Payment Report Mapping

Payment records come from Levanta invoice data and should be attributed to Levanta merchant IDs when the same brand also has a direct offer in the system.

- Live sync in `server.py`, static data generation in `scripts/build_offer_chatbot_data.rb`, and browser normalization in `public/app.js` prefer exact Levanta-network offer matches for Levanta payment rows.
- If Levanta provides a brand UUID, the dashboard keeps it as `levantaBrandId` while displaying the matched internal Levanta merchant ID.
- Direct offers with the same brand name do not inherit Levanta payment status or sales.
- RENPHO Group payment rows map to Levanta MID `362938`; RENPHO Wellness payment rows map to Levanta MID `363199`.

### Payment Report Display and Export

The payment page focuses on payment follow-up fields only. The payment table and downloadable payment XLSX do not include the old Notes column.

- Payment table columns show merchant ID, merchant name/category, network, tier, month, status, revenue made, commission made, payment cycle, expected payment date, and last checked date.
- Payment XLSX columns match the follow-up workflow: merchant, tier, network, category, month/status, revenue/commission, paid/remaining amount, payment cycle days, expected payment date, and last checked.
- Notes are still allowed inside source records for internal calculation or status text, but they are not rendered as a payment-section column or exported payment column.

### Dashboard Offer List

The bottom offer list is grouped by main category instead of being a flat preview. Each category section shows its own conversion, AOV, revenue, order, and offer-count summary. Category groups are sorted by revenue, with `Uncategorized` placed last.

Dashboard filters and exports continue to operate on the same filtered offer set.

## Run Locally

macOS/Linux:

```bash
export LEVANTA_API_KEY="your_levanta_api_key"
python3 server.py
```

Windows PowerShell:

```powershell
$env:LEVANTA_API_KEY="your_levanta_api_key"
python server.py
```

Then open:

```text
http://127.0.0.1:8765
```

The frontend can load from saved data without the Levanta key, but live payment sync requires `LEVANTA_API_KEY`.

## Data Rebuild Scripts

The repository is a Python-served static frontend, not a Node app. The generated data files are committed browser payloads.

```bash
python scripts/build_sheet_report_data.py
ruby scripts/build_offer_chatbot_data.rb
```

## Example Prompts

```text
推荐5个美妆offer
四月未付款有哪些？
Aiper 的付款状态
查找 ASIN B0D2HKCMBP
推荐 Tier 2 里面表现好的 offer
aov above 100
epc lower than 1
conversion above 10%
10 offers with highest commission
offers with highest revenue
```

## Test Suite

Run the same checks used by CI:

```bash
node --check public/app.js
node --check public/chatbot_i18n.js
node --check public/tier2_recommendation_rules.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_tier2_recommendation_rules.mjs
node scripts/test_sheet_categories.mjs
node scripts/test_zh_chatbot.mjs
python -m scripts.test_payment_placeholders
```

## Security

Do not commit `.env`, API keys, logs, or PID files. The server reads the Levanta key from the environment only.


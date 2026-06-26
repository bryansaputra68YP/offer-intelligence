# Offer Intelligence

Internal YeahPromos Amazon offer intelligence dashboard.

## What is included

- Static dashboard UI in `public/`
- Prebuilt report data files:
  - `public/chatbot_data.js`
  - `public/sheet_report_data.js`
- Python server in `server.py`
- Data rebuild scripts in `scripts/`

## Run locally

```bash
export LEVANTA_API_KEY="your_levanta_api_key"
python3 server.py
```

Then open:

```text
http://127.0.0.1:8765
```

The frontend can load from saved data without the Levanta key, but live payment sync requires `LEVANTA_API_KEY`.

## Chinese chatbot support

The recommendation chatbot accepts Chinese prompts and returns Chinese response scaffolding for recommendations, payment questions, tier/category lookups, merchant follow-ups, and ASIN lookups. Imported merchant names, ASINs, metrics, and source recommendation notes stay in their original data language.

Quick local smoke test:

```bash
node scripts/test_zh_chatbot.mjs
```

Example prompts:

```text
推荐5个美妆offer
四月未付款有哪些？
Aiper 的付款状态
查找 ASIN B0D2HKCMBP
推荐 Tier 2 里面表现好的 offer
```

## Security

Do not commit `.env`, API keys, logs, or PID files. The server reads the Levanta key from the environment only.


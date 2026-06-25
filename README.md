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

## Security

Do not commit `.env`, API keys, logs, or PID files. The server reads the Levanta key from the environment only.


# Options ladder

Local viewer for a diagonal NIFTY 50, SPX, and XSP option chain.

The center row is the at-the-money call and put at the nearest expiry. Each row above steps the call to a higher strike and a later expiry. Each row below steps the put to a lower strike and a later expiry.

Quotes are public and delayed: NSE’s website for NIFTY, Cboe’s delayed files for SPX and XSP. No API key.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

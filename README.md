# Options ladder

Local viewer for a diagonal NIFTY 50, SPX, XSP, and ES1! option chain.

The center row is the at-the-money call and put at the nearest expiry. Each row above steps the call to a higher strike and a later expiry. Each row below steps the put to a lower strike and a later expiry.

Quotes are public and delayed: NSE’s website for NIFTY, Cboe’s delayed files for SPX and XSP, and CME’s delayed quotes for ES1!. No API key.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

Public page: https://pk1codes.github.io/optionschain/

The page reads the live API at https://optionschain-69334014512.asia-south1.run.app and falls back to the saved snapshots in `docs/data` if that API is down. NIFTY refreshes every 3 minutes. SPX, XSP, and ES1! refresh every minute.

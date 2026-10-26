"""NIFTY option chain from the public NSE site. One request per expiry."""

import asyncio
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.ladder import to_millis
from app.models import Quote, Snapshot

log = logging.getLogger(__name__)

_IST = ZoneInfo("Asia/Kolkata")
_BASE = "https://www.nseindia.com"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{_BASE}/option-chain",
}


def _parse_expiry(value: str) -> date:
    for fmt in ("%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised NSE expiry {value}")


def _format_as_of(value: str | None) -> str:
    if not value:
        return "time not provided"
    try:
        parsed = datetime.strptime(value, "%d-%b-%Y %H:%M:%S")
    except ValueError:
        return value
    return parsed.strftime("%d %b %Y %H:%M") + " IST"


def rows_to_quotes(expiry: date, rows: list[dict]) -> tuple[dict[tuple[date, int, str], Quote], list[int]]:
    quotes: dict[tuple[date, int, str], Quote] = {}
    strikes: list[int] = []
    for row in rows:
        strike = to_millis(row["strikePrice"])
        strikes.append(strike)
        for right, key in (("C", "CE"), ("P", "PE")):
            side = row.get(key)
            if not isinstance(side, dict):
                continue
            ltp = side.get("lastPrice")
            oi = side.get("openInterest")
            quotes[(expiry, strike, right)] = Quote(
                ltp=None if ltp is None else float(ltp),
                oi=None if oi is None else int(oi),
            )
    return quotes, strikes


async def _get_json(client: httpx.AsyncClient, url: str, params: dict | None = None) -> dict:
    response = await client.get(url, params=params)
    response.raise_for_status()
    text = response.text.lstrip()
    if not text.startswith("{") and not text.startswith("["):
        raise RuntimeError(f"NSE did not return JSON ({response.status_code})")
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("NSE returned an unexpected payload")
    return payload


async def fetch_nifty() -> Snapshot:
    timeout = httpx.Timeout(30.0)
    async with httpx.AsyncClient(headers=_HEADERS, timeout=timeout, follow_redirects=True) as client:
        home = await client.get(f"{_BASE}/option-chain", headers={**_HEADERS, "Accept": "text/html"})
        home.raise_for_status()
        info = await _get_json(client, f"{_BASE}/api/option-chain-contract-info", {"symbol": "NIFTY"})
        expiry_labels = info.get("expiryDates") or []
        if not expiry_labels:
            raise RuntimeError("NSE contract info has no NIFTY expiries")

        from app.ladder import select_expiries

        today = datetime.now(_IST).date()
        parsed = [_parse_expiry(label) for label in expiry_labels]
        selected = select_expiries(parsed, today, "weekly")
        if not selected:
            raise RuntimeError("NSE has no upcoming NIFTY expiry")
        label_by_date = dict(zip(parsed, expiry_labels))

        quotes: dict[tuple[date, int, str], Quote] = {}
        strikes: list[int] = []
        spot: float | None = None
        as_of = ""
        for index, expiry in enumerate(selected):
            if index:
                await asyncio.sleep(0.2)
            payload = await _get_json(
                client,
                f"{_BASE}/api/option-chain-v3",
                {"type": "Indices", "symbol": "NIFTY", "expiry": label_by_date[expiry]},
            )
            records = payload.get("records") or {}
            rows = records.get("data") or []
            if not rows:
                raise RuntimeError(f"NSE returned no NIFTY chain for {label_by_date[expiry]}")
            if spot is None and records.get("underlyingValue") is not None:
                spot = float(records["underlyingValue"])
                as_of = _format_as_of(records.get("timestamp"))
            part, part_strikes = rows_to_quotes(expiry, rows)
            quotes.update(part)
            strikes.extend(part_strikes)

    if spot is None:
        raise RuntimeError("NSE chain has no NIFTY spot")
    log.info("NIFTY spot %s across %s expiries", spot, len(selected))
    return Snapshot(
        symbol="NIFTY",
        name="NIFTY 50",
        spot=spot,
        as_of=as_of,
        delay_note="NSE quotes are delayed a few minutes",
        currency="INR",
        today=today,
        expiries=selected,
        quotes=quotes,
        strikes=strikes,
        strike_step=100,
        expiry_mode="weekly",
    )

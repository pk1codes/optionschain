"""SPX and XSP chains from Cboe's public delayed-quote files."""

import logging
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.models import Quote, Snapshot

log = logging.getLogger(__name__)

_NY = ZoneInfo("America/New_York")
_OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d+)$")
_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_{symbol}.json"
_NAMES = {"SPX": "S&P 500 (SPX)", "XSP": "Mini-SPX (XSP)"}


def parse_option_symbol(symbol: str) -> tuple[str, date, str, int] | None:
    match = _OCC.match(symbol)
    if not match:
        return None
    root, ymd, right, strike_raw = match.groups()
    try:
        expiry = date(2000 + int(ymd[:2]), int(ymd[2:4]), int(ymd[4:6]))
    except ValueError:
        return None
    return root, expiry, right, int(strike_raw)


def _better(new_root: str, new_oi: int | None, old_root: str, old_oi: int | None) -> bool:
    new_weekly = new_root.endswith("W")
    old_weekly = old_root.endswith("W")
    if new_weekly != old_weekly:
        return new_weekly
    return (new_oi if new_oi is not None else -1) > (old_oi if old_oi is not None else -1)


def index_options(
    raw_options: list[dict],
) -> tuple[dict[tuple[date, int, str], Quote], list[int], list[date]]:
    quotes: dict[tuple[date, int, str], Quote] = {}
    roots: dict[tuple[date, int, str], str] = {}
    strikes: set[int] = set()
    expiries: set[date] = set()
    for item in raw_options:
        parsed = parse_option_symbol(str(item.get("option") or ""))
        if parsed is None:
            continue
        root, expiry, right, strike = parsed
        key = (expiry, strike, right)
        ltp = item.get("last_trade_price")
        oi_raw = item.get("open_interest")
        oi = None if oi_raw is None else int(oi_raw)
        previous = roots.get(key)
        if previous is not None and not _better(root, oi, previous, quotes[key].oi):
            continue
        roots[key] = root
        quotes[key] = Quote(ltp=None if ltp is None else float(ltp), oi=oi)
        strikes.add(strike)
        expiries.add(expiry)
    return quotes, sorted(strikes), sorted(expiries)


def _format_as_of(value: str | None) -> str:
    if not value:
        return "time not provided"
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value
    return parsed.strftime("%d %b %Y %H:%M") + " UTC"


async def fetch_index(symbol: str) -> Snapshot:
    url = _URL.format(symbol=symbol)
    timeout = httpx.Timeout(60.0)
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
    data = payload.get("data") or {}
    raw = data.get("options") or []
    if not raw:
        raise RuntimeError(f"Cboe returned no {symbol} options")
    spot = data.get("current_price") or data.get("close")
    if spot is None:
        raise RuntimeError(f"Cboe returned no {symbol} spot")
    quotes, strikes, expiries = index_options(raw)
    log.info("%s spot %s contracts %s", symbol, spot, len(quotes))
    return Snapshot(
        symbol=symbol,
        name=_NAMES[symbol],
        spot=float(spot),
        as_of=_format_as_of(payload.get("timestamp")),
        delay_note="Cboe quotes are about 15 minutes delayed",
        currency="USD",
        today=datetime.now(_NY).date(),
        expiries=expiries,
        quotes=quotes,
        strikes=strikes,
        strike_step=None,
        expiry_mode="listed",
    )

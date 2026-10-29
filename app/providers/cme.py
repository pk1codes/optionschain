"""ES1! chain from CME's public delayed quotes. Front-month future is the spot."""

import asyncio
import logging
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from app.ladder import to_millis
from app.models import Quote, Snapshot

log = logging.getLogger(__name__)

_CT = ZoneInfo("America/Chicago")
_PAGE = "https://www.cmegroup.com/markets/equities/sp/e-mini-sandp500.quotes.options.html"
_FUTURES = "https://www.cmegroup.com/CmeWS/mvc/quotes/v2/133?isProtected"
_EXPIRATIONS = "https://www.cmegroup.com/CmeWS/mvc/atm/expirations/133?isProtected"
_STRIKES = "https://www.cmegroup.com/CmeWS/mvc/atm/strike-prices/{product}/{year}/{month}/ALL?isProtected"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": _PAGE,
    "X-Requested-With": "XMLHttpRequest",
}


def parse_px(value) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "").rstrip("iI")
    if text in {"", "-", "—"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def quote_from_side(side: dict | None) -> Quote | None:
    if not side:
        return None
    ltp = parse_px(side.get("last"))
    if ltp is None:
        ltp = parse_px(side.get("priorSettle"))
    if ltp is None:
        return None
    return Quote(ltp=ltp, oi=None)


def index_chain(payload: dict, expiry: date, quotes: dict[tuple[date, int, str], Quote], strikes: set[int]) -> None:
    for row in payload.get("strikePrices") or []:
        try:
            strike = to_millis(row.get("strikePrice"))
        except (TypeError, ValueError):
            continue
        for right, side_name in (("C", "call"), ("P", "put")):
            quote = quote_from_side(row.get(side_name))
            if quote is None:
                continue
            key = (expiry, strike, right)
            previous = quotes.get(key)
            if previous is not None and previous.ltp is not None and quote.ltp is None:
                continue
            quotes[key] = quote
            strikes.add(strike)


def listed_contracts(groups: list[dict], today: date) -> list[dict]:
    found = []
    seen: set[tuple[date, int]] = set()
    for group in groups:
        for contract in group.get("contractExpirations") or []:
            raw = str(contract.get("lastTradeDate") or "")
            try:
                expiry = date.fromisoformat(raw[:10])
            except ValueError:
                continue
            if expiry < today:
                continue
            product = contract.get("productId")
            year = contract.get("expirationYear")
            month = contract.get("expirationMonth")
            if product is None or year is None or month is None:
                continue
            key = (expiry, int(product))
            if key in seen:
                continue
            seen.add(key)
            found.append(
                {"expiry": expiry, "product": int(product), "year": int(year), "month": int(month)}
            )
    return sorted(found, key=lambda item: (item["expiry"], item["product"]))


def front_future(quotes: list[dict], today: date) -> dict:
    ranked = []
    for quote in quotes:
        raw = str(quote.get("expirationDate") or "")
        if len(raw) == 8 and raw.isdigit():
            expiry = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        else:
            expiry = today
        ranked.append((expiry, quote))
    ranked.sort(key=lambda item: item[0])
    for expiry, quote in ranked:
        if expiry >= today and (parse_px(quote.get("last")) or parse_px(quote.get("priorSettle"))):
            return quote
    raise RuntimeError("CME returned no ES future price")


def format_as_of(value: str | None) -> str:
    if not value:
        return "time not provided"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return parsed.astimezone(timezone.utc).strftime("%d %b %Y %H:%M UTC")


async def _get_json(client: httpx.AsyncClient, url: str) -> dict | list:
    response = await client.get(url)
    response.raise_for_status()
    return response.json()


async def fetch_es() -> Snapshot:
    timeout = httpx.Timeout(60.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=_HEADERS) as client:
        await client.get(_PAGE, headers={**_HEADERS, "Accept": "text/html"})
        groups, futures = await asyncio.gather(
            _get_json(client, _EXPIRATIONS),
            _get_json(client, _FUTURES),
        )
        if not isinstance(groups, list) or not isinstance(futures, dict):
            raise RuntimeError("CME returned an unexpected ES payload")
        today = datetime.now(_CT).date()
        contracts = listed_contracts(groups, today)
        if not contracts:
            raise RuntimeError("CME returned no upcoming ES expiries")
        front = front_future(futures.get("quotes") or [], today)
        spot = parse_px(front.get("last")) or parse_px(front.get("priorSettle"))
        if spot is None:
            raise RuntimeError("CME returned no ES future price")

        sem = asyncio.Semaphore(4)

        async def load(contract: dict) -> tuple[date, dict]:
            async with sem:
                url = _STRIKES.format(
                    product=contract["product"],
                    year=contract["year"],
                    month=contract["month"],
                )
                payload = await _get_json(client, url)
            if not isinstance(payload, dict):
                raise RuntimeError(f"CME returned no ES chain for {contract['expiry']}")
            return contract["expiry"], payload

        chains = await asyncio.gather(*[load(contract) for contract in contracts])

    quotes: dict[tuple[date, int, str], Quote] = {}
    strikes: set[int] = set()
    for expiry, payload in chains:
        index_chain(payload, expiry, quotes, strikes)
    if not quotes:
        raise RuntimeError("CME returned no ES option prices")
    log.info("ES1! spot %s contracts %s expiries %s", spot, len(quotes), len(contracts))
    return Snapshot(
        symbol="ES1!",
        name="E-mini S&P 500 (ES1!)",
        spot=float(spot),
        as_of=format_as_of(front.get("updated")),
        delay_note="CME quotes are about 10 minutes delayed",
        currency="USD",
        today=today,
        expiries=sorted({contract["expiry"] for contract in contracts}),
        quotes=quotes,
        strikes=sorted(strikes),
        strike_step=None,
        expiry_mode="listed",
    )

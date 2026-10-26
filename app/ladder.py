"""Diagonal ladder: calls step up, puts step down, both share the expiry walk."""

from datetime import date

from app.models import Quote, Snapshot

_MISSING_LIMIT = 3


def to_millis(value: float) -> int:
    return int(round(float(value) * 1000))


def from_millis(value: int) -> int | float:
    if value % 1000 == 0:
        return value // 1000
    return value / 1000


def select_expiries(dates: list[date], today: date, mode: str) -> list[date]:
    future = sorted({d for d in dates if d >= today})
    if mode != "weekly" or len(future) < 2:
        return future
    kept = [future[0]]
    for expiry in future[1:]:
        gap = (expiry - kept[-1]).days
        if gap < 4:
            continue
        if gap > 10:
            break
        kept.append(expiry)
    return kept


def detect_step_millis(strikes: list[int], spot_millis: int) -> int:
    ordered = sorted(set(strikes))
    window = max(int(spot_millis * 0.01), 1)

    def diffs_within(limit: int | None) -> list[int]:
        pool = ordered
        if limit is not None:
            pool = [s for s in ordered if abs(s - spot_millis) <= limit]
        return [b - a for a, b in zip(pool, pool[1:]) if b > a]

    diffs = diffs_within(window) or diffs_within(window * 3) or diffs_within(None)
    if not diffs:
        raise ValueError("Could not detect a strike step near the spot")
    return min(diffs)


def atm_strike_millis(strikes: list[int], spot_millis: int, step_millis: int) -> int:
    multiples = [s for s in set(strikes) if step_millis > 0 and s % step_millis == 0]
    pool = multiples or list(set(strikes))
    if not pool:
        raise ValueError("Option chain has no strikes")
    return min(pool, key=lambda s: (abs(s - spot_millis), -s))


def _quote_payload(quote: Quote | None) -> dict:
    if quote is None:
        return {"ltp": None, "oi": None}
    return {"ltp": quote.ltp, "oi": quote.oi}


def _row(strike: int, expiry: date, today: date, quote: Quote | None) -> dict:
    return {
        "strike": from_millis(strike),
        "expiry": expiry.isoformat(),
        "dte": (expiry - today).days,
        "ltp": None if quote is None else quote.ltp,
        "oi": None if quote is None else quote.oi,
    }


def _walk_side(
    *,
    expiries: list[date],
    quotes: dict[tuple[date, int, str], Quote],
    atm: int,
    step: int,
    right: str,
    direction: int,
    today: date,
) -> tuple[list[dict], bool]:
    rows: list[dict] = []
    missing = 0
    truncated = False
    for index, expiry in enumerate(expiries[1:], start=1):
        strike = atm + direction * index * step
        quote = quotes.get((expiry, strike, right))
        rows.append(_row(strike, expiry, today, quote))
        if quote is None:
            missing += 1
            if missing >= _MISSING_LIMIT:
                truncated = True
                break
        else:
            missing = 0
    return rows, truncated


def build_ladder(snapshot: Snapshot) -> dict:
    spot_millis = to_millis(snapshot.spot)
    expiries = select_expiries(snapshot.expiries, snapshot.today, snapshot.expiry_mode)
    if not expiries:
        raise ValueError(f"No listed expiries for {snapshot.symbol}")

    step = (
        to_millis(snapshot.strike_step)
        if snapshot.strike_step is not None
        else detect_step_millis(snapshot.strikes, spot_millis)
    )
    if step <= 0:
        raise ValueError("Strike step must be positive")

    atm = atm_strike_millis(snapshot.strikes, spot_millis, step)
    front = expiries[0]
    calls, calls_truncated = _walk_side(
        expiries=expiries,
        quotes=snapshot.quotes,
        atm=atm,
        step=step,
        right="C",
        direction=1,
        today=snapshot.today,
    )
    puts, puts_truncated = _walk_side(
        expiries=expiries,
        quotes=snapshot.quotes,
        atm=atm,
        step=step,
        right="P",
        direction=-1,
        today=snapshot.today,
    )
    return {
        "symbol": snapshot.symbol,
        "name": snapshot.name,
        "spot": snapshot.spot,
        "asOf": snapshot.as_of,
        "delayNote": snapshot.delay_note,
        "currency": snapshot.currency,
        "strikeStep": from_millis(step),
        "expiryRule": "Next weekly expiry" if snapshot.expiry_mode == "weekly" else "Next listed expiry",
        "atm": {
            "strike": from_millis(atm),
            "expiry": front.isoformat(),
            "dte": (front - snapshot.today).days,
            "call": _quote_payload(snapshot.quotes.get((front, atm, "C"))),
            "put": _quote_payload(snapshot.quotes.get((front, atm, "P"))),
        },
        "calls": calls,
        "puts": puts,
        "callsTruncated": calls_truncated,
        "putsTruncated": puts_truncated,
    }

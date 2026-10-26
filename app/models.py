from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Quote:
    ltp: float | None
    oi: int | None


@dataclass
class Snapshot:
    symbol: str
    name: str
    spot: float
    as_of: str
    delay_note: str
    currency: str
    today: date
    expiries: list[date]
    quotes: dict[tuple[date, int, str], Quote]
    strikes: list[int]
    strike_step: float | None
    expiry_mode: str

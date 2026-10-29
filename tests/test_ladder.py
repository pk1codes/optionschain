from datetime import date

from app.ladder import build_ladder, detect_step_millis, select_expiries, to_millis
from app.models import Quote, Snapshot
from app.providers.cboe import index_options, parse_option_symbol
from app.providers.cme import index_chain, listed_contracts, parse_px, quote_from_side
from app.providers.nse import rows_to_quotes


def _quote(ltp=1.0, oi=10):
    return Quote(ltp=ltp, oi=oi)


def _snapshot(**overrides):
    base = dict(
        symbol="NIFTY",
        name="NIFTY 50",
        spot=22750,
        as_of="26 Oct 2026 15:40 IST",
        delay_note="delayed",
        currency="INR",
        today=date(2026, 10, 26),
        expiries=[],
        quotes={},
        strikes=[],
        strike_step=100,
        expiry_mode="weekly",
    )
    base.update(overrides)
    return Snapshot(**base)


def test_weekly_keeps_holiday_shift_and_drops_monthly_gap():
    dates = [
        date(2026, 10, 27),
        date(2026, 11, 3),
        date(2026, 11, 9),
        date(2026, 11, 17),
        date(2026, 11, 23),
        date(2026, 12, 1),
        date(2026, 12, 29),
    ]
    kept = select_expiries(dates, date(2026, 10, 26), "weekly")
    assert kept == dates[:-1]


def test_short_gap_is_skipped_without_stopping_the_walk():
    dates = [date(2026, 10, 27), date(2026, 10, 29), date(2026, 11, 5)]
    assert select_expiries(dates, date(2026, 10, 26), "weekly") == [
        date(2026, 10, 27),
        date(2026, 11, 5),
    ]


def test_tie_at_spot_goes_to_the_higher_strike_and_sides_step_apart():
    expiries = [date(2026, 10, 27), date(2026, 11, 3), date(2026, 11, 9)]
    strikes = [to_millis(s) for s in (22700, 22800, 22900, 22600)]
    quotes = {}
    for expiry in expiries:
        for strike in strikes:
            quotes[(expiry, strike, "C")] = _quote(ltp=2)
            quotes[(expiry, strike, "P")] = _quote(ltp=3, oi=4)
    ladder = build_ladder(_snapshot(spot=22750, expiries=expiries, quotes=quotes, strikes=strikes))
    assert ladder["atm"]["strike"] == 22800
    assert ladder["atm"]["call"]["ltp"] == 2
    assert ladder["atm"]["put"]["oi"] == 4
    assert [row["strike"] for row in ladder["calls"]] == [22900, 23000]
    assert [row["expiry"] for row in ladder["calls"]] == ["2026-11-03", "2026-11-09"]
    assert [row["strike"] for row in ladder["puts"]] == [22700, 22600]
    assert ladder["calls"][1]["ltp"] is None
    assert ladder["puts"][0]["ltp"] == 3


def test_three_missing_contracts_stop_the_side():
    expiries = [date(2026, 10, 27) + __import__("datetime").timedelta(days=7 * i) for i in range(6)]
    atm = to_millis(22800)
    quotes = {
        (expiries[0], atm, "C"): _quote(),
        (expiries[0], atm, "P"): _quote(),
        (expiries[1], atm + to_millis(100), "C"): _quote(),
    }
    strikes = [atm, atm + to_millis(100), atm - to_millis(100)]
    ladder = build_ladder(_snapshot(expiries=expiries, quotes=quotes, strikes=strikes, expiry_mode="listed"))
    assert len(ladder["calls"]) == 4
    assert ladder["callsTruncated"] is True
    assert ladder["calls"][0]["ltp"] == 1
    assert all(row["ltp"] is None for row in ladder["calls"][1:])
    assert len(ladder["puts"]) == 3
    assert ladder["putsTruncated"] is True


def test_detects_smallest_near_strike_gap():
    spot = to_millis(7678)
    strikes = [to_millis(s) for s in (7600, 7670, 7675, 7680, 7685, 7800)]
    assert detect_step_millis(strikes, spot) == to_millis(5)


def test_spxw_beats_standard_spx_on_the_same_contract():
    parsed = parse_option_symbol("SPXW261027C07680000")
    assert parsed[0] == "SPXW"
    assert parsed[1] == date(2026, 10, 27)
    assert parsed[3] == 7680000
    quotes, strikes, expiries = index_options([
        {"option": "SPX261027C07680000", "last_trade_price": 9, "open_interest": 500},
        {"option": "SPXW261027C07680000", "last_trade_price": 11, "open_interest": 5},
        {"option": "SPXW261027P07675000", "last_trade_price": 4, "open_interest": 8},
    ])
    assert quotes[(date(2026, 10, 27), 7680000, "C")].ltp == 11
    assert quotes[(date(2026, 10, 27), 7675000, "P")].oi == 8
    assert strikes == [7675000, 7680000]
    assert expiries == [date(2026, 10, 27)]


def test_es_chain_keeps_a_last_price_and_skips_past_expiries():
    assert parse_px("-") is None
    assert parse_px("22.00") == 22
    assert quote_from_side({"last": "-", "priorSettle": "8.60"}).ltp == 8.6
    groups = [{
        "contractExpirations": [
            {"lastTradeDate": "2026-10-28T00:00:00", "productId": 1, "expirationYear": 2026, "expirationMonth": 10},
            {"lastTradeDate": "2026-10-29T00:00:00", "productId": 10141, "expirationYear": 2026, "expirationMonth": 10},
            {"lastTradeDate": "2026-10-30T00:00:00", "productId": 136, "expirationYear": 2026, "expirationMonth": 10},
        ]
    }]
    kept = listed_contracts(groups, date(2026, 10, 29))
    assert [item["expiry"] for item in kept] == [date(2026, 10, 29), date(2026, 10, 30)]
    quotes = {}
    strikes = set()
    index_chain({
        "strikePrices": [{
            "strikePrice": "7755.0",
            "call": {"last": "19.20", "priorSettle": "43.25"},
            "put": {"last": "-", "priorSettle": "15.10"},
        }]
    }, date(2026, 10, 29), quotes, strikes)
    assert quotes[(date(2026, 10, 29), to_millis(7755), "C")].ltp == 19.2
    assert quotes[(date(2026, 10, 29), to_millis(7755), "P")].ltp == 15.1
    assert quotes[(date(2026, 10, 29), to_millis(7755), "C")].oi is None


def test_nse_row_maps_call_and_put():
    quotes, strikes = rows_to_quotes(date(2026, 10, 27), [{
        "strikePrice": 22800,
        "CE": {"lastPrice": 120.5, "openInterest": 15},
        "PE": {"lastPrice": 88, "openInterest": 40},
    }])
    assert strikes == [to_millis(22800)]
    assert quotes[(date(2026, 10, 27), to_millis(22800), "C")].ltp == 120.5
    assert quotes[(date(2026, 10, 27), to_millis(22800), "P")].oi == 40

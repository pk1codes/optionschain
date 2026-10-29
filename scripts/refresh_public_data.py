"""Refresh the public ladder snapshots used by GitHub Pages."""

import asyncio
import json
from pathlib import Path

from app.main import load_ladder

OUT = Path(__file__).resolve().parent.parent / "docs" / "data"
SYMBOLS = ("NIFTY", "SPX", "XSP", "ES1!")


async def refresh() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    for symbol in SYMBOLS:
        dest = OUT / f"{symbol}.json"
        try:
            payload = await load_ladder(symbol)
            dest.write_text(json.dumps(payload))
            print(f"wrote {dest.name} spot={payload.get('spot')}")
        except Exception as exc:
            print(f"FAILED {symbol}: {exc}")
            if not dest.exists():
                missing.append(symbol)
    if missing:
        raise SystemExit(f"no snapshot for {', '.join(missing)}")


if __name__ == "__main__":
    asyncio.run(refresh())

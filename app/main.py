import asyncio
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.ladder import build_ladder
from app.providers.cboe import fetch_index
from app.providers.nse import fetch_nifty

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

_STATIC = Path(__file__).resolve().parent / "static"
_TTL = {"NIFTY": 180, "SPX": 60, "XSP": 60}
_cache: dict[str, tuple[float, dict]] = {}
_last_good: dict[str, dict] = {}
_locks: dict[str, asyncio.Lock] = {}

app = FastAPI(title="Options ladder")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pk1codes.github.io",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=_STATIC), name="static")


async def _fetch(symbol: str):
    if symbol == "NIFTY":
        return await fetch_nifty()
    return await fetch_index(symbol)


async def load_ladder(symbol: str) -> dict:
    lock = _locks.setdefault(symbol, asyncio.Lock())
    async with lock:
        cached = _cache.get(symbol)
        if cached and time.monotonic() - cached[0] < _TTL[symbol]:
            return cached[1]
        try:
            payload = build_ladder(await _fetch(symbol))
            payload["stale"] = False
            payload["error"] = None
            payload["fetchedAt"] = datetime.now(timezone.utc).isoformat()
            payload["refreshSeconds"] = _TTL[symbol]
            _cache[symbol] = (time.monotonic(), payload)
            _last_good[symbol] = payload
            return payload
        except Exception as exc:
            log.exception("Failed to load %s", symbol)
            if symbol in _last_good:
                stale = dict(_last_good[symbol])
                stale["stale"] = True
                stale["error"] = str(exc)
                return stale
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC / "index.html")


@app.get("/api/ladder")
async def ladder(symbol: str = "NIFTY") -> dict:
    key = symbol.upper()
    if key not in _TTL:
        raise HTTPException(status_code=400, detail="symbol must be NIFTY, SPX, or XSP")
    return await load_ladder(key)

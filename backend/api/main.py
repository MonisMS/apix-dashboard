"""APIx REST API -- the index, its drill-downs, and the evidence behind it.

    cd /home/monis/sih2026
    uvicorn api.main:app --reload --port 8000

Run from the repo root: `apix` is imported by path, not installed. The same
command works on a host -- there is no PYTHONPATH trick, because this is a
package and its imports are relative.

Design rules worth knowing before changing anything here:

* The API **never writes**. Connections are opened read-only, so a web process
  cannot migrate or mutate the series. `apix.db.connect()` is deliberately not
  used -- it runs `executescript(SCHEMA)` on open.
* The whole pipeline is computed once per data state and cached (see cache.py).
* Nothing is fabricated. Where a number cannot yet exist -- weekly frequencies,
  the MoSPI comparison, a route nobody has collected -- the response says so in
  a field, with `points: null`, rather than returning an empty list that reads
  like "no movement".
"""
import datetime
import os
import pathlib
import sqlite3

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env")

from . import cache
from .services import agent as agent_svc
from .services import collection as collection_svc
from .services import index as index_svc
from .services import reference as reference_svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
DB_PATH = os.getenv("APIX_DB") or str(ROOT / "apix" / "data" / "apix.db")
API_VERSION = "1.0.0"

# Deployed dashboard origins are added via the APIX_CORS_ORIGINS env var rather
# than hardcoded, so a new Vercel preview URL never needs a redeploy of the API.
CORS_ORIGINS = [
    o.strip() for o in os.getenv(
        "APIX_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()
]

app = FastAPI(
    title="APIx — Real-time Airfare Price Index",
    description="Daily airfare price index for India, computed on MoSPI's own "
                "CPI 2024 method: Jevons at the elementary level, Young at the "
                "higher level.",
    version=API_VERSION,
    docs_url="/docs",
)
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"],
    allow_headers=["*"],
)


# --- plumbing --------------------------------------------------------------

def open_ro():
    """A read-only connection. The API must not be able to change the series."""
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        raise HTTPException(503, "database not readable")
    con.execute("PRAGMA query_only=1")
    return con


def snapshot(con, refresh=False):
    return cache.get(con, index_svc.build, refresh=refresh)


def envelope(res, payload: dict) -> dict:
    """Every response carries the same reference and provenance header."""
    return {
        "meta": {
            "api_version": API_VERSION,
            "generated_at": res["generated_at"],
            "served_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "reference": res["reference"],
            "n_collection_days": len(res["_obs"]),
        },
        **payload,
    }


def fail(code: str, message: str, status: int, **detail):
    raise HTTPException(status, {"code": code, "message": message, "detail": detail})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    d = exc.detail
    if isinstance(d, dict) and "code" in d:
        body = d
    else:
        body = {"code": "ERROR", "message": str(d), "detail": {}}
    body["status"] = exc.status_code
    body["at"] = datetime.datetime.now().isoformat(timespec="seconds")
    return JSONResponse({"error": body}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    return JSONResponse({"error": {
        "code": "INTERNAL_ERROR", "message": str(exc), "status": 500,
        "at": datetime.datetime.now().isoformat(timespec="seconds"),
    }}, status_code=500)


# --- endpoints -------------------------------------------------------------

@app.get("/api/v1/health")
def health():
    con = open_ro()
    from apix.migrate import EXPECTED_VERSION, current_version
    try:
        schema = current_version(con)
    except sqlite3.OperationalError:
        schema = None
    obs, last = con.execute(
        "SELECT COUNT(*), MAX(collected_at) FROM fare_observation").fetchone()
    ok = schema == EXPECTED_VERSION
    return {
        "status": "ok" if ok else "degraded",
        "api_version": API_VERSION,
        "database": {"path": DB_PATH, "schema_version": schema,
                     "expected_schema_version": EXPECTED_VERSION,
                     "observations": obs, "last_collected_at": last},
        "cache": cache.status(),
    }


@app.get("/api/v1/index")
def index(refresh: bool = False):
    """The headline series, APIX.ALL."""
    con = open_ro()
    res = snapshot(con, refresh)
    return envelope(res, index_svc.headline(res))


@app.get("/api/v1/series")
def series():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.catalogue(res))


@app.get("/api/v1/routes")
def routes():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.route_list(res))


@app.get("/api/v1/routes/{pair}")
def route(pair: str):
    con = open_ro()
    res = snapshot(con)
    out = index_svc.route_detail(res, pair)
    if out is None:
        basket = index_svc.route_list(res)["routes"]
        # A route not in the basket does not exist -> 404. A basket route with no
        # fares DOES exist and returns 200 with an explicit no-data state; a 404
        # there would tell the client the route is fictional and hide the very
        # coverage gap this endpoint is meant to expose.
        fail("ROUTE_NOT_FOUND", f"No route '{pair.upper()}' in the APIx basket.", 404,
             requested=pair.upper(), basket_routes=[r["pair"] for r in basket])
    return envelope(res, out)


@app.get("/api/v1/carriers")
def carriers():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.carrier_list(res))


@app.get("/api/v1/carriers/{code}")
def carrier(code: str):
    con = open_ro()
    res = snapshot(con)
    out = index_svc.carrier_detail(res, code)
    if out is None:
        known = [c["carrier"] for c in index_svc.carrier_list(res)["carriers"]]
        fail("CARRIER_NOT_FOUND", f"No carrier '{code}' in the observed data.", 404,
             requested=code, carriers=known)
    return envelope(res, out)


@app.get("/api/v1/windows")
def windows():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.windows(res))


@app.get("/api/v1/heatmap")
def heatmap(metric: str = Query("pct_change",
                                pattern="^(pct_change|level|mean_fare|n_offers)$")):
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.heatmap(res, metric))


@app.get("/api/v1/weights")
def weights():
    con = open_ro()
    res = snapshot(con)
    payload = index_svc.weights_tree(res)
    payload["cpi_context"] = reference_svc.cpi_context()
    return envelope(res, payload)


@app.get("/api/v1/collection")
def collection():
    con = open_ro()
    res = snapshot(con)
    payload = collection_svc.coverage(con, res)
    payload.update(collection_svc.sweeps(con))
    return envelope(res, payload)


@app.get("/api/v1/collection/runs")
def collection_runs(limit: int = 200):
    con = open_ro()
    res = snapshot(con)
    return envelope(res, collection_svc.run_log(con, limit))


@app.get("/api/v1/validation")
def validation():
    con = open_ro()
    res = snapshot(con)
    payload = reference_svc.validation(res)
    payload["audit"] = index_svc.audit(res)
    return envelope(res, payload)


@app.get("/api/v1/tariffs")
def tariffs():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, reference_svc.tariffs())


@app.get("/api/v1/methodology")
def methodology():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, {"methodology": index_svc.methodology(res),
                          "coverage": index_svc.coverage(res)})


@app.get("/api/v1/availability")
def availability():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.availability(res, con))


@app.get("/api/v1/cleaning")
def cleaning():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.cleaning(res))


@app.get("/api/v1/audit")
def audit():
    con = open_ro()
    res = snapshot(con)
    return envelope(res, index_svc.audit(res))


@app.get("/api/v1/split")
def split():
    """Base fare vs taxes -- PS deliverable (b)'s money fields, and an honest
    account of which two of the four are observable."""
    con = open_ro()
    res = snapshot(con)
    con.row_factory = sqlite3.Row
    return envelope(res, {"split": reference_svc.fare_split(con)})


class AskMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[AskMessage] = []


@app.post("/api/v1/ask")
def ask(body: AskRequest):
    """AskAI -- a tool-calling agent that answers questions about the index.

    Read-only like every endpoint above: the agent only calls the same
    service functions the REST endpoints use, against this same connection.
    It never writes to apix.db and never fabricates a number -- see
    api/services/agent.py's module docstring for the grounding rules.
    """
    con = open_ro()
    res = snapshot(con)
    try:
        result = agent_svc.ask(con, res, body.question,
                               [m.model_dump() for m in body.history])
    except agent_svc.AgentError as e:
        fail(e.code, e.message, e.status)
    return envelope(res, result)

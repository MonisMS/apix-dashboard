"""AskAI -- a tool-calling agent, with an honest deterministic fallback.

Design rule inherited from `api/main.py` and enforced here, not just stated:
the model never states a fare, index level, or percentage from its own
"knowledge". Every number in a model-tier answer must come from a tool call
that runs the same read-only service functions the REST endpoints use.

Two answer tiers, reported to the client rather than hidden:

* TIER_MODEL -- the configured OpenRouter model answered, grounded by its own
  tool calls in this conversation.
* TIER_LOCAL -- no model is configured, or the model call failed or timed
  out, so a deterministic local answer was built instead: either a canned
  explanation of a documented methodology fact, or a templated answer built
  directly from a tool call, with no LLM involved. A fallback answer is never
  presented as a model answer -- `tier` and `note` always say which happened.

Tool results sent back to the model are size-compacted (`_compact`): a list
nested two levels deep in a tool's JSON is summarised to its length rather
than sent in full. Several endpoints here are tens of kilobytes of raw
history (tariff level ladders, per-window daily series, per-day collection
detail) that a REST client wants in full but a chat turn does not -- sending
all of it back into a multi-round tool-calling conversation is what made an
early version of this endpoint take 60-150s per question on a free-tier
model. The top-level scalars a question is usually about (current level,
weight, mean fare) survive compaction; a deep time series does not.
"""
import concurrent.futures
import json
import os
import time

from apix.index.config import LEAD_TIMES

from . import collection as collection_svc
from . import index as index_svc
from . import reference as reference_svc

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "nex-agi/nex-n2.5-mini:free")
MAX_TOOL_ITERATIONS = 2
CALL_TIMEOUT_SECONDS = 15
OVERALL_BUDGET_SECONDS = 35

TIER_MODEL = "model"
TIER_LOCAL = "local_fallback"

SYSTEM_PROMPT = """You are AskAI, embedded in the APIx dashboard -- a daily \
airfare price index for India built on MoSPI's CPI 2024 method (Jevons at the \
elementary level, Young aggregation).

Scope: you answer questions about this index only -- its routes, carriers, \
booking windows, methodology, weights, data quality and collection coverage. \
If asked something unrelated (general chit-chat, other datasets, coding help, \
anything outside this project), decline briefly and redirect to what you can \
answer.

Hard rule: you must never state a fare, index level, percentage change, or any \
other figure from memory or estimation. Every number in your answer must come \
from a tool call you made in this conversation. Call one or more tools before \
answering any question that needs data. If a tool result says a route is not \
in the basket, has no data yet, or a frequency does not exist, say exactly \
that -- do not guess, extrapolate, or fill the gap with a plausible-sounding \
number. Some tool results are size-compacted: a field showing "N items \
omitted" means real data exists but was trimmed for brevity, not that it is \
missing -- say what you have rather than claiming ignorance of the whole field.

Be concise and specific: name the routes/carriers/dates the data actually \
gives you. When you cite a level or percentage, say which series it is from \
(e.g. "the DEL-BOM route index" vs "the headline APIx.ALL index").

Formatting: plain markdown only (**bold**, `code`, bullet lists) -- the client \
does not render LaTeX, so never use \\[, \\(, \\frac, \\operatorname or similar \
TeX syntax. Write formulas the way this example does: "I_t = GM_i(p_t^i / \
p_{t-1}^i) * I_{t-1}", in a `code span`, not as a LaTeX equation."""


# --- tool implementations ---------------------------------------------------
# Each handler takes (con, res, args) and returns a JSON-serialisable dict --
# the same shape (or a strict subset) the matching REST endpoint returns, so
# an answer traces back to a real, inspectable response.

def _tool_headline_index(con, res, args):
    return index_svc.headline(res)


def _tool_list_routes(con, res, args):
    return index_svc.route_list(res)


def _tool_route_detail(con, res, args):
    pair = (args.get("pair") or "").upper()
    out = index_svc.route_detail(res, pair)
    if out is None:
        return {"found": False, "requested": pair,
                "reason": f"'{pair}' is not one of the routes in the APIx basket.",
                "basket_routes": [r["pair"] for r in index_svc.route_list(res)["routes"]]}
    return {"found": True, **out}


def _tool_list_carriers(con, res, args):
    return index_svc.carrier_list(res)


def _tool_carrier_detail(con, res, args):
    code = args.get("carrier") or ""
    out = index_svc.carrier_detail(res, code)
    if out is None:
        known = [c["carrier"] for c in index_svc.carrier_list(res)["carriers"]]
        return {"found": False, "requested": code,
                "reason": f"No carrier '{code}' in the observed data.",
                "known_carriers": known}
    return {"found": True, **out}


def _tool_windows(con, res, args):
    return index_svc.windows(res)


def _tool_heatmap(con, res, args):
    metric = args.get("metric", "pct_change")
    if metric not in ("pct_change", "level", "mean_fare", "n_offers"):
        return {"error": f"'{metric}' is not a valid metric. Use one of "
                          "pct_change, level, mean_fare, n_offers."}
    return index_svc.heatmap(res, metric)


def _tool_weights(con, res, args):
    payload = index_svc.weights_tree(res)
    payload["cpi_context"] = reference_svc.cpi_context()
    return payload


def _tool_collection(con, res, args):
    payload = collection_svc.coverage(con, res)
    payload.update(collection_svc.sweeps(con))
    return payload


def _tool_collection_runs(con, res, args):
    limit = int(args.get("limit") or 20)
    return collection_svc.run_log(con, min(limit, 100))


def _tool_validation(con, res, args):
    payload = reference_svc.validation(res)
    payload["audit"] = index_svc.audit(res)
    return payload


def _tool_tariffs(con, res, args):
    out = reference_svc.tariffs()
    airline = (args.get("airline") or "").strip().lower()
    markets = out["markets"]
    if airline:
        matched = [m for m in markets if airline in m["airline"].lower()]
        out = {**out, "markets": matched, "n_markets_returned": len(matched),
               "filtered_by_airline": airline}
    elif len(markets) > 15:
        # 118 markets of tariff bands is too much for a chat turn by default; a
        # question about a specific carrier should pass `airline` instead.
        out = {**out, "markets": markets[:15], "n_markets_returned": 15,
               "note": f"{out['n_markets']} markets exist in total; showing the first 15. "
                       f"Call again with an `airline` argument for that carrier's markets."}
    return out


def _tool_methodology(con, res, args):
    return {"methodology": index_svc.methodology(res), "coverage": index_svc.coverage(res)}


def _tool_availability(con, res, args):
    return index_svc.availability(res, con)


def _tool_cleaning(con, res, args):
    return index_svc.cleaning(res)


def _tool_audit(con, res, args):
    return index_svc.audit(res)


def _tool_split(con, res, args):
    import sqlite3
    con.row_factory = sqlite3.Row
    return {"split": reference_svc.fare_split(con)}


def _tool_series_catalogue(con, res, args):
    return index_svc.catalogue(res)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_headline_index",
            "description": "The headline APIx.ALL series: every published daily point, "
                            "the reference window, methodology summary, coverage, and the "
                            "naive-unmatched comparison series. Use this for 'how has the "
                            "index moved', 'what's today's level' or 'summarize this week'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_routes",
            "description": "Every route in the DGCA basket, including the ones with no "
                            "fares collected yet, each with its weight, latest index level "
                            "and day-on-day change. Use to find which route is cheapest, "
                            "most volatile, or which routes lack data.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_route_detail",
            "description": "Full detail for one route: its series, per-lead-window "
                            "breakdown, per-carrier fares, and daily fare spread. Returns "
                            "found=false with the real basket list if the pair is not "
                            "tracked -- report that honestly rather than guessing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pair": {"type": "string",
                              "description": "Origin-destination IATA pair, e.g. 'DEL-BOM'."},
                },
                "required": ["pair"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_carriers",
            "description": "Every carrier observed in the data with its weight share, "
                            "offer count, mean fare and index level.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_carrier_detail",
            "description": "Full detail for one carrier: its series, routes flown, and "
                            "per-lead-window fares.",
            "parameters": {
                "type": "object",
                "properties": {
                    "carrier": {"type": "string",
                                 "description": "Carrier name, e.g. 'IndiGo' or 'Air India'."},
                },
                "required": ["carrier"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_booking_windows",
            "description": f"The advance-purchase sub-indices at lead times {LEAD_TIMES} "
                            "days, each with its current level, mean fare and weight in the "
                            "headline. Use for 'which lead time is cheapest right now' or "
                            "'how far ahead should I book'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_heatmap",
            "description": "Route x collection-date matrix for one metric.",
            "parameters": {
                "type": "object",
                "properties": {
                    "metric": {"type": "string",
                               "enum": ["pct_change", "level", "mean_fare", "n_offers"],
                               "description": "Defaults to pct_change."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weights",
            "description": "The expenditure-share weight tree (by route, lead time, "
                            "carrier) and where airfare sits inside the wider CPI basket.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_collection_status",
            "description": "Scrape coverage: which basket routes have been attempted vs "
                            "have fares, collection-hour drift, and recent sweep summaries. "
                            "Use for 'is the data fresh' or 'why is a route missing'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_collection_runs",
            "description": "Recent individual collection run log entries (one per "
                            "route/lead/date fetch attempt), most recent first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer",
                               "description": "Max rows, default 20, capped at 100."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_validation",
            "description": "Comparison against MoSPI's published Airfare CPI series "
                            "(currently no overlapping period -- the tool says so), the "
                            "transitivity audit, and MoSPI worked-example reproduction.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tariffs",
            "description": "Rule-135 published tariff-sheet bands per airline/market pair "
                            "-- reference bands, not transacted fares. There are 100+ "
                            "markets in total, so pass `airline` to get one carrier's "
                            "markets rather than the truncated default list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "airline": {"type": "string",
                                 "description": "Optional carrier name filter, e.g. "
                                                 "'IndiGo'."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_methodology",
            "description": "The full methodology: elementary and higher-level formulas, "
                            "MoSPI worked-example reproduction, weighting rationale, and "
                            "the documented caveats. Use for any 'how is this computed' "
                            "or 'what does Jevons/Young mean here' question.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_availability",
            "description": "Disappearance / sold-out analysis: how much of the basket "
                            "could not be quoted on a given day and why.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_cleaning",
            "description": "The cleaning/imputation pipeline report and its sensitivity "
                            "to different screening rules.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_audit",
            "description": "The transitivity/reproducibility audit trail for the index "
                            "computation itself.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fare_split",
            "description": "Base-fare vs taxes split, where observed. Explicitly reports "
                            "when unavailable rather than estimating a split.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_series",
            "description": "Catalogue of every series the API can produce (headline, "
                            "per-route, per-carrier, per-window) with its weight share.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

_HANDLERS = {
    "get_headline_index": _tool_headline_index,
    "list_routes": _tool_list_routes,
    "get_route_detail": _tool_route_detail,
    "list_carriers": _tool_list_carriers,
    "get_carrier_detail": _tool_carrier_detail,
    "get_booking_windows": _tool_windows,
    "get_heatmap": _tool_heatmap,
    "get_weights": _tool_weights,
    "get_collection_status": _tool_collection,
    "get_collection_runs": _tool_collection_runs,
    "get_validation": _tool_validation,
    "get_tariffs": _tool_tariffs,
    "get_methodology": _tool_methodology,
    "get_availability": _tool_availability,
    "get_cleaning": _tool_cleaning,
    "get_audit": _tool_audit,
    "get_fare_split": _tool_split,
    "list_series": _tool_series_catalogue,
}


# --- payload compaction ------------------------------------------------------
# A list two levels deep in a tool's JSON is where the byte count lives (a
# time series per route, a tariff's price-level ladder, a day-by-day
# breakdown) and is rarely what a chat question is actually about. Anything
# shallower -- the routes list itself, a route's own scalar fields -- is kept
# whole, because that is exactly the data a ranking question ("which route is
# cheapest") needs to see in full.
_COMPACT_DEPTH = 2
_COMPACT_LIST_LEN = 4


def _compact(obj, depth=0):
    if isinstance(obj, dict):
        return {k: _compact(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        if depth >= _COMPACT_DEPTH and len(obj) > _COMPACT_LIST_LEN:
            return f"[{len(obj)} items omitted for brevity]"
        return [_compact(x, depth + 1) for x in obj]
    return obj


# --- deterministic local fallback -------------------------------------------
# Used when no model is configured, or the model call fails or times out.
# Never presented as a model answer -- callers set tier=TIER_LOCAL and a note
# saying so. Data-shaped questions are answered by calling a handler directly
# and templating the real numbers; everything else falls back to a canned
# explanation of a documented methodology fact, or a generic pointer.

_LOCAL_TOPICS = [
    (("jevons", "elementary", "geometric mean"),
     "**Elementary aggregate -- Jevons.** Each route/lead/carrier/departure-band cell "
     "is a Jevons short index: the unweighted geometric mean of matched price relatives "
     "between consecutive collection days, chained forward "
     "(`I_t = GM_i(p_t^i / p_{t-1}^i) * I_{t-1}`; MoSPI EG 4.6.1.1 p.50, CPI Manual "
     "eq. 9.1). Matched means the price relative is only formed between the *same* "
     "flight (carrier + flight number) on two different days -- a route with more "
     "long-haul or last-minute quotes on one day does not read as inflation."),
    (("young", "higher level", "aggregat"),
     "**Higher-level aggregate -- Young.** Cell-level indices are combined with a Young "
     "weighted arithmetic mean, weights summing to 1.0 (`I = sum_j(w_j * I_j)`; MoSPI EG "
     "4.6.2.4 p.53, CPI Manual eq. 9.11). Weights are expenditure shares -- passengers "
     "times mean fare -- not passenger counts alone."),
    (("booking window", "lead time", "advance", "t+1", "t+7", "t+15", "t+30", "t+45"),
     f"**Booking windows.** Five advance-purchase lead times are tracked: "
     f"{', '.join(f'T+{d}' for d in LEAD_TIMES)} days. Each is indexed separately and "
     "combined into the headline with a uniform 0.2 weight each -- a declared "
     "assumption, not a derived booking-lag distribution, because the true mix of "
     "when tickets are actually bought is not published. Use get_booking_windows for "
     "which one is currently cheapest."),
    (("weight", "basket", "expenditure share"),
     "**Weights.** Route, lead-time and carrier weights are expenditure shares "
     "(passengers x mean fare), not raw passenger counts -- the CPI Manual and MoSPI's "
     "Expert Group Report both require price times quantity. Because our observations "
     "are offers rather than transactions, this is an offer-mix mean rather than a "
     "true passenger yield."),
    (("mospi", "validat", "compare", "official"),
     "**Validation against MoSPI.** MoSPI's published Airfare CPI series and APIx's own "
     "collection window do not currently overlap, so no correlation is computed or "
     "claimed. What can be shown instead: MoSPI's own worked examples reproduced to 4 "
     "decimal places, and the transitivity audit (chained vs. direct fixed-base) proving "
     "the arithmetic is internally consistent."),
    (("provisional", "coverage", "collect", "fresh", "sweep", "scrape"),
     "**Collection honesty.** Every response carries a coverage block naming exactly "
     "which basket routes have fares and which don't, rather than a route silently "
     "reading as zero. The reference window is provisional and will be re-referenced "
     "without revising any published link. Ask about collection status for the current "
     "sweep count and timing."),
    (("imput", "clean", "outlier", "missing price"),
     "**Cleaning and imputation.** A missing price on a matched flight is imputed as "
     "`Price_t-1 * GM(available price relatives)` -- never simple carry-forward, which "
     "is prohibited (MoSPI EG 4.6.4.3 p.56). The cleaning report shows how sensitive the "
     "index is to different screening rules, because a screening choice made invisibly "
     "would be an editorial decision dressed as data cleaning."),
    (("tax", "base fare", "split"),
     "**Base fare / tax split.** Observed for two of the four PS money fields (base "
     "fare and the carrier's own 'taxes and fees' line); UDF and OTA convenience fees "
     "are never itemised by any source found, so they stay null rather than being "
     "modelled. The split is a periodic panel study, not backfilled into the daily "
     "series, because the two sources price different things."),
    (("tariff", "rule 135", "published fare"),
     "**Published tariffs.** Rule 135 of the Aircraft Rules, 1937 requires every Indian "
     "carrier to publish its tariff -- these are reference bands (the range a fare must "
     "sit inside), not transacted prices, and never enter the index as observed quotes."),
    (("naive", "unmatched", "why match"),
     "**Why matching matters.** A naive unmatched-average series (published alongside "
     "the real index, never used for it) is computed from the exact same observations "
     "with no flight-matching step. It diverges from the real index because the sample "
     "of what's on sale changes day to day -- that divergence is sample churn being "
     "reported as inflation, which is exactly what Jevons matching removes."),
]


def _basket_pairs(res):
    return sorted(f"{c.origin}-{c.destination}" for c in {
        (c.origin, c.destination) for c in res["_weights"]})


def _cheapest_route(res):
    routes = [r for r in index_svc.route_list(res)["routes"] if r["has_data"]
              and r["mean_fare_latest"] is not None]
    if not routes:
        return None
    return min(routes, key=lambda r: r["mean_fare_latest"])


def _local_data_answer(question: str, con, res):
    """Try a handful of common data-shaped questions with a direct, templated
    (non-LLM) answer built from a real tool call. Returns None if nothing matched."""
    q = question.lower()

    if any(k in q for k in ("cheapest", "cheaper", "lowest fare")):
        r = _cheapest_route(res)
        if r is None:
            return ("No basket route has both fares and a computed level yet, so I "
                    "can't name a cheapest route."), []
        return (f"By latest mean offered fare, **{r['pair']}** is currently cheapest at "
                f"roughly ₹{r['mean_fare_latest']:,.0f} (index level "
                f"{r['level']}, day-on-day change "
                f"{r['pct_change_1p']:+.2f}%)." if r['pct_change_1p'] is not None else
                f"By latest mean offered fare, **{r['pair']}** is currently cheapest at "
                f"roughly ₹{r['mean_fare_latest']:,.0f} (index level {r['level']})."
                ), [{"tool": "list_routes", "arguments": {}}]

    if any(k in q for k in ("no data", "not collected", "missing route", "no fares",
                             "which routes", "what routes")):
        routes = index_svc.route_list(res)["routes"]
        missing = [r["pair"] for r in routes if not r["has_data"]]
        if not missing:
            return (f"Every one of the {len(routes)} basket routes has fares collected "
                     "-- none are missing."), [{"tool": "list_routes", "arguments": {}}]
        return (f"{len(missing)} of {len(routes)} basket routes have no fares collected "
                f"yet: {', '.join(missing)}. They're in the DGCA basket but carry zero "
                f"weight until the collector sweeps them."
                ), [{"tool": "list_routes", "arguments": {}}]

    if any(k in q for k in ("headline", "current index", "index level", "how has the index",
                             "index move")):
        h = index_svc.headline(res)
        pts = h["points"]
        if not pts:
            return "No headline points are published yet.", []
        last = pts[-1]
        return (f"The headline APIx.ALL index is at **{last['level']}** as of "
                f"{last['period_end']}"
                + (f", a change of {last['pct_change_1p']:+.2f}% from the previous "
                   f"collection day" if last.get('pct_change_1p') is not None else "")
                + f". Reference window: {h['reference'].get('label', 'n/a')}."
                ), [{"tool": "get_headline_index", "arguments": {}}]

    return None


def answer_locally(question: str, con, res) -> dict:
    lowered = question.lower()

    direct = _local_data_answer(question, con, res)
    if direct is not None:
        text, tools_used = direct
        return {"answer": text, "tier": TIER_LOCAL, "model": None,
                "tools_used": tools_used,
                "note": "Answered directly from live data, without a language model."}

    for keywords, response in _LOCAL_TOPICS:
        if any(k in lowered for k in keywords):
            return {"answer": response, "tier": TIER_LOCAL, "model": None, "tools_used": [],
                    "note": "Answered from the local methodology knowledge base, without "
                            "a language model."}

    h = index_svc.headline(res)
    pts = h["points"]
    last = pts[-1] if pts else None
    summary = (f"Headline index: **{last['level']}** as of {last['period_end']}.\n"
               if last else "No headline points are published yet.\n")
    return {
        "answer": (
            "I don't have a prepared answer for that, and no language model is available "
            "right now, so I won't speculate.\n\n" + summary +
            "\nI can explain: the Jevons/Young formulas, booking-window stratification, "
            "route and carrier weights, the MoSPI validation status, data collection "
            "coverage, cleaning/imputation, the base-fare/tax split, or published "
            "tariffs -- or ask which route or carrier you want the numbers for."
        ),
        "tier": TIER_LOCAL, "model": None, "tools_used": [{"tool": "get_headline_index", "arguments": {}}],
        "note": "Answered from the local knowledge base, without a language model.",
    }


class AgentError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def _client():
    from openai import OpenAI

    api_key = os.getenv("OPENROUTER_API_KEY")
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        timeout=CALL_TIMEOUT_SECONDS,
        max_retries=0,  # we retry via our own fallback-to-local path, not the SDK's
        default_headers={
            "HTTP-Referer": os.getenv("APIX_PUBLIC_URL", "http://localhost:5173"),
            "X-Title": "APIx AskAI",
        },
    )


# The openai SDK's own `timeout=` is not reliably enforced from inside a
# FastAPI sync route (which runs on a worker thread) against every model this
# gets pointed at -- a slow/overloaded free-tier model has been observed to
# hang well past its configured timeout with no exception ever raised. A
# thread-pool future with its own `.result(timeout=...)` bounds it for real:
# the call is killed from our side regardless of what the SDK does.
_LLM_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="askai-llm")


def _complete(client, messages, use_tools):
    future = _LLM_EXECUTOR.submit(
        client.chat.completions.create,
        model=OPENROUTER_MODEL,
        messages=messages,
        tools=TOOLS if use_tools else None,
        tool_choice="auto" if use_tools else "none",
    )
    try:
        return future.result(timeout=CALL_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        # The call may still complete in the background on its own thread; we
        # abandon it rather than block this request any further.
        raise TimeoutError(f"AI provider call did not return within "
                           f"{CALL_TIMEOUT_SECONDS}s")


def _ask_model(con, res, question: str, history: list[dict]) -> dict:
    """The tool-calling loop against OpenRouter. Raises on any failure so the
    caller can fall back locally -- never returns a partial/broken answer."""
    client = _client()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history or []:
        role = m.get("role")
        content = m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    tools_used = []
    deadline = time.monotonic() + OVERALL_BUDGET_SECONDS
    for _ in range(MAX_TOOL_ITERATIONS):
        if time.monotonic() > deadline:
            raise TimeoutError(f"exceeded the {OVERALL_BUDGET_SECONDS}s AskAI time budget")

        completion = _complete(client, messages, use_tools=True)
        message = completion.choices[0].message
        tool_calls = message.tool_calls or []

        if not tool_calls:
            return {"answer": message.content or "", "tier": TIER_MODEL,
                    "tools_used": tools_used, "model": OPENROUTER_MODEL,
                    "note": f"Answered by {OPENROUTER_MODEL} via {len(tools_used)} tool "
                            f"call(s)." if tools_used else
                            f"Answered by {OPENROUTER_MODEL}."}

        messages.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": [tc.model_dump() for tc in tool_calls],
        })

        for tc in tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            handler = _HANDLERS.get(name)
            if handler is None:
                result = {"error": f"Unknown tool '{name}'."}
            else:
                try:
                    result = handler(con, res, args)
                except Exception as e:  # noqa: BLE001 -- surfaced to the model, not the user
                    result = {"error": f"Tool failed: {e}"}
            tools_used.append({"tool": name, "arguments": args})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(_compact(result), default=str),
            })

    if time.monotonic() > deadline:
        raise TimeoutError(f"exceeded the {OVERALL_BUDGET_SECONDS}s AskAI time budget")

    # Bounded loop exhausted -- force a final answer from what has been
    # gathered rather than looping forever on a misbehaving model.
    messages.append({
        "role": "user",
        "content": "You have used the maximum number of tool calls allowed. Answer now "
                   "using only the data already returned above. If it is not enough to "
                   "answer fully, say so explicitly.",
    })
    completion = _complete(client, messages, use_tools=False)
    return {"answer": completion.choices[0].message.content or "", "tier": TIER_MODEL,
            "tools_used": tools_used, "model": OPENROUTER_MODEL,
            "note": f"Answered by {OPENROUTER_MODEL} after reaching the tool-call limit."}


def ask(con, res, question: str, history: list[dict]) -> dict:
    """Answer a question, preferring the model and falling back locally.

    `history` is a list of {role, content} from the client -- prior turns for
    conversational context only. Tool call/result messages are never accepted
    from the client; every tool invocation happened in this call, against the
    live read-only connection. Never raises for a model/provider failure --
    only for a genuinely empty question -- so the endpoint always returns a
    real answer, honestly labelled with the tier that produced it.
    """
    if not question or not question.strip():
        raise AgentError("EMPTY_QUESTION", "Ask a question first.", 400)

    if not os.getenv("OPENROUTER_API_KEY"):
        out = answer_locally(question, con, res)
        out["note"] = ("AskAI has no model configured on this server "
                       "(OPENROUTER_API_KEY is not set). " + out["note"])
        return out

    try:
        return _ask_model(con, res, question, history)
    except Exception as e:  # noqa: BLE001 -- any provider/network failure falls back
        reason = str(e) or type(e).__name__
        out = answer_locally(question, con, res)
        out["note"] = (f"The language model could not answer this ({reason}). "
                       + out["note"])
        return out

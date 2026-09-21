// Generated from api/services/agent.py -- the system prompt, the 18 tool
// schemas, the deterministic fallback topics and the time budget, transcribed
// mechanically so the model sees exactly what the Python agent showed it.
// Regenerate rather than hand-edit.

export const SYSTEM_PROMPT = "You are AskAI, embedded in the APIx dashboard -- a daily airfare price index for India built on MoSPI's CPI 2024 method (Jevons at the elementary level, Young aggregation).\n\nScope: you answer questions about this index only -- its routes, carriers, booking windows, methodology, weights, data quality and collection coverage. If asked something unrelated (general chit-chat, other datasets, coding help, anything outside this project), decline briefly and redirect to what you can answer.\n\nHard rule: you must never state a fare, index level, percentage change, or any other figure from memory or estimation. Every number in your answer must come from a tool call you made in this conversation. Call one or more tools before answering any question that needs data. If a tool result says a route is not in the basket, has no data yet, or a frequency does not exist, say exactly that -- do not guess, extrapolate, or fill the gap with a plausible-sounding number. Some tool results are size-compacted: a field showing \"N items omitted\" means real data exists but was trimmed for brevity, not that it is missing -- say what you have rather than claiming ignorance of the whole field.\n\nBe concise and specific: name the routes/carriers/dates the data actually gives you. When you cite a level or percentage, say which series it is from (e.g. \"the DEL-BOM route index\" vs \"the headline APIx.ALL index\").\n\nFormatting: plain markdown only (**bold**, `code`, bullet lists) -- the client does not render LaTeX, so never use \\[, \\(, \\frac, \\operatorname or similar TeX syntax. Write formulas the way this example does: \"I_t = GM_i(p_t^i / p_{t-1}^i) * I_{t-1}\", in a `code span`, not as a LaTeX equation." as const;

export const TOOLS = [
  {
    "type": "function",
    "function": {
      "name": "get_headline_index",
      "description": "The headline APIx.ALL series: every published daily point, the reference window, methodology summary, coverage, and the naive-unmatched comparison series. Use this for 'how has the index moved', 'what's today's level' or 'summarize this week'.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_routes",
      "description": "Every route in the DGCA basket, including the ones with no fares collected yet, each with its weight, latest index level and day-on-day change. Use to find which route is cheapest, most volatile, or which routes lack data.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_route_detail",
      "description": "Full detail for one route: its series, per-lead-window breakdown, per-carrier fares, and daily fare spread. Returns found=false with the real basket list if the pair is not tracked -- report that honestly rather than guessing.",
      "parameters": {
        "type": "object",
        "properties": {
          "pair": {
            "type": "string",
            "description": "Origin-destination IATA pair, e.g. 'DEL-BOM'."
          }
        },
        "required": [
          "pair"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_carriers",
      "description": "Every carrier observed in the data with its weight share, offer count, mean fare and index level.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_carrier_detail",
      "description": "Full detail for one carrier: its series, routes flown, and per-lead-window fares.",
      "parameters": {
        "type": "object",
        "properties": {
          "carrier": {
            "type": "string",
            "description": "Carrier name, e.g. 'IndiGo' or 'Air India'."
          }
        },
        "required": [
          "carrier"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_booking_windows",
      "description": "The advance-purchase sub-indices at lead times (1, 7, 15, 30, 45) days, each with its current level, mean fare and weight in the headline. Use for 'which lead time is cheapest right now' or 'how far ahead should I book'.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_heatmap",
      "description": "Route x collection-date matrix for one metric.",
      "parameters": {
        "type": "object",
        "properties": {
          "metric": {
            "type": "string",
            "enum": [
              "pct_change",
              "level",
              "mean_fare",
              "n_offers"
            ],
            "description": "Defaults to pct_change."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_weights",
      "description": "The expenditure-share weight tree (by route, lead time, carrier) and where airfare sits inside the wider CPI basket.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_collection_status",
      "description": "Scrape coverage: which basket routes have been attempted vs have fares, collection-hour drift, and recent sweep summaries. Use for 'is the data fresh' or 'why is a route missing'.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_collection_runs",
      "description": "Recent individual collection run log entries (one per route/lead/date fetch attempt), most recent first.",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "Max rows, default 20, capped at 100."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_validation",
      "description": "Comparison against MoSPI's published Airfare CPI series (currently no overlapping period -- the tool says so), the transitivity audit, and MoSPI worked-example reproduction.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_tariffs",
      "description": "Rule-135 published tariff-sheet bands per airline/market pair -- reference bands, not transacted fares. There are 100+ markets in total, so pass `airline` to get one carrier's markets rather than the truncated default list.",
      "parameters": {
        "type": "object",
        "properties": {
          "airline": {
            "type": "string",
            "description": "Optional carrier name filter, e.g. 'IndiGo'."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_methodology",
      "description": "The full methodology: elementary and higher-level formulas, MoSPI worked-example reproduction, weighting rationale, and the documented caveats. Use for any 'how is this computed' or 'what does Jevons/Young mean here' question.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_availability",
      "description": "Disappearance / sold-out analysis: how much of the basket could not be quoted on a given day and why.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_cleaning",
      "description": "The cleaning/imputation pipeline report and its sensitivity to different screening rules.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_audit",
      "description": "The transitivity/reproducibility audit trail for the index computation itself.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_fare_split",
      "description": "Base-fare vs taxes split, where observed. Explicitly reports when unavailable rather than estimating a split.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_series",
      "description": "Catalogue of every series the API can produce (headline, per-route, per-carrier, per-window) with its weight share.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  }
] as const;

export const LOCAL_TOPICS = [
  {
    "keywords": [
      "jevons",
      "elementary",
      "geometric mean"
    ],
    "answer": "**Elementary aggregate -- Jevons.** Each route/lead/carrier/departure-band cell is a Jevons short index: the unweighted geometric mean of matched price relatives between consecutive collection days, chained forward (`I_t = GM_i(p_t^i / p_{t-1}^i) * I_{t-1}`; MoSPI EG 4.6.1.1 p.50, CPI Manual eq. 9.1). Matched means the price relative is only formed between the *same* flight (carrier + flight number) on two different days -- a route with more long-haul or last-minute quotes on one day does not read as inflation."
  },
  {
    "keywords": [
      "young",
      "higher level",
      "aggregat"
    ],
    "answer": "**Higher-level aggregate -- Young.** Cell-level indices are combined with a Young weighted arithmetic mean, weights summing to 1.0 (`I = sum_j(w_j * I_j)`; MoSPI EG 4.6.2.4 p.53, CPI Manual eq. 9.11). Weights are expenditure shares -- passengers times mean fare -- not passenger counts alone."
  },
  {
    "keywords": [
      "booking window",
      "lead time",
      "advance",
      "t+1",
      "t+7",
      "t+15",
      "t+30",
      "t+45"
    ],
    "answer": "**Booking windows.** Five advance-purchase lead times are tracked: T+1, T+7, T+15, T+30, T+45 days. Each is indexed separately and combined into the headline with a uniform 0.2 weight each -- a declared assumption, not a derived booking-lag distribution, because the true mix of when tickets are actually bought is not published. Use get_booking_windows for which one is currently cheapest."
  },
  {
    "keywords": [
      "weight",
      "basket",
      "expenditure share"
    ],
    "answer": "**Weights.** Route, lead-time and carrier weights are expenditure shares (passengers x mean fare), not raw passenger counts -- the CPI Manual and MoSPI's Expert Group Report both require price times quantity. Because our observations are offers rather than transactions, this is an offer-mix mean rather than a true passenger yield."
  },
  {
    "keywords": [
      "mospi",
      "validat",
      "compare",
      "official"
    ],
    "answer": "**Validation against MoSPI.** MoSPI's published Airfare CPI series and APIx's own collection window do not currently overlap, so no correlation is computed or claimed. What can be shown instead: MoSPI's own worked examples reproduced to 4 decimal places, and the transitivity audit (chained vs. direct fixed-base) proving the arithmetic is internally consistent."
  },
  {
    "keywords": [
      "provisional",
      "coverage",
      "collect",
      "fresh",
      "sweep",
      "scrape"
    ],
    "answer": "**Collection honesty.** Every response carries a coverage block naming exactly which basket routes have fares and which don't, rather than a route silently reading as zero. The reference window is provisional and will be re-referenced without revising any published link. Ask about collection status for the current sweep count and timing."
  },
  {
    "keywords": [
      "imput",
      "clean",
      "outlier",
      "missing price"
    ],
    "answer": "**Cleaning and imputation.** A missing price on a matched flight is imputed as `Price_t-1 * GM(available price relatives)` -- never simple carry-forward, which is prohibited (MoSPI EG 4.6.4.3 p.56). The cleaning report shows how sensitive the index is to different screening rules, because a screening choice made invisibly would be an editorial decision dressed as data cleaning."
  },
  {
    "keywords": [
      "tax",
      "base fare",
      "split"
    ],
    "answer": "**Base fare / tax split.** Observed for two of the four PS money fields (base fare and the carrier's own 'taxes and fees' line); UDF and OTA convenience fees are never itemised by any source found, so they stay null rather than being modelled. The split is a periodic panel study, not backfilled into the daily series, because the two sources price different things."
  },
  {
    "keywords": [
      "tariff",
      "rule 135",
      "published fare"
    ],
    "answer": "**Published tariffs.** Rule 135 of the Aircraft Rules, 1937 requires every Indian carrier to publish its tariff -- these are reference bands (the range a fare must sit inside), not transacted prices, and never enter the index as observed quotes."
  },
  {
    "keywords": [
      "naive",
      "unmatched",
      "why match"
    ],
    "answer": "**Why matching matters.** A naive unmatched-average series (published alongside the real index, never used for it) is computed from the exact same observations with no flight-matching step. It diverges from the real index because the sample of what's on sale changes day to day -- that divergence is sample churn being reported as inflation, which is exactly what Jevons matching removes."
  }
] as const;

export const BUDGET = {
  "MAX_TOOL_ITERATIONS": 2,
  "CALL_TIMEOUT_SECONDS": 15,
  "OVERALL_BUDGET_SECONDS": 35,
  "COMPACT_DEPTH": 2,
  "COMPACT_LIST_LEN": 4,
  "MODEL": "nex-agi/nex-n2.5-mini:free",
  "TIER_LOCAL": "local_fallback",
  "TIER_MODEL": "model"
} as const;

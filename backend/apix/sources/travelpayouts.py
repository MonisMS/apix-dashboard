"""Travelpayouts / Aviasales fare data adapter.

Why this source:
  - Free, self-serve token. No scraping, no bot-evasion, no robots.txt issue.
  - Covers all carriers, so the index reflects the market, not one airline.
  - Terms permit programmatic access -- we can say that on stage and mean it.

Limitation we must state openly: these are cached fares from real user
searches (a few days old), not live quotes at the instant we ask. That is a
real caveat and we disclose it rather than hide it.

Token: free signup at travelpayouts.com -> set APIX_TP_TOKEN in the environment.
"""
import os, time, datetime, requests

NAME = "travelpayouts"
ENDPOINT = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"

def available():
    return bool(os.getenv("APIX_TP_TOKEN"))

def fetch(origin, destination, departure_date, lead_time_days, timeout=20):
    """Return (quotes, status, error). Never fabricates on failure."""
    token = os.getenv("APIX_TP_TOKEN")
    if not token:
        return [], "BLOCKED", "APIX_TP_TOKEN not set"

    params = {
        "origin": origin, "destination": destination,
        "departure_at": departure_date.isoformat(),
        "currency": "inr", "limit": 100, "one_way": "true",
        "sorting": "price", "token": token,
    }
    try:
        r = requests.get(ENDPOINT, params=params, timeout=timeout,
                         headers={"Accept-Encoding": "gzip"})
    except requests.RequestException as e:
        return [], "ERROR", str(e)[:300]

    if r.status_code == 401:
        return [], "BLOCKED", "401 unauthorized (bad or missing token)"
    if r.status_code != 200:
        return [], "ERROR", f"HTTP {r.status_code}"

    try:
        payload = r.json()
    except ValueError:
        return [], "ERROR", "response was not JSON"

    rows = payload.get("data") or []
    if not rows:
        return [], "NO_DATA", None

    now = datetime.datetime.now()
    quotes = []
    for row in rows:
        price = row.get("price")
        if price is None:
            continue
        quotes.append({
            "origin": origin, "destination": destination,
            "departure_date": departure_date,
            "lead_time_days": lead_time_days,
            "carrier": row.get("airline"),
            "flight_number": (f"{row.get('airline')}-{row['flight_number']}"
                              if row.get("flight_number") else None),
            "fare_class": "Economy",
            "total_fare": float(price),
            "currency": "INR",
            # We did NOT observe a fee breakdown. Leave NULL. Do not guess.
            "base_fare": None, "taxes": None, "udf": None,
            "convenience_fee": None,
            "availability": "AVAILABLE", "seats_left": None,
            "source": NAME,
            "source_url": row.get("link"),
            "collected_at": now,
            "is_observed": 1,
            "notes": "cached fare from aggregator search data",
        })
    return quotes, ("OK" if quotes else "NO_DATA"), None

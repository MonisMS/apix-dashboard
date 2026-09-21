"""SerpApi Google Flights adapter.

Why this source:
  - Licensed commercial API. We hold a contract; we are not scraping anyone
    ourselves, and we are not circumventing any site's protections.
  - Returns ALL carriers on a route, which a single-airline source cannot.
    Airlines price the same route differently, so multi-carrier coverage is a
    correctness requirement, not a nicety.
  - Precedent worth knowing: Statistics Norway abandoned its own web scrapers
    for a commercial API for exactly this reason.

Honest caveats we disclose rather than hide:
  - SerpApi scrapes Google Flights on our behalf. The collection is licensed,
    but the underlying source is still Google.
  - Google Flights shows offers, not transacted prices.

Key: free tier at serpapi.com -> set APIX_SERPAPI_KEY in the environment.
"""
import os, datetime, requests

NAME = "serpapi_google_flights"
ENDPOINT = "https://serpapi.com/search"


def available():
    return bool(os.getenv("APIX_SERPAPI_KEY"))


def _carrier_of(flight_leg):
    return (flight_leg.get("airline") or "").strip() or None


def fetch(origin, destination, departure_date, lead_time_days, timeout=45,
          key=None, key_label=None):
    """Return (quotes, status, error). Never fabricates on failure.

    `key` comes from the pool. Falls back to the single env key so the
    adapter still works standalone (e.g. test_source.py).
    """
    key = key or os.getenv("APIX_SERPAPI_KEY")
    if not key:
        return [], "BLOCKED", "no API key supplied"

    params = {
        "engine": "google_flights",
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": departure_date.isoformat(),
        "type": "2",              # one way
        "travel_class": "1",      # economy
        "adults": "1",
        "currency": "INR",
        "hl": "en",
        "gl": "in",
        "api_key": key,
    }
    try:
        r = requests.get(ENDPOINT, params=params, timeout=timeout)
    except requests.RequestException as e:
        return [], "ERROR", str(e)[:300]

    if r.status_code == 401:
        return [], "BLOCKED", "401 - bad API key"
    if r.status_code == 429:
        return [], "BLOCKED", "429 - quota exhausted"
    if r.status_code != 200:
        return [], "ERROR", f"HTTP {r.status_code}: {r.text[:200]}"

    try:
        payload = r.json()
    except ValueError:
        return [], "ERROR", "response was not JSON"

    if payload.get("error"):
        return [], "ERROR", str(payload["error"])[:300]

    groups = (payload.get("best_flights") or []) + (payload.get("other_flights") or [])
    if not groups:
        return [], "NO_DATA", None

    now = datetime.datetime.now()
    quotes = []
    for g in groups:
        price = g.get("price")
        legs = g.get("flights") or []
        if price is None or not legs:
            continue
        # Non-stop only: one leg. Keeps the product definition constant over
        # time, which is what makes day-to-day comparison meaningful.
        if len(legs) != 1:
            continue
        leg = legs[0]
        num = leg.get("flight_number")
        quotes.append({
            "origin": origin, "destination": destination,
            "departure_date": departure_date,
            "lead_time_days": lead_time_days,
            "carrier": _carrier_of(leg),
            "flight_number": num,          # real, or None. Never invented.
            "fare_class": "Economy",
            "total_fare": float(price),
            "currency": "INR",
            # Not observed -> stays NULL. We do not subtract guessed constants.
            "base_fare": None, "taxes": None, "udf": None,
            "convenience_fee": None,
            "availability": "AVAILABLE",
            "seats_left": None,
            "source": NAME,
            "source_url": None,
            "collected_at": now,
            "is_observed": 1,
            "notes": f"nonstop; dep {leg.get('departure_airport',{}).get('time')}"
                     + (f"; key={key_label}" if key_label else ""),
        })
    return quotes, ("OK" if quotes else "NO_DATA"), None

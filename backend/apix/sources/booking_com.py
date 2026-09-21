"""Booking.com flights adapter -- the base-fare / tax split.

Why this source exists at all
-----------------------------
The problem statement names four money fields: base fare, taxes, UDF and
convenience fee. Our primary source (Google Flights, via SerpApi) publishes
one all-in number and nothing else, so those four columns have been NULL on
every one of the 8,000-odd rows collected so far. Booking.com's flight search
returns a real breakdown, and that is the only reason we call it.

What the numbers mean, verified 14 Sep 2026 on DEL-BOM and BLR-DEL
------------------------------------------------------------------
`priceBreakdown` carries several totals and they are NOT interchangeable:

    baseFare              5,094.59      the airline's fare
    tax                   1,466.65      taxes and airline fees
    totalWithoutDiscount  6,561.25   =  baseFare + tax, to the paisa
    total                 6,385.44      what Booking charges after its own
                                        marketing discount ("Booking.com pays")

Reconciled on 30/30 offers across the two routes: **base + tax is
totalWithoutDiscount, never total.**

So `total_fare` here is `totalWithoutDiscount`, and the discount is recorded
in `notes` rather than in the price. Two reasons:

  1. A CPI measures the price of air transport. "Booking.com pays" is an OTA
     marketing subsidy, specific to one platform and to whatever campaign is
     running that week. Index it and the series tracks Booking's promo
     calendar, not airfares.
  2. It is the only choice under which our own three money columns add up. A
     row whose base + taxes does not equal its total is a row we would have to
     explain away, and the first person with a calculator will find it.

This is a judgement, not a reading of a MoSPI rule -- MoSPI publishes no
airfare-specific treatment of OTA discounts. It is recorded here so it can be
argued with.

Quota -- read before adding a call
-----------------------------------
The RapidAPI free tier is **50 requests a month**, shared across every
endpoint. That is the binding constraint on this source, not rate limits.
A full daily sweep (12 routes x 5 windows = 60) is impossible; this adapter
therefore backs a periodic split *study*, not a daily feed. See
`apix/split_study.py`.

To stay inside the budget we skip `/searchDestination` entirely and build the
id as `{CODE}.AIRPORT`. Verified on 14 Sep: resolving "DEL" returns exactly
`DEL.AIRPORT`. Skipping it takes a route from 3 calls to 1.

Key: RapidAPI -> subscribe to booking-com15 -> APIX_RAPIDAPI_KEY.
"""
import os, datetime, requests

NAME = "booking_com"
HOST = "booking-com15.p.rapidapi.com"
ENDPOINT = f"https://{HOST}/api/v1/flights/searchFlights"


def available():
    return bool(os.getenv("APIX_RAPIDAPI_KEY"))


def _money(m):
    """Booking returns money as {currencyCode, units, nanos}."""
    if not isinstance(m, dict):
        return None
    return round(m.get("units", 0) + m.get("nanos", 0) / 1e9, 2)


def fetch(origin, destination, departure_date, lead_time_days, timeout=60,
          key=None, key_label=None):
    """Return (quotes, status, error). Never fabricates on failure.

    Same product definition as the primary source: one adult, economy,
    non-stop only. A cell has to mean the same thing whichever source filled
    it, or the cross-source check compares two different products.
    """
    key = key or os.getenv("APIX_RAPIDAPI_KEY")
    if not key:
        return [], "BLOCKED", "no RapidAPI key supplied"

    params = {
        "fromId": f"{origin}.AIRPORT",
        "toId": f"{destination}.AIRPORT",
        "departDate": departure_date.isoformat(),
        "adults": "1",
        "cabinClass": "ECONOMY",
        "currency_code": "INR",
        "pageNo": "1",
        "sort": "CHEAPEST",
    }
    headers = {"x-rapidapi-key": key, "x-rapidapi-host": HOST}
    try:
        r = requests.get(ENDPOINT, headers=headers, params=params, timeout=timeout)
    except requests.RequestException as e:
        return [], "ERROR", str(e)[:300]

    # 429 here means the 50/month budget is gone, not that we asked too fast.
    if r.status_code == 429:
        return [], "BLOCKED", "429 - monthly RapidAPI quota exhausted"
    if r.status_code in (401, 403):
        return [], "BLOCKED", f"{r.status_code} - key rejected or not subscribed"
    if r.status_code != 200:
        return [], "ERROR", f"HTTP {r.status_code}: {r.text[:200]}"

    try:
        payload = r.json()
    except ValueError:
        return [], "ERROR", "response was not JSON"

    offers = ((payload.get("data") or {}).get("flightOffers")) or []
    if not offers:
        return [], "NO_DATA", None

    return parse(offers, origin, destination, departure_date, lead_time_days,
                 key_label=key_label), "OK", None


def parse(offers, origin, destination, departure_date, lead_time_days,
          key_label=None, now=None):
    """Offers -> quote dicts. Pure, so it can be tested on a saved payload
    without spending any of the 50 monthly calls."""
    now = now or datetime.datetime.now()
    quotes = []
    seen = set()
    for off in offers:
        segs = off.get("segments") or []
        if len(segs) != 1:
            continue                      # a connection, not our product
        legs = segs[0].get("legs") or []
        if len(legs) != 1:
            continue                      # non-stop only
        leg = legs[0]

        pb = off.get("priceBreakdown") or {}
        base = _money(pb.get("baseFare"))
        tax = _money(pb.get("tax"))
        total = _money(pb.get("totalWithoutDiscount"))
        charged = _money(pb.get("total"))
        if base is None or tax is None or total is None:
            continue                      # no split -> no reason to store it

        # The invariant this whole adapter rests on. If Booking ever changes
        # its schema we drop the row rather than store three numbers that do
        # not add up.
        if abs((base + tax) - total) > 1.0:
            continue

        info = leg.get("flightInfo") or {}
        num = info.get("flightNumber")
        cinfo = info.get("carrierInfo") or {}
        code = cinfo.get("marketingCarrier") or cinfo.get("operatingCarrier")
        cdata = (leg.get("carriersData") or [{}])[0]
        carrier = cdata.get("name")       # "IndiGo" -- matches the other source
        # "6E 6406", the same shape SerpApi gives us, so a flight is one key
        # across sources and the agreement check is a real comparison.
        flight_number = f"{code} {num}" if code and num else None

        dep = leg.get("departureTime")    # "2026-09-21T22:00:00"
        dep_time = dep.split("T")[1][:5] if dep and "T" in dep else None

        # Booking returns the same flight at several fare brands; they share a
        # flight number and price, so keep one.
        dedupe = (flight_number, total, dep_time)
        if dedupe in seen:
            continue
        seen.add(dedupe)

        note = "nonstop"
        if dep_time:
            note += f"; dep {dep_time}"
        if charged is not None and abs(charged - total) > 1.0:
            # Recorded, deliberately not priced. See the module docstring.
            note += f"; ota_discounted_total={charged:.2f}"
        if key_label:
            note += f"; key={key_label}"

        quotes.append({
            "origin": origin, "destination": destination,
            "departure_date": departure_date,
            "lead_time_days": lead_time_days,
            "carrier": carrier,
            "flight_number": flight_number,
            "fare_class": (leg.get("cabinClass") or "ECONOMY").title(),
            "total_fare": total,
            "currency": "INR",
            "base_fare": base,
            "taxes": tax,
            # Still NULL, and still honestly so. The tax figure is a single
            # lump: Booking never itemises UDF, and no OTA discloses its own
            # convenience fee before the payment step.
            "udf": None,
            "convenience_fee": None,
            "availability": "AVAILABLE",
            "seats_left": None,
            "source": NAME,
            "source_url": None,
            "collected_at": now,
            "is_observed": 1,
            "notes": note,
            "departure_time": dep_time,
            "is_nonstop": 1,
            "stops": 0,
            # Unlike the primary source, cabin class here is what Booking
            # returned on the leg, not a constant we assert.
            "is_observed_fare_class": 1,
            "is_observed_availability": 0,
        })
    return quotes

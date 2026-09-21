"""The Booking.com adapter -- the one source that gives us a base/tax split.

These tests are pure: they run on hand-built payloads and never spend any of
the 50 requests a month the free tier allows.
"""
import datetime

import pytest

from apix.sources import booking_com

DEP = datetime.date(2026, 9, 21)


def money(units, nanos=0):
    return {"currencyCode": "INR", "units": units, "nanos": nanos}


def offer(base=(5094, 590000000), tax=(1466, 650000000),
          without_discount=(6561, 250000000), total=(6385, 440000000),
          flight_number=6406, carrier_code="6E", carrier_name="IndiGo",
          dep="2026-09-21T22:00:00", n_legs=1, n_segments=1):
    leg = {
        "departureTime": dep,
        "cabinClass": "ECONOMY",
        "flightInfo": {"flightNumber": flight_number,
                       "carrierInfo": {"marketingCarrier": carrier_code,
                                       "operatingCarrier": carrier_code}},
        "carriersData": [{"name": carrier_name, "code": carrier_code}],
    }
    seg = {"legs": [leg] * n_legs}
    return {
        "segments": [seg] * n_segments,
        "priceBreakdown": {
            "baseFare": money(*base),
            "tax": money(*tax),
            "totalWithoutDiscount": money(*without_discount),
            "total": money(*total),
        },
    }


def parse(offers):
    return booking_com.parse(offers, "DEL", "BOM", DEP, 7)


def test_the_split_is_stored_and_adds_up():
    """The whole reason this adapter exists: three money columns that
    reconcile. base + taxes == total_fare, to the rupee."""
    (q,) = parse([offer()])
    assert q["base_fare"] == 5094.59
    assert q["taxes"] == 1466.65
    assert q["total_fare"] == 6561.25
    # Each component is rounded to paisa independently, so the sum can sit one
    # paisa off the reported total. That is the rounding, not a disagreement --
    # the adapter's own guard rejects anything more than a rupee out.
    assert q["base_fare"] + q["taxes"] == pytest.approx(q["total_fare"], abs=0.02)


def test_price_is_the_airline_total_not_the_ota_discounted_one():
    """Booking's `total` is net of its own marketing subsidy. Index that and
    the series tracks Booking's promo calendar instead of airfares. The
    discounted figure is recorded in notes, never in the price."""
    (q,) = parse([offer()])
    assert q["total_fare"] == 6561.25          # totalWithoutDiscount
    assert q["total_fare"] != 6385.44          # NOT Booking's charged total
    assert "ota_discounted_total=6385.44" in q["notes"]


def test_a_row_whose_parts_do_not_add_up_is_dropped_not_stored():
    """If Booking ever changes its schema we lose a row. We do not store three
    numbers that contradict each other and explain it later."""
    bad = offer(without_discount=(9999, 0))
    assert parse([bad]) == []


def test_missing_split_is_dropped():
    """No breakdown means no reason to call this source at all."""
    bad = offer()
    del bad["priceBreakdown"]["baseFare"]
    assert parse([bad]) == []


def test_connections_are_excluded():
    """Same product definition as the daily source: one adult, economy,
    non-stop. A cell must mean the same thing whichever source filled it."""
    assert parse([offer(n_legs=2)]) == []
    assert parse([offer(n_segments=2)]) == []


def test_flight_key_matches_the_other_source_so_rows_can_be_compared():
    """SerpApi stores 'AI 1117' and 'IndiGo'. If this adapter spelled them
    differently the cross-source agreement check would silently compare
    nothing."""
    (q,) = parse([offer()])
    assert q["flight_number"] == "6E 6406"
    assert q["carrier"] == "IndiGo"
    assert q["departure_time"] == "22:00"


def test_same_flight_at_several_fare_brands_is_counted_once():
    """Booking returns one flight repeatedly under different branded fares."""
    assert len(parse([offer(), offer(), offer()])) == 1


def test_carriers_bundle_fees_differently_and_we_do_not_normalise_it():
    """Akasa reports ~4% tax where IndiGo reports ~24% on the same route. That
    spread is the carriers' own accounting, and smoothing it would invent a
    statutory rate that does not exist."""
    akasa = offer(base=(8086, 180000000), tax=(365, 950000000),
                  without_discount=(8452, 130000000), total=(8372, 830000000),
                  flight_number=1811, carrier_code="QP", carrier_name="Akasa Air")
    (indigo_q,) = parse([offer()])
    (akasa_q,) = parse([akasa])
    indigo_share = indigo_q["taxes"] / indigo_q["total_fare"]
    akasa_share = akasa_q["taxes"] / akasa_q["total_fare"]
    assert indigo_share == pytest.approx(0.2235, abs=0.005)
    assert akasa_share == pytest.approx(0.0433, abs=0.005)


def test_udf_and_convenience_fee_stay_null():
    """Booking gives one lump 'taxes and airline fees'. It never itemises UDF,
    and no OTA discloses its convenience fee before the payment step. NULL is
    the honest value."""
    (q,) = parse([offer()])
    assert q["udf"] is None
    assert q["convenience_fee"] is None


def test_provenance_is_recorded():
    (q,) = parse([offer()])
    assert q["source"] == "booking_com"
    assert q["is_observed"] == 1
    assert q["is_observed_fare_class"] == 1      # cabinClass came off the leg
    assert q["is_observed_availability"] == 0    # still asserted, not observed

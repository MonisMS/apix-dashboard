"""One-call test: does Booking.com (via RapidAPI) return a REAL base-fare /
tax split on an INDIAN DOMESTIC route? Nothing else in the pipeline changes
until this prints a split. Uses 2 calls of the free tier's 50/month."""
import sys, json, datetime, os
sys.path.insert(0, ".")
import env; env.load()
import requests

KEY = os.getenv("APIX_RAPIDAPI_KEY")
HOST = "booking-com15.p.rapidapi.com"
H = {"x-rapidapi-key": KEY or "", "x-rapidapi-host": HOST}

if not KEY:
    print("APIX_RAPIDAPI_KEY not set.\n")
    print("  echo 'APIX_RAPIDAPI_KEY=your-key' >> apix/.env")
    sys.exit(1)

o, d = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("DEL", "BOM")
dep = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()


def get(path, **params):
    r = requests.get(f"https://{HOST}{path}", headers=H, params=params, timeout=60)
    print(f"  GET {path} -> HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  body: {r.text[:300]}")
        sys.exit(1)
    return r.json()


def resolve(code):
    """Airport code -> Booking's own id (e.g. DEL.AIRPORT)."""
    j = get("/api/v1/flights/searchDestination", query=code)
    for item in j.get("data") or []:
        if item.get("type") == "AIRPORT" and item.get("code") == code:
            return item.get("id")
    return f"{code}.AIRPORT"      # documented shape; fall back to it


print(f"Testing {o}->{d}, departing {dep} (T+7)\n")
from_id, to_id = resolve(o), resolve(d)
print(f"  ids: {from_id} -> {to_id}\n")

j = get("/api/v1/flights/searchFlights", fromId=from_id, toId=to_id,
        departDate=dep, adults="1", cabinClass="ECONOMY",
        currency_code="INR", pageNo="1", sort="CHEAPEST")

offers = (j.get("data") or {}).get("flightOffers") or []
print(f"\n  offers returned: {len(offers)}")
if not offers:
    print("  -> NO_DATA. India may not be covered. Full payload keys:",
          list((j.get('data') or {}).keys()))
    sys.exit(0)

def money(m):
    """Booking returns {currencyCode, units, nanos}."""
    if not isinstance(m, dict):
        return None
    return round(m.get("units", 0) + m.get("nanos", 0) / 1e9, 2)

print(f"\n  {'airline':<22}{'base':>10}{'tax':>10}{'fee':>9}{'total':>10}")
split_seen = 0
for off in offers[:8]:
    pb = off.get("priceBreakdown") or {}
    seg = (off.get("segments") or [{}])[0]
    legs = seg.get("legs") or []
    carrier = "-"
    if legs:
        cd = (legs[0].get("carriersData") or [{}])[0]
        carrier = cd.get("name") or "-"
    base, tax = money(pb.get("baseFare")), money(pb.get("tax"))
    fee, tot = money(pb.get("fee")), money(pb.get("total"))
    if base is not None:
        split_seen += 1
    fmt = lambda v: f"{v:,.0f}" if v is not None else "--"
    print(f"  {carrier[:21]:<22}{fmt(base):>10}{fmt(tax):>10}"
          f"{fmt(fee):>9}{fmt(tot):>10}")

print(f"\n  base fare present on {split_seen}/{min(len(offers),8)} shown")
if split_seen:
    pb = (offers[0].get("priceBreakdown") or {})
    b, t, f, tt = (money(pb.get(k)) for k in ("baseFare","tax","fee","total"))
    print(f"  sanity: {b or 0:,.0f} + {t or 0:,.0f} + {f or 0:,.0f} "
          f"= {(b or 0)+(t or 0)+(f or 0):,.0f}  vs total {tt or 0:,.0f}")
    print("\n  -> PS requirement 'separate base fare from taxes' IS SATISFIABLE.")
else:
    print("\n  -> no split returned on this route. Requirement stays open.")

out = "/tmp/claude-1000/-home-monis-sih2026/0f791ee2-6250-4423-882f-4b62d12db2cf/scratchpad/booking_raw.json"
open(out, "w").write(json.dumps(j, indent=2)[:2_000_000])
print(f"  raw payload -> {out}")

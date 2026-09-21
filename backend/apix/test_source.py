"""One-route smoke test. Uses 1 search credit. Proves the source works
before we spend 60/day on it."""
import datetime, os, sys
sys.path.insert(0, ".")
import env; env.load()
from sources import serpapi_flights as src

if not src.available():
    print("APIX_SERPAPI_KEY is not set.\n")
    print("Run:  export APIX_SERPAPI_KEY='your-key-here'")
    print("then: python3 test_source.py")
    sys.exit(1)

dep = datetime.date.today() + datetime.timedelta(days=7)
print(f"Testing DEL->BOM, departing {dep} (T+7)...\n")
quotes, status, err = src.fetch("DEL", "BOM", dep, 7)
print(f"  status : {status}")
print(f"  error  : {err}")
print(f"  quotes : {len(quotes)}\n")
if quotes:
    carriers = sorted({q["carrier"] for q in quotes if q["carrier"]})
    fares = sorted(q["total_fare"] for q in quotes)
    print(f"  carriers seen : {carriers}")
    print(f"  fare range    : Rs {fares[0]:,.0f} - Rs {fares[-1]:,.0f}")
    print(f"  median        : Rs {fares[len(fares)//2]:,.0f}\n")
    print("  sample rows:")
    for q in quotes[:6]:
        print(f"    {q['carrier']:<22} {q['flight_number'] or '-':<10} Rs {q['total_fare']:>8,.0f}")
    print("\n  -> source works. Multi-carrier data confirmed.")
else:
    print("  -> no quotes returned. Check the key and the error above.")

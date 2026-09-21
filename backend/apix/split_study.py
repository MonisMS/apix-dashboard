"""The base-fare / tax split study.

Problem statement deliverable (b) asks the database to separate base fare from
taxes, UDF and convenience fee. Our daily source gives one all-in number, so
those columns are NULL on every row it collects. This script fills them from
Booking.com, which publishes a real breakdown.

Why a study and not a daily feed
--------------------------------
The RapidAPI free tier is **50 requests a month, in total**. A daily sweep of
the basket needs 12 routes x 5 windows = 60 requests *a day*. It is arithmetic,
not an engineering problem: this source cannot run daily, and pretending
otherwise would mean either a tiny unrepresentative basket every day or a
series that dies mid-month.

So the split is measured as a periodic panel: every basket route, one booking
window, one sweep. Twelve requests. What it produces is a *tax-share statistic*
per route and carrier -- defensible, cheap, and honest about its frequency.

What this deliberately does NOT do
----------------------------------
It does not push a modelled tax share back onto the 8,000 daily rows. A tax
share observed on one day, on one platform, applied to a different source's
fares would be a modelled number wearing an observed number's clothes. The
daily rows keep NULL in those columns, and the study stands beside them.

    python3 split_study.py --dry-run     # plan and cost, no network
    python3 split_study.py               # the real sweep, 12 requests
"""
import argparse, datetime, json, pathlib, time, uuid
import env; env.load()
import db
from sources import booking_com

BASKET = pathlib.Path(__file__).parent / "data" / "route_basket.json"
LEAD = 7          # one window. T+7 sits inside the PS's five and is the one
                  # where every carrier still has inventory open on every route.


def run(lead=LEAD, limit_routes=None, skip_routes=0, dry_run=False, pause=2.0):
    basket = json.loads(BASKET.read_text())
    # skip_routes lets a part-done study be resumed without re-spending a
    # request on a route already collected -- 50 a month leaves no slack.
    routes = basket["routes"][skip_routes:]
    if limit_routes:
        routes = routes[:limit_routes]

    run_id = uuid.uuid4().hex[:12]
    today = datetime.date.today()
    dep = today + datetime.timedelta(days=lead)
    print(f"APIx split study {run_id}  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"  routes    : {len(routes)}")
    print(f"  window    : T+{lead}  (departing {dep})")
    print(f"  requests  : {len(routes)}  of a 50/month budget")

    if not booking_com.available():
        print("\n  APIX_RAPIDAPI_KEY not set. Nothing collected.")
        return 2
    if dry_run:
        print("\n  [dry run] stopping before any network call.")
        return 0

    con = db.connect()
    tally = {"OK": 0, "NO_DATA": 0, "BLOCKED": 0, "ERROR": 0}
    saved = 0
    rows = []

    for r in routes:
        t0 = time.time()
        quotes, status, err = booking_com.fetch(
            r["origin"], r["destination"], dep, lead)
        ms = int((time.time() - t0) * 1000)
        if quotes:
            saved += db.save_quotes(con, quotes, run_id=run_id)
            rows.extend(quotes)
        db.log_run(con, run_id=run_id, origin=r["origin"],
                   destination=r["destination"], lead_time_days=lead,
                   departure_date=dep, source=booking_com.NAME, status=status,
                   n_quotes=len(quotes), elapsed_ms=ms, error=err,
                   started_at=datetime.datetime.now())
        tally[status] = tally.get(status, 0) + 1
        flag = {"OK": "ok", "NO_DATA": "--", "BLOCKED": "!!", "ERROR": "!!"}[status]
        print(f"  {flag} {r['origin']}-{r['destination']} T+{lead:<2} "
              f"{len(quotes):>3} quotes  {ms:>5}ms" + (f"  {err}" if err else ""))
        # A BLOCKED here is the monthly budget, and every later route would
        # spend a request to be told the same thing. Stop.
        if status == "BLOCKED":
            print("\n  ! quota exhausted - stopping rather than burning the rest")
            break
        time.sleep(pause)

    attempted = sum(tally.values())
    print(f"\n  attempted {attempted} | ok {tally['OK']} | no data {tally['NO_DATA']}"
          f" | blocked {tally['BLOCKED']} | error {tally['ERROR']}")
    print(f"  new observations stored: {saved}")

    if rows:
        print(f"\n  tax share by carrier (tax / (base+tax)):")
        by = {}
        for q in rows:
            by.setdefault(q["carrier"], []).append(
                q["taxes"] / q["total_fare"] * 100)
        for carrier, shares in sorted(by.items(), key=lambda kv: -len(kv[1])):
            lo, hi = min(shares), max(shares)
            mean = sum(shares) / len(shares)
            print(f"    {carrier:<20}{mean:>6.1f}%   ({lo:.1f}-{hi:.1f}%, "
                  f"n={len(shares)})")
        print("\n  Note: 'tax' is the carrier's own taxes-and-fees line, not a")
        print("  statutory rate. The spread between carriers is a finding, not")
        print("  an error -- they bundle fees into it differently.")

    print(f"\n  database now: {db.summary(con)}")
    return 0 if tally["OK"] else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--lead", type=int, default=LEAD)
    ap.add_argument("--routes", type=int, default=None,
                    help="limit number of routes (for testing)")
    ap.add_argument("--skip", type=int, default=0,
                    help="skip the first N routes (resume a part-done study)")
    a = ap.parse_args()
    raise SystemExit(run(lead=a.lead, limit_routes=a.routes,
                         skip_routes=a.skip, dry_run=a.dry_run) or 0)

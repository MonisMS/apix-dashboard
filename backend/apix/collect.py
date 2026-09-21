"""APIx daily collection run.

Prices every route in the basket at each of the five advance-purchase
windows the problem statement requires: T+1, T+7, T+15, T+30, T+45.

Every attempt is logged -- success or failure -- so coverage is reported
honestly instead of assumed.
"""
import argparse, datetime, json, pathlib, time, uuid
import env; env.load()
import db, keypool
from sources import serpapi_flights, travelpayouts

LEAD_TIMES = [1, 7, 15, 30, 45]          # fixed by the problem statement
MAX_REQUESTS_PER_RUN = 70                # hard stop: a bug must never drain the quota
                                         # (70 = full 12-route sweep + headroom)
SOURCES = [serpapi_flights, travelpayouts]
BASKET = pathlib.Path(__file__).parent / "data" / "route_basket.json"

def run(limit_routes=None, dry_run=False, pause=1.5):
    basket = json.loads(BASKET.read_text())
    routes = basket["routes"][:limit_routes] if limit_routes else basket["routes"]
    active = [s for s in SOURCES if s.available()]
    pool = keypool.Pool() if any(s.NAME.startswith("serpapi") for s in active) else None

    run_id = uuid.uuid4().hex[:12]
    today = datetime.date.today()
    print(f"APIx collection run {run_id}  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"  routes     : {len(routes)}")
    print(f"  lead times : {LEAD_TIMES}")
    print(f"  planned    : {len(routes)*len(LEAD_TIMES)} fetches")
    print(f"  sources up : {[s.NAME for s in active] or 'NONE'}")
    if pool is not None:
        avail = pool.total_available()
        need = len(routes) * len(LEAD_TIMES)
        print(f"  pool       : {len(pool.keys)} key(s), ~{avail} requests available")
        print(f"  this run   : needs {need}")
        if avail < need:
            print(f"\n  ! pool has {avail} but this run needs {need}.")
            print(f"    Reduce with --routes {max(1, avail//len(LEAD_TIMES))}, or add another key.")
            return 3
    if not active:
        print("\n  No source is configured. Nothing collected.")
        print("  Set APIX_SERPAPI_KEY (free tier at serpapi.com) and re-run.")
        return 2
    if dry_run:
        print("\n  [dry run] stopping before any network call.")
        return 0

    con = db.connect()
    tally = {"OK": 0, "NO_DATA": 0, "BLOCKED": 0, "ERROR": 0}
    saved = 0

    spent = 0
    stop = False
    for r in routes:
        if stop:
            break
        for lead in LEAD_TIMES:
            if spent >= MAX_REQUESTS_PER_RUN:
                print(f"\n  ! hit MAX_REQUESTS_PER_RUN ({MAX_REQUESTS_PER_RUN}) - stopping early")
                stop = True
                break
            dep = today + datetime.timedelta(days=lead)
            for src in active:
                t0 = time.time()
                kw = {}
                if pool is not None and src.NAME.startswith("serpapi"):
                    k, label = pool.take()
                    if k is None:
                        print("\n  ! all keys exhausted - stopping. "
                              "This is a real gap, not a silent skip.")
                        stop = True
                        break
                    kw = {"key": k, "key_label": label}
                quotes, status, err = src.fetch(
                    r["origin"], r["destination"], dep, lead, **kw)
                ms = int((time.time() - t0) * 1000)
                if quotes:
                    saved += db.save_quotes(con, quotes, run_id=run_id)
                db.log_run(con, run_id=run_id, origin=r["origin"],
                           destination=r["destination"], lead_time_days=lead,
                           departure_date=dep, source=src.NAME, status=status,
                           n_quotes=len(quotes), elapsed_ms=ms, error=err,
                           started_at=datetime.datetime.now())
                tally[status] = tally.get(status, 0) + 1
                spent += 1
                flag = {"OK": "ok", "NO_DATA": "--", "BLOCKED": "!!",
                        "ERROR": "!!"}[status]
                print(f"  {flag} {r['origin']}-{r['destination']} T+{lead:<2} "
                      f"{len(quotes):>3} quotes  {ms:>5}ms"
                      + (f"  {err}" if err else ""))
                time.sleep(pause)   # be a polite client

    attempted = sum(tally.values())
    print(f"\n  attempted {attempted} | ok {tally['OK']} | no data "
          f"{tally['NO_DATA']} | blocked {tally['BLOCKED']} | error {tally['ERROR']}")
    print(f"  new observations stored: {saved}")
    got = tally["OK"] / attempted * 100 if attempted else 0
    print(f"  coverage (fetches that returned data): {got:.1f}%")
    if pool is not None:
        lines = pool.report()
        if lines:
            print("\n  key usage this run:")
            for l in lines: print(l)
    print(f"\n  database now: {db.summary(con)}")

    # A partial sweep must fail the job. A gap has to look like a gap --
    # a green tick over 40 of 60 cells is how a series quietly rots.
    expected = len(routes) * len(LEAD_TIMES)
    if attempted < expected or tally["OK"] < expected:
        print(f"\n  INCOMPLETE: {tally['OK']} of {expected} cells collected.")
        return 1
    return 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--routes", type=int, default=None,
                    help="limit number of routes (for testing)")
    a = ap.parse_args()
    raise SystemExit(run(limit_routes=a.routes, dry_run=a.dry_run) or 0)

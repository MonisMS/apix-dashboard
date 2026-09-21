"""Freeze every API response to static JSON for the deployed dashboard.

    python3 -m api.dump_static          # writes into dashboard/public/data/v1

Why this exists: the index engine is Python, so a live dashboard would need a
Python service hosted somewhere. On a free tier that service sleeps, and a
thirty-second cold start in front of judges is a bad trade for a series that
only changes once a day anyway.

So the deployed dashboard reads files. No backend host, no cold start, no CORS,
nothing to be asleep. The FastAPI service is unchanged and still runs locally --
it is the real API, it satisfies the problem statement's API deliverable, and it
is what generates these files.

Re-run this after every collection, or the deployed dashboard will keep showing
the day you last ran it. `--check` reports how stale the dump is.

Files live under /data/v1, deliberately NOT /api/v1: the dev server proxies
/api/v1 to uvicorn, and a static file at that path would be swallowed by the
proxy and served as a 500 whenever the backend was down -- which is precisely
the case this exists to survive.

The naming scheme mirrors the request the dashboard makes, so the front end
needs no route table:

    /index                        -> index.json
    /routes/DEL-BOM               -> routes/DEL-BOM.json
    /heatmap?metric=pct_change    -> heatmap__metric=pct_change.json
"""
import argparse
import datetime
import json
import pathlib
import shutil
import sys

# ROOT is the backend/ package root (holds api/, apix/, data/). The dashboard
# now lives one level above it -- this repo IS the dashboard -- so the snapshot
# goes to the Next.js public/ directory at the repo root.
ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
OUT = REPO_ROOT / "public" / "data" / "v1"

# Parameter-free endpoints are DISCOVERED from the app rather than listed here.
# A hardcoded list silently omits any endpoint added later -- which happened
# once already: /availability was added to the API, the list was not updated,
# and the page shipped with no data behind it.
PARAMETERISED = [
    ("/collection/runs", {"limit": "60"}),
    *[("/heatmap", {"metric": m})
      for m in ("pct_change", "level", "mean_fare", "n_offers")],
]


def filename(path: str, params: dict | None) -> str:
    name = path.lstrip("/")
    if params:
        name += "__" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    return name + ".json"


def dump(verbose: bool = True) -> dict:
    from fastapi.testclient import TestClient

    from .main import app

    client = TestClient(app)

    # Every GET route the app exposes that takes no path parameter.
    static_paths = sorted({
        r.path[len("/api/v1"):]
        for r in app.routes
        if getattr(r, "path", "").startswith("/api/v1")
        and "{" not in r.path
        and "GET" in getattr(r, "methods", set())
    })

    # Discover the real route and carrier keys rather than hardcoding them, so a
    # basket change is picked up automatically.
    routes = client.get("/api/v1/routes").json()["routes"]
    carriers = client.get("/api/v1/carriers").json()["carriers"]

    targets = [(p, None) for p in static_paths] + PARAMETERISED
    targets += [(f"/routes/{r['pair']}", None) for r in routes]
    targets += [(f"/carriers/{c['carrier']}", None) for c in carriers]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    written, failed, total_bytes = [], [], 0
    for path, params in targets:
        res = client.get(f"/api/v1{path}", params=params)
        if res.status_code != 200:
            failed.append((path, res.status_code))
            continue
        dest = OUT / filename(path, params)
        dest.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps(res.json(), separators=(",", ":"))
        dest.write_text(body, encoding="utf-8")
        total_bytes += len(body)
        written.append(dest.relative_to(OUT).as_posix())

    manifest = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "n_files": len(written),
        "bytes": total_bytes,
        "files": sorted(written),
        "note": "Static snapshot of the APIx API. Regenerate with "
                "`python3 -m api.dump_static` after every collection.",
    }
    (OUT / "_manifest.json").write_text(json.dumps(manifest, indent=1))

    if verbose:
        print(f"  wrote {len(written)} files, {total_bytes / 1024:.0f} KB -> "
              f"{OUT.relative_to(ROOT)}")
        print(f"  endpoints discovered: {len(static_paths)}")
        for path, code in failed:
            print(f"  ! {path} returned {code}")
    if failed:
        raise SystemExit(f"{len(failed)} endpoint(s) failed; dump is incomplete")
    return manifest


def check() -> int:
    """Report how stale the committed dump is against the live database."""
    man = OUT / "_manifest.json"
    if not man.exists():
        print("  no dump found -- run: python3 -m api.dump_static")
        return 1
    m = json.loads(man.read_text())
    db = ROOT / "apix" / "data" / "apix.db"
    db_time = datetime.datetime.fromtimestamp(db.stat().st_mtime)
    dump_time = datetime.datetime.fromisoformat(m["generated_at"])
    stale = db_time > dump_time
    print(f"  dump generated : {m['generated_at']}  ({m['n_files']} files)")
    print(f"  database       : {db_time.isoformat(timespec='seconds')}")
    print("  STALE -- the database has moved since the dump. Re-run it."
          if stale else "  fresh")
    return 1 if stale else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report staleness instead of writing")
    a = ap.parse_args()
    sys.exit(check() if a.check else (dump() and 0))

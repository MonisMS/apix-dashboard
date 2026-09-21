"""Published airline tariff sheets -- a legally-mandated, public fare source.

Under Rule 135 of the Aircraft Rules, 1937, every Indian carrier must publish its
tariff and keep it available to the public.  In practice the airlines publish an
Excel-derived PDF giving, for each market (city pair), the MINIMUM and MAXIMUM
fare at each fare level (the RBD ladder), plus the fuel charge.  These are the
same minimum/maximum tariffs that DGCA holds to monitor airfares -- the Expert
Group Report notes DGCA "maintain data on the minimum and maximum tariffs for
all routes across all airlines" (EG 4.1.3, p. 177), but does not publish them.
The airlines do.

Why this matters for APIx:
  * It is published FOR the public, so there is no scraping question at all --
    no booking funnel, no bot wall, no robots.txt grey area.
  * It is route-level, which is the granularity the problem statement wants.
  * It is the airline's own declared price structure, updated monthly.
  * Akasa's sheet additionally carries per-airport charges, which is the only
    published source we have found for a UDF-shaped number.

What it is NOT: a transacted or offered fare for a given date.  A tariff sheet
is the band a fare must sit inside, not the price a traveller paid on Tuesday.
It therefore supplements the live collection -- it does not replace it, and it
must never be written into fare_observation as if it were an observed quote.

    python3 apix/sources/tariff_sheets.py --refresh
"""
import argparse, csv, datetime, json, pathlib, re, subprocess, sys, urllib.request

HERE = pathlib.Path(__file__).resolve().parent.parent
REFS = HERE.parent / "refs"
OUT = HERE.parent / "data"

SHEETS = {
    "Akasa Air": {
        "url": "https://a.storyblok.com/f/159922/x/c1ce86c83e/fare-sheet-akasa-air.pdf",
        "pdf": REFS / "tariff_akasa_2026-09-01.pdf",
        "found_via": "linked from akasaair.com/flight-booking (__NEXT_DATA__)",
        "levels": 15,
    },
    "SpiceJet": {
        "url": "https://corporate.spicejet.com/Content/pdf/Tariffs.pdf",
        "pdf": REFS / "tariff_spicejet_2026-09.pdf",
        "found_via": "'Tariffs' link in corporate.spicejet.com footer",
        "levels": 25,
    },
}

# City spellings used in the sheets -> IATA. Both airlines spell some cities
# differently ("New Delhi" vs "Delhi"), so normalise before matching a route.
CITY = {
    "DELHI": "DEL", "NEW DELHI": "DEL",
    "MUMBAI": "BOM", "NAVI MUMBAI": "NMI",
    "BENGALURU": "BLR", "BANGALORE": "BLR",
    "HYDERABAD": "HYD", "CHENNAI": "MAA", "KOLKATA": "CCU",
    "PUNE": "PNQ", "AHMEDABAD": "AMD", "SRINAGAR": "SXR",
    "GUWAHATI": "GAU", "PATNA": "PAT", "KOCHI": "COK",
    "GOA": "GOI", "GOA (MOPA)": "GOX", "GOA (DABOLIM)": "GOI",
    "JAIPUR": "JAI", "LUCKNOW": "LKO", "VARANASI": "VNS",
    "CHANDIGARH": "IXC", "BHUBANESWAR": "BBI", "INDORE": "IDR",
    "NAGPUR": "NAG", "AMRITSAR": "ATQ",
}

NUM = re.compile(r"^[\d,]+$")


def _n(tok):
    """'12,549' -> 12549, and '' / '-' -> None."""
    tok = tok.strip()
    return int(tok.replace(",", "")) if NUM.match(tok) else None


def text_of(pdf: pathlib.Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                          capture_output=True, text=True, check=True).stdout


def parse_akasa(txt: str):
    """'Agartala - Bengaluru  Minimum  1  0  2,596  2,920 ...' (15 levels)."""
    rows = []
    pat = re.compile(r"^\s*(.+?)\s+-\s+(.+?)\s{2,}(Minimum|Maximum)\s+(\d+)\s+(\d+)\s+(.*)$")
    for line in txt.splitlines():
        m = pat.match(line)
        if not m:
            continue
        a, b, kind, stops, yq, rest = m.groups()
        levels = [_n(t) for t in rest.split() if _n(t) is not None]
        if len(levels) < 5:
            continue
        rows.append({
            "airline": "Akasa Air", "city_a": a.strip(), "city_b": b.strip(),
            "bound": kind.lower().replace("imum", ""), "stops": int(stops),
            "fuel_charge_yq": int(yq), "levels": levels,
        })
    return rows


def parse_spicejet(txt: str):
    """'Ahmedabad   Bengaluru   0   Min Fares   2381  3000 ...' (up to 25)."""
    rows = []
    pat = re.compile(r"^\s*([A-Za-z][A-Za-z .()\-]+?)\s{2,}([A-Za-z][A-Za-z .()\-]+?)"
                     r"\s{2,}(\d)\s+(Min|Max) Fares\s+(.*)$")
    for line in txt.splitlines():
        m = pat.match(line)
        if not m:
            continue
        a, b, stops, kind, rest = m.groups()
        levels = [_n(t) for t in rest.split() if _n(t) is not None]
        if len(levels) < 5:
            continue
        rows.append({
            "airline": "SpiceJet", "city_a": a.strip(), "city_b": b.strip(),
            "bound": kind.lower(), "stops": int(stops),
            "fuel_charge_yq": None,   # SpiceJet's sheet does not break out YQ
            "levels": levels,
        })
    return rows


def iata(city: str):
    return CITY.get(city.strip().upper())


def collect():
    out = []
    for airline, cfg in SHEETS.items():
        if not cfg["pdf"].exists():
            print(f"  ! missing {cfg['pdf'].name} -- run with --refresh")
            continue
        txt = text_of(cfg["pdf"])
        rows = parse_akasa(txt) if airline == "Akasa Air" else parse_spicejet(txt)
        for r in rows:
            r["origin"] = iata(r["city_a"])
            r["destination"] = iata(r["city_b"])
            r["source_url"] = cfg["url"]
            r["lowest_level"] = r["levels"][0]
            r["highest_level"] = r["levels"][-1]
            r["n_levels"] = len(r["levels"])
        print(f"  {airline:<12} {len(rows):>4} rows  "
              f"({len({(r['city_a'], r['city_b']) for r in rows})} markets)")
        out += rows
    return out


def refresh():
    for airline, cfg in SHEETS.items():
        req = urllib.request.Request(cfg["url"], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            cfg["pdf"].write_bytes(r.read())
        print(f"  {airline:<12} -> {cfg['pdf'].name} ({cfg['pdf'].stat().st_size:,} B)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download the PDFs")
    a = ap.parse_args()

    if a.refresh:
        print("Downloading published tariff sheets:")
        refresh()

    print("\nParsing:")
    rows = collect()
    if not rows:
        sys.exit("no rows parsed")

    basket = json.loads((HERE / "data" / "route_basket.json").read_text())
    want = {frozenset((r["origin"], r["destination"])) for r in basket["routes"]}

    have = {}
    for r in rows:
        if r["origin"] and r["destination"]:
            have.setdefault(frozenset((r["origin"], r["destination"])), set()).add(r["airline"])

    print(f"\nCoverage of the {len(want)}-route basket:")
    hit = 0
    for br in basket["routes"]:
        k = frozenset((br["origin"], br["destination"]))
        who = sorted(have.get(k, []))
        if who:
            hit += 1
        print(f"  {br['origin']}-{br['destination']:<4} {', '.join(who) if who else '-- neither carrier publishes this market'}")
    print(f"\n  {hit}/{len(want)} basket routes covered by at least one published tariff sheet")

    OUT.mkdir(exist_ok=True)
    js = OUT / "tariff_sheets.json"
    js.write_text(json.dumps({
        "retrieved": datetime.date.today().isoformat(),
        "note": "Published tariff bands (Rule 135). NOT observed transaction fares.",
        "sources": {k: {"url": v["url"], "found_via": v["found_via"]} for k, v in SHEETS.items()},
        "rows": rows,
    }, indent=1))
    with open(OUT / "tariff_sheets.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["airline", "origin", "destination", "city_a", "city_b", "bound",
                    "stops", "fuel_charge_yq", "n_levels", "lowest_level", "highest_level"])
        for r in rows:
            w.writerow([r["airline"], r["origin"], r["destination"], r["city_a"], r["city_b"],
                        r["bound"], r["stops"], r["fuel_charge_yq"], r["n_levels"],
                        r["lowest_level"], r["highest_level"]])
    print(f"  written -> {js.name}, tariff_sheets.csv")


if __name__ == "__main__":
    main()

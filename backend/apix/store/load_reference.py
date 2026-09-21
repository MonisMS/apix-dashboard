"""Load the file-based reference data into Neon.

    APIX_PG_URL=postgresql://... python3 -m apix.store.load_reference

Idempotent (everything upserts), and independent of any index vintage -- this
data changes when a source publishes, not when the collector runs. Re-run it
after updating data/tariff_sheets.json or the MoSPI export.
"""
import csv
import json
import pathlib
import sys

from . import pg

ROOT = pathlib.Path(__file__).resolve().parents[2]      # backend/
MOSPI_CSV = ROOT / "apix" / "exports" / "mospi_airfare_index.csv"
CPI_WEIGHTS = ROOT / "data" / "cpi2024_airfare_weights.csv"
TARIFFS = ROOT / "data" / "tariff_sheets.json"


def load_mospi(con) -> int:
    if not MOSPI_CSV.exists():
        print("    mospi: file missing, skipped")
        return 0
    rows = []
    with open(MOSPI_CSV) as f:
        for r in csv.DictReader(f):
            y, m = int(r["year"]), int(r["month"])
            rows.append((f"{y}-{m:02d}", y, m, float(r["index_2024_base"])))
    con.cursor().executemany(
        "INSERT INTO mospi_point (period, year, month, index_2024_base) "
        "VALUES (%s,%s,%s,%s) ON CONFLICT (period) DO UPDATE SET "
        "index_2024_base = EXCLUDED.index_2024_base", rows)
    return len(rows)


def load_cpi(con) -> int:
    if not CPI_WEIGHTS.exists():
        print("    cpi weights: file missing, skipped")
        return 0
    with open(CPI_WEIGHTS) as f:
        rows = [(r["state_name"], r["sector"], float(r["share_in_all_india_pct"]))
                for r in csv.DictReader(f)]
    con.cursor().executemany(
        "INSERT INTO cpi_weight_row (state_name, sector, share_in_all_india_pct) "
        "VALUES (%s,%s,%s) ON CONFLICT (state_name, sector) DO UPDATE SET "
        "share_in_all_india_pct = EXCLUDED.share_in_all_india_pct", rows)
    return len(rows)


def load_tariffs(con) -> int:
    if not TARIFFS.exists():
        print("    tariffs: file missing, skipped")
        return 0
    data = json.loads(TARIFFS.read_text())
    rows = data.get("rows", [])
    # Full reload rather than upsert: duplicate markets are legitimate here
    # (see migration 006), so there is no key to upsert on.
    con.execute("DELETE FROM tariff_row")
    con.cursor().executemany(
        """INSERT INTO tariff_row (airline, city_a, city_b, bound, origin,
               destination, stops, fuel_charge_yq, n_levels, lowest_level,
               highest_level, levels, source_url)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        [(r["airline"], r["city_a"], r["city_b"], r["bound"], r.get("origin"),
          r.get("destination"), r.get("stops"), r.get("fuel_charge_yq"),
          r.get("n_levels") if r.get("n_levels") is not None else
          (len(r["levels"]) if r.get("levels") else None),
          r.get("lowest_level"), r.get("highest_level"),
          [float(x) for x in r["levels"]] if r.get("levels") else None,
          r.get("source_url")) for r in rows],
    )
    src = data.get("sources", {}) or {}
    if src:
        con.cursor().executemany(
            "INSERT INTO tariff_source (airline, url, found_via) VALUES (%s,%s,%s) "
            "ON CONFLICT (airline) DO UPDATE SET url=EXCLUDED.url, "
            "found_via=EXCLUDED.found_via",
            [(k, v.get("url"), v.get("found_via")) for k, v in src.items()])
    con.cursor().executemany(
        "INSERT INTO tariff_meta (k, v) VALUES (%s,%s) "
        "ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v",
        [(k, str(data[k])) for k in ("retrieved", "note") if k in data])
    return len(rows)


def main() -> int:
    with pg.connect() as con:
        print("  loading reference data ...")
        print(f"    mospi_point     {load_mospi(con)}")
        print(f"    cpi_weight_row  {load_cpi(con)}")
        print(f"    tariff_row      {load_tariffs(con)}")
        con.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())

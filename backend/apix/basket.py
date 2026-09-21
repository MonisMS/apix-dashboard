"""Build the route basket + weights from DGCA city-pair passenger data.

Source: DGCA monthly city-pair domestic passenger statistics,
mirrored at github.com/Vonter/india-aviation-traffic (ODbL 1.0).
Weights are passenger shares -- real, sourced, reproducible.
"""
import csv, collections, json, pathlib

DATA = pathlib.Path(__file__).resolve().parent.parent / "data" / "dgca_city_pair.csv"

# City name -> IATA code. Only what we need for the basket.
CODES = {
    "DELHI": "DEL", "MUMBAI": "BOM", "BENGALURU": "BLR", "HYDERABAD": "HYD",
    "CHENNAI": "MAA", "KOLKATA": "CCU", "PUNE": "PNQ", "AHMEDABAD": "AMD",
    "GOA": "GOI", "KOCHI": "COK", "JAIPUR": "JAI", "LUCKNOW": "LKO",
    "GUWAHATI": "GAU", "PATNA": "PAT", "SRINAGAR": "SXR", "VARANASI": "VNS",
    "CHANDIGARH": "IXC", "BHUBANESWAR": "BBI", "INDORE": "IDR", "NAGPUR": "NAG",
    "AMRITSAR": "ATQ",
}

def load(year="2025"):
    """Total passengers per city pair for a calendar year."""
    pairs = collections.Counter()
    with open(DATA) as f:
        for r in csv.DictReader(f):
            if r["Year"] != year:
                continue
            try:
                pax = float(r["PaxToCity2"] or 0) + float(r["PaxFromCity2"] or 0)
            except ValueError:
                continue
            c1, c2 = r["City1"].strip().upper(), r["City2"].strip().upper()
            # 2026 rows suffix the airport, e.g. "MUMBAI (NAVI MUMBAI)"
            c1, c2 = c1.split(" (")[0], c2.split(" (")[0]
            pairs["|".join(sorted([c1, c2]))] += pax
    return pairs

def build(top_n=12, year="2025"):
    pairs = load(year)
    national_total = sum(pairs.values())
    basket, skipped = [], []
    for name, pax in pairs.most_common():
        a, b = name.split("|")
        if a not in CODES or b not in CODES:
            skipped.append((name, pax))
            continue
        basket.append({
            "pair": name,
            "origin": CODES[a], "destination": CODES[b],
            "city_a": a, "city_b": b,
            "pax_cy": int(pax),
            "national_share_pct": round(pax / national_total * 100, 4),
        })
        if len(basket) >= top_n:
            break
    covered = sum(r["pax_cy"] for r in basket)
    # Weight WITHIN the basket -- but we always report true national coverage too.
    for r in basket:
        r["weight"] = round(r["pax_cy"] / covered, 6)
    return {
        "source": "DGCA monthly city-pair domestic passenger statistics",
        "mirror": "github.com/Vonter/india-aviation-traffic (ODbL 1.0)",
        "reference_year": year,
        "national_total_pax": int(national_total),
        "basket_total_pax": int(covered),
        "basket_covers_pct_of_national": round(covered / national_total * 100, 2),
        "n_routes": len(basket),
        "routes": basket,
        "skipped": [(n, int(p)) for n, p in skipped[:6]],
    }

if __name__ == "__main__":
    b = build()
    out = pathlib.Path(__file__).parent / "data" / "route_basket.json"
    out.write_text(json.dumps(b, indent=2))
    print(f"Basket: {b['n_routes']} routes, CY{b['reference_year']}")
    print(f"Covers {b['basket_covers_pct_of_national']}% of national domestic traffic")
    print(f"(national total {b['national_total_pax']:,} pax)\n")
    print(f"{'#':>2} {'route':<9} {'pax':>11}  {'natl%':>6}  {'weight':>7}")
    for i, r in enumerate(b["routes"], 1):
        print(f"{i:2} {r['origin']}-{r['destination']:<5} {r['pax_cy']:>11,}  "
              f"{r['national_share_pct']:>5.2f}%  {r['weight']:>7.4f}")
    if b["skipped"]:
        print("\nSkipped city pairs above the cut (no IATA mapping) -- these are NOT in the basket:")
        for name, pax in b["skipped"]:
            print(f"   {name:<32} {int(pax):>10,}")
    print(f"\nwritten -> {out}")

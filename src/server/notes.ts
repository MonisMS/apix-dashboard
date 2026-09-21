// Generated from the Python reference implementation (apix/index/config.py,
// api/services/index.py, api/services/reference.py) by a one-off script --
// transcribed mechanically rather than by hand so the wording cannot drift.
// Per-vintage values (weight provenance, computed numbers) are NOT here; they
// come from the database.

export const METHODOLOGY = {
  "elementary": "Jevons -- unweighted geometric mean of matched price relatives (CPI Manual eq. 9.1; MoSPI EG 4.6.1.1 short index)",
  "aggregation": "Young -- weighted arithmetic mean of elementary index levels (CPI Manual eq. 9.11; MoSPI EG 4.6.2.4)",
  "cell": "origin x destination x carrier x departure band x advance-purchase lag; economy, non-stop, INR (MoSPI EG Recommendation 11)",
  "item": "an individual flight (carrier + flight number) matched between consecutive collection days",
  "imputation": "explicit, from the parent aggregate's short-term movement; carry-forward is prohibited (CPI Manual 8.54)",
  "caveat": "MoSPI publishes no airfare-specific compilation rule. Airfare is one priced item, so the generic Jevons-short + Young machinery applies. That is our inference, not a published MoSPI method."
} as const;

export const PRODUCT_SPEC = {
  "passengers": "1 adult",
  "trip": "one-way",
  "cabin": "Economy",
  "stops": "non-stop only",
  "currency": "INR",
  "price_concept": "all-in total payable (CPI Manual 2.112: taxes are part of purchasers' prices)",
  "baggage": "not specified by source; not controlled for"
} as const;

export const FORMULAS = {
  "elementary": "I_t = GM_i( p_t^i / p_{t-1}^i ) * I_{t-1}",
  "elementary_source": "MoSPI EG 4.6.1.1 p.50; CPI Manual eq. 9.1",
  "higher_level": "I = sum_j ( w_j * I_j ),  sum w = 1",
  "higher_level_source": "MoSPI EG 4.6.2.4 p.53; CPI Manual eq. 9.11",
  "imputation": "Imputed Price_t = Price_{t-1} * GM(available price relatives)",
  "imputation_source": "MoSPI EG 4.6.4.3 p.56, worked Example 2 p.58"
} as const;

export const WORKED_EXAMPLES = [
  {
    "name": "EG Example 1 -- all prices available",
    "mospi_value": 100.8198,
    "apix_value": 100.8198,
    "matches": true
  },
  {
    "name": "EG Example 2 -- one price missing, imputed 83.8514",
    "mospi_value": 101.0258,
    "apix_value": 101.0258,
    "matches": true
  },
  {
    "name": "EG Example 3 -- specification change with overlap",
    "mospi_value": 101.8084,
    "apix_value": 101.8084,
    "matches": true
  },
  {
    "name": "EG Example 4 -- specification change without overlap",
    "mospi_value": 101.0258,
    "apix_value": 101.0258,
    "matches": true
  }
] as const;

export const CAVEATS = [
  "MoSPI publishes no airfare-specific compilation rule. Airfare is one priced item, so the generic Jevons-short + Young machinery applies. That is our inference, not a published MoSPI method.",
  "Observed fares are offers, not transactions.",
  "Uniform lead-time weights are a declared assumption.",
  "The reference window is three days and provisional."
] as const;

export const WEIGHTS_EXPLANATION = {
  "what_changed": "Weights are expenditure shares (passengers x mean fare), not passenger counts. CPI Manual eq. 9.11 and MoSPI EG 4.6.2.2 both require p*q; DGCA passengers are q alone.",
  "example": "BLR-DEL is 9.04% of basket passengers but 14.50% of basket expenditure.",
  "caveat": "Our observations are offers, not transactions, so this is an offer-mix mean rather than a passenger yield."
} as const;

export const TARIFF_NOTES = {
  "legal_basis": "Rule 135 of the Aircraft Rules, 1937 requires every Indian carrier to publish its tariff. These are published for the public, so no scraping question arises.",
  "caveat": "A tariff sheet is the band a fare must sit inside, not a transacted price. These supplement the index and never enter it as observed quotes."
} as const;

export const CPI_CONSTANTS = {
  "group_07_3_passenger_transport_services_pct": 2.567016,
  "division_07_transport_pct": 8.796113,
  "division_08_information_and_communication_pct": 3.609438,
  "note": "8.796113% is Division 07 Transport ALONE. 'Transport and Communication' is the CPI 2012 name; its CPI 2024 equivalent is Transport plus Information and communication = 12.405552%.",
  "source": "MoSPI Annexure 5.3d (all-India and State-wise item level weights); summed over 58 state x sector rows, as the sheet has no all-India row for airfare. The same column sums to exactly 100.000 over all 23,215 rows and Division 07 to 8.796113, reproducing the published Transport weight to six decimals.",
  "largest_contributor_note": "Kerala rural alone is about 19% of the national airfare weight. CPI weights airfare by household expenditure share by state; our basket weights by DGCA trunk-route passengers. Different concepts."
} as const;

export const SPLIT_NOTES = {
  "fields": {
    "base_fare": {
      "observed": true,
      "note": "As the source reports it. base_fare + taxes reconciles to total_fare on every stored row; a row that fails that check is dropped, not stored."
    },
    "taxes": {
      "observed": true,
      "note": "One lump 'taxes and airline fees'. Carrier accounting, not a statutory rate -- hence the spread between carriers below."
    },
    "udf": {
      "observed": false,
      "note": "Never itemised by any source we have found. Derivable from AERA tariff orders, which would be a derived figure and is not stored as observed."
    },
    "convenience_fee": {
      "observed": false,
      "note": "OTA-specific and never disclosed before the payment step."
    }
  },
  "why_not_daily": "The split source allows 50 requests a month. A daily sweep of 12 routes across 5 booking windows needs 60 a day. The split is therefore a periodic panel, and the daily series is not back-filled from it.",
  "why_not_backfilled": "Applying a tax share measured on one platform, on one day, to another source's fares would be a modelled number presented as an observed one. The daily rows keep NULL."
} as const;

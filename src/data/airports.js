/**
 * Real, publicly published coordinates (ICAO/IATA airport reference points)
 * for the 8 airports spanning the 12-route basket (see apix/index/config.py
 * / public/data/v1/routes.json for the basket itself). Used only to draw the
 * route-network map -- not fare data, so no "real vs synthetic" question
 * applies, but the coordinates themselves are real, not invented.
 */
export const AIRPORTS = {
  DEL: { name: 'Indira Gandhi Intl, Delhi', lat: 28.5562, lon: 77.1000 },
  BOM: { name: 'Chhatrapati Shivaji Maharaj Intl, Mumbai', lat: 19.0896, lon: 72.8656 },
  BLR: { name: 'Kempegowda Intl, Bengaluru', lat: 13.1986, lon: 77.7066 },
  CCU: { name: 'Netaji Subhas Chandra Bose Intl, Kolkata', lat: 22.6547, lon: 88.4467 },
  HYD: { name: 'Rajiv Gandhi Intl, Hyderabad', lat: 17.2403, lon: 78.4294 },
  MAA: { name: 'Chennai Intl', lat: 12.9941, lon: 80.1709 },
  PNQ: { name: 'Pune Airport', lat: 18.5822, lon: 73.9197 },
  AMD: { name: 'Sardar Vallabhbhai Patel Intl, Ahmedabad', lat: 23.0772, lon: 72.6347 },
};

/** The 12-route basket, city codes only -- fare/index data is fetched live via api.js. */
export const BASKET_ROUTES = [
  'BLR-DEL', 'DEL-BOM', 'DEL-CCU', 'BLR-BOM', 'DEL-HYD', 'CCU-BOM',
  'MAA-DEL', 'BLR-CCU', 'DEL-PNQ', 'BLR-HYD', 'AMD-DEL', 'HYD-BOM',
];

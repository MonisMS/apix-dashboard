import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, Line, Marker } from 'react-simple-maps';
import { useRoutes } from '../api';
import { idx, pct, rupees } from '../format';

// Public India state-boundary topology (deldersveld/topojson, a commonly used
// open reference dataset for choropleth/network maps of India). Fetched at
// runtime, not bundled -- react-simple-maps' standard pattern.
const INDIA_TOPOJSON =
  'https://raw.githubusercontent.com/deldersveld/topojson/master/countries/india/india-states.json';

function deviationColor(pctChange) {
  if (pctChange === null || pctChange === undefined) return 'var(--muted-foreground)';
  if (pctChange > 1.5) return 'var(--destructive)';
  if (pctChange < -1.5) return 'var(--success)';
  return 'var(--warning)';
}

export function RouteMap({ airports, routes: routeCodes, className }) {
  const { data } = useRoutes();
  const [hover, setHover] = useState(null);
  const byPair = useMemo(() => {
    const m = new Map();
    (data?.routes ?? []).forEach((r) => m.set(r.pair, r));
    return m;
  }, [data]);

  const usedAirports = useMemo(() => {
    const codes = new Set();
    routeCodes.forEach((pair) => pair.split('-').forEach((c) => codes.add(c)));
    return [...codes];
  }, [routeCodes]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [82, 22], scale: 950 }}
        width={720}
        height={640}
        style={{ width: '100%', height: 'auto' }}
      >
        <Geographies geography={INDIA_TOPOJSON}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: { fill: 'var(--secondary)', stroke: 'var(--border)', strokeWidth: 0.75, outline: 'none' },
                  hover: { fill: 'var(--secondary)', stroke: 'var(--border)', strokeWidth: 0.75, outline: 'none' },
                  pressed: { fill: 'var(--secondary)', stroke: 'var(--border)', strokeWidth: 0.75, outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {routeCodes.map((pair) => {
          const [a, b] = pair.split('-');
          const from = airports[a];
          const to = airports[b];
          if (!from || !to) return null;
          const route = byPair.get(pair);
          const color = deviationColor(route?.pct_change_1p);
          return (
            <Line
              key={pair}
              from={[from.lon, from.lat]}
              to={[to.lon, to.lat]}
              stroke={color}
              strokeWidth={hover === pair ? 2.5 : 1.25}
              strokeOpacity={hover && hover !== pair ? 0.25 : 0.85}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(pair)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {usedAirports.map((code) => {
          const a = airports[code];
          if (!a) return null;
          return (
            <Marker key={code} coordinates={[a.lon, a.lat]}>
              <circle r={3.5} fill="var(--primary)" stroke="var(--card)" strokeWidth={1} />
              <text
                textAnchor="middle"
                y={-8}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--foreground)' }}
              >
                {code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>

      {hover && byPair.get(hover) && (
        <div
          className="pointer-events-none absolute left-3 top-3 rounded-none border border-border bg-popover p-3 text-xs shadow-none"
        >
          {(() => {
            const r = byPair.get(hover);
            return (
              <>
                <p className="font-mono font-semibold text-popover-foreground">{r.pair}</p>
                <p className="tabular mt-1 text-muted-foreground">Index {idx(r.level)} · {pct(r.pct_change_1p)}</p>
                <p className="tabular text-muted-foreground">{rupees(r.mean_fare_latest)} mean fare</p>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * Animated India corridor map — satellite basemap with a moving flight
 * beacon along the selected corridor, clickable hub markers, and a corridor
 * switcher.
 *
 * Ported from the Airfare-CPI reference (rival SIH26056 submission, MIT
 * licensed): the satellite image, hub pixel coordinates, and the canvas
 * bezier-arc animation mechanism are reused closely. Two things are
 * deliberately NOT ported:
 *
 *  - Their 25 corridors were a hardcoded fictional list with invented
 *    names ("Golden Trunk Corridor") and invented weightPct values. This
 *    component only plots the 12 routes actually in our basket, and every
 *    number shown (weight, index, cells priced) comes from the live
 *    `routes` prop -- never a literal.
 *  - The animation is a decorative canvas loop (a dot advancing along a
 *    bezier curve each frame), not real flight tracking. It is not labelled
 *    as live telemetry anywhere in this component.
 */

import { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { Compass, Layers } from 'lucide-react';
import { idx, sharePct, count } from '../format';

function subscribeToDocumentDark(callback) {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
function getDocumentDarkSnapshot() {
  return typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false;
}
function getDocumentDarkServerSnapshot() {
  return false;
}

// Pixel coordinates calibrated to /india_space_satellite_borders.jpg
// (1024 x 935 viewBox). All 16 hubs from the reference are kept for
// geographic context -- only the 8 that appear in our real 12-route basket
// (DEL/BOM/BLR/HYD/CCU/MAA/AMD/PNQ) are clickable-active; the rest render as
// plain reference markers and are inert on click (no route to select).
const HUBS_CONFIG = [
  { code: 'DEL', city: 'New Delhi', state: 'Delhi', x: 356, y: 262, labelOffset: { x: 14, y: -8 } },
  { code: 'BOM', city: 'Mumbai', state: 'Maharashtra', x: 224, y: 512, labelOffset: { x: -38, y: 4 } },
  { code: 'PNQ', city: 'Pune', state: 'Maharashtra', x: 248, y: 534, labelOffset: { x: 14, y: 8 } },
  { code: 'BLR', city: 'Bengaluru', state: 'Karnataka', x: 352, y: 692, labelOffset: { x: -38, y: 4 } },
  { code: 'HYD', city: 'Hyderabad', state: 'Telangana', x: 405, y: 562, labelOffset: { x: 14, y: 4 } },
  { code: 'CCU', city: 'Kolkata', state: 'West Bengal', x: 645, y: 428, labelOffset: { x: 14, y: 4 } },
  { code: 'MAA', city: 'Chennai', state: 'Tamil Nadu', x: 432, y: 678, labelOffset: { x: 14, y: 4 } },
  { code: 'AMD', city: 'Ahmedabad', state: 'Gujarat', x: 232, y: 412, labelOffset: { x: -38, y: 0 } },
  { code: 'GOI', city: 'Goa', state: 'Goa', x: 242, y: 622, labelOffset: { x: -34, y: 4 } },
  { code: 'COK', city: 'Kochi', state: 'Kerala', x: 316, y: 768, labelOffset: { x: -34, y: 4 } },
  { code: 'JAI', city: 'Jaipur', state: 'Rajasthan', x: 324, y: 308, labelOffset: { x: -34, y: 4 } },
  { code: 'LKO', city: 'Lucknow', state: 'Uttar Pradesh', x: 465, y: 318, labelOffset: { x: 12, y: -8 } },
  { code: 'PAT', city: 'Patna', state: 'Bihar', x: 580, y: 345, labelOffset: { x: 12, y: -8 } },
  { code: 'GAU', city: 'Guwahati', state: 'Assam', x: 725, y: 342, labelOffset: { x: 12, y: -8 } },
  { code: 'SXR', city: 'Srinagar', state: 'Jammu & Kashmir', x: 320, y: 135, labelOffset: { x: -34, y: -8 } },
  { code: 'IXZ', city: 'Port Blair', state: 'Andaman & Nicobar', x: 750, y: 742, labelOffset: { x: 14, y: 4 } },
];
const HUB_MAP = Object.fromEntries(HUBS_CONFIG.map((h) => [h.code, h]));

const STATE_LABELS = [
  { name: 'JAMMU & KASHMIR', x: 330, y: 110 },
  { name: 'LADAKH', x: 385, y: 85 },
  { name: 'PUNJAB', x: 305, y: 195 },
  { name: 'HARYANA', x: 338, y: 235 },
  { name: 'RAJASTHAN', x: 270, y: 305 },
  { name: 'UTTAR PRADESH', x: 470, y: 295 },
  { name: 'GUJARAT', x: 195, y: 410 },
  { name: 'MADHYA PRADESH', x: 390, y: 415 },
  { name: 'BIHAR', x: 585, y: 325 },
  { name: 'WEST BENGAL', x: 650, y: 405 },
  { name: 'MAHARASHTRA', x: 315, y: 505 },
  { name: 'CHHATTISGARH', x: 485, y: 465 },
  { name: 'ODISHA', x: 545, y: 480 },
  { name: 'TELANGANA', x: 410, y: 540 },
  { name: 'ANDHRA PRADESH', x: 445, y: 635 },
  { name: 'KARNATAKA', x: 315, y: 640 },
  { name: 'TAMIL NADU', x: 380, y: 745 },
  { name: 'KERALA', x: 310, y: 750 },
  { name: 'ASSAM', x: 750, y: 325 },
];

// Our real 12-route basket (matches src/pages/Routes.jsx pair codes).
// No weight/name literals here -- every number rendered for a corridor
// comes from the live `routes` prop at render time.
const BASKET_PAIRS = [
  'BLR-DEL', 'DEL-BOM', 'DEL-CCU', 'DEL-HYD', 'BLR-BOM', 'MAA-DEL',
  'BLR-CCU', 'CCU-BOM', 'DEL-PNQ', 'BLR-HYD', 'AMD-DEL', 'HYD-BOM',
];
const BASKET_ROUTES = BASKET_PAIRS.map((pair) => {
  const [from, to] = pair.split('-');
  return { pair, from, to };
}).filter((r) => HUB_MAP[r.from] && HUB_MAP[r.to]);

export const TRUNK_WEIGHT_THRESHOLD = 0.07;

/** The same filter the map applies, so a panel beside it can show the same
 *  corridors instead of its own fixed top ten. */
export function filterRoutes(weighted, mode) {
  if (mode === 'top5') return [...weighted].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 5);
  if (mode === 'trunk') return weighted.filter((r) => (r.weight ?? 0) >= TRUNK_WEIGHT_THRESHOLD);
  return weighted;
}

export function NetworkMap({ routes = [], filterMode: filterProp, onFilterMode }) {
  const isDarkMode = useSyncExternalStore(subscribeToDocumentDark, getDocumentDarkSnapshot, getDocumentDarkServerSnapshot);
  const [selected, setSelected] = useState(BASKET_ROUTES[0]);
  // Controlled when the page passes a mode, so the panel beside the map can
  // follow the same filter; self-managed otherwise.
  const [ownFilter, setOwnFilter] = useState('all'); // "all" | "top5" | "trunk"
  const filterMode = filterProp ?? ownFilter;
  const setFilterMode = onFilterMode ?? setOwnFilter;
  const [hoveredHub, setHoveredHub] = useState(null);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const byPair = useMemo(() => {
    const m = new Map();
    routes.forEach((r) => m.set(r.pair, r));
    return m;
  }, [routes]);

  const activeFrom = selected?.from || 'DEL';
  const activeTo = selected?.to || 'BOM';
  const activeRouteData = byPair.get(`${activeFrom}-${activeTo}`) || byPair.get(`${activeTo}-${activeFrom}`);

  const weightedRoutes = useMemo(
    () => BASKET_ROUTES.map((r) => ({ ...r, weight: byPair.get(r.pair)?.weight ?? 0 })),
    [byPair],
  );

  const displayedRoutes = useMemo(
    () => filterRoutes(weightedRoutes, filterMode),
    [weightedRoutes, filterMode],
  );

  const getControlPoint = useCallback((h1, h2) => {
    const dx = h2.x - h1.x;
    const dy = h2.y - h1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = Math.min(dist * 0.11, 36);
    const nx = -dy / dist;
    const ny = dx / dist;
    return { x: (h1.x + h2.x) / 2 + nx * curvature, y: (h1.y + h2.y) / 2 + ny * curvature };
  }, []);

  const getBezierPoint = useCallback((p0, p1, p2, t) => {
    const invT = 1 - t;
    return {
      x: invT * invT * p0.x + 2 * invT * t * p1.x + t * t * p2.x,
      y: invT * invT * p0.y + 2 * invT * t * p1.y + t * t * p2.y,
    };
  }, []);

  const isDarkRef = useRef(isDarkMode);
  useEffect(() => {
    isDarkRef.current = isDarkMode;
  }, [isDarkMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animId;
    const VB_W = 1024;
    const VB_H = 935;

    const setupCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    setupCanvas();
    window.addEventListener('resize', setupCanvas);

    let mainProgress = 0;
    let time = 0;

    const corridorCurves = BASKET_ROUTES.map((r, i) => {
      const h1 = HUB_MAP[r.from];
      const h2 = HUB_MAP[r.to];
      if (!h1 || !h2) return null;
      return { from: r.from, to: r.to, h1, h2, cp: getControlPoint(h1, h2), speed: 0.003 + (i % 5) * 0.0008, offset: (i * 0.17) % 1 };
    }).filter(Boolean);

    const render = () => {
      if (!reduceMotion) {
        time += 0.016;
        mainProgress = (mainProgress + 0.005) % 1;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / VB_W;
      const scaleY = rect.height / VB_H;
      ctx.clearRect(0, 0, rect.width, rect.height);

      const isDark = isDarkRef.current;
      const bgRouteColor = isDark ? 'rgba(154, 195, 160, 0.28)' : 'rgba(59, 109, 77, 0.35)';
      const greenColor = isDark ? '#9ac3a0' : '#3b6d4d';
      const glowColor = isDark ? 'rgba(154, 195, 160, 0.95)' : 'rgba(59, 109, 77, 0.85)';
      const softGlowColor = isDark ? 'rgba(154, 195, 160, 0.3)' : 'rgba(59, 109, 77, 0.25)';

      corridorCurves.forEach((item) => {
        const isSelected = (item.from === activeFrom && item.to === activeTo) || (item.from === activeTo && item.to === activeFrom);
        if (isSelected) return;

        ctx.beginPath();
        ctx.moveTo(item.h1.x * scaleX, item.h1.y * scaleY);
        ctx.quadraticCurveTo(item.cp.x * scaleX, item.cp.y * scaleY, item.h2.x * scaleX, item.h2.y * scaleY);
        ctx.strokeStyle = bgRouteColor;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        const ambProg = (time * item.speed * 20 + item.offset) % 1;
        const ambPt = getBezierPoint(item.h1, item.cp, item.h2, ambProg);
        ctx.beginPath();
        ctx.arc(ambPt.x * scaleX, ambPt.y * scaleY, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.75)' : 'rgba(59, 109, 77, 0.75)';
        ctx.fill();
      });

      const h1 = HUB_MAP[activeFrom];
      const h2 = HUB_MAP[activeTo];
      if (h1 && h2) {
        const cp = getControlPoint(h1, h2);

        ctx.beginPath();
        ctx.moveTo(h1.x * scaleX, h1.y * scaleY);
        ctx.quadraticCurveTo(cp.x * scaleX, cp.y * scaleY, h2.x * scaleX, h2.y * scaleY);
        ctx.strokeStyle = softGlowColor;
        ctx.lineWidth = 12;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(h1.x * scaleX, h1.y * scaleY);
        ctx.quadraticCurveTo(cp.x * scaleX, cp.y * scaleY, h2.x * scaleX, h2.y * scaleY);
        ctx.strokeStyle = greenColor;
        ctx.lineWidth = 3.8;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const pt = getBezierPoint(h1, cp, h2, mainProgress);
        ctx.beginPath();
        ctx.arc(pt.x * scaleX, pt.y * scaleY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = greenColor;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;

        [h1, h2].forEach((hub, i) => {
          const phase = (time * 1.5 + i * 0.6) % 1;
          const radius = (6 + phase * 28) * ((scaleX + scaleY) / 2);
          const opacity = (1 - phase) * 0.8;
          ctx.beginPath();
          ctx.arc(hub.x * scaleX, hub.y * scaleY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = isDark ? `rgba(154, 195, 160, ${opacity})` : `rgba(59, 109, 77, ${opacity})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }

      if (!reduceMotion) animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', setupCanvas);
    };
  }, [activeFrom, activeTo, getControlPoint, getBezierPoint]);

  const nodeColor = isDarkMode ? '#9ac3a0' : '#3b6d4d';
  const badgeBg = isDarkMode ? 'rgba(10, 18, 28, 0.88)' : 'rgba(255, 255, 255, 0.95)';
  const badgeTextColor = isDarkMode ? '#f3f1e9' : '#191917';

  return (
    <div ref={containerRef} className="netmap-card" data-testid="india-network-map">
      <div className="netmap-telemetry">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="netmap-pill">
            <span className="netmap-live-dot" />
            <strong>SPACE VIEW &middot; STATES &amp; BORDERS DEMARCATED</strong>
          </div>
          <span className="netmap-coords">20.59&deg; N, 78.96&deg; E &middot; ORBIT 480 KM &middot; visualization, not live tracking</span>
        </div>
        <span className="netmap-engine-tag">
          <Layers size={11} style={{ display: 'inline', marginRight: 4 }} />
          {BASKET_ROUTES.length} BASKET CORRIDORS
        </span>
      </div>

      <div className="netmap-viewport">
        <div style={{ position: 'absolute', inset: 0 }}>
          <img
            src="/india_space_satellite_borders.jpg"
            alt="Satellite view of India with the airport hubs in the airfare basket"
            style={{
              width: '100%', height: '100%', objectFit: 'fill', objectPosition: 'center center',
              filter: isDarkMode ? 'contrast(1.08) brightness(0.96) saturate(1.04)' : 'contrast(1.02) brightness(1.02) saturate(1.05)',
              pointerEvents: 'none',
            }}
          />
          <div className="netmap-vignette" />
        </div>

        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />

        <svg viewBox="0 0 1024 935" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}>
          <g style={{ pointerEvents: 'none' }}>
            {STATE_LABELS.map((st) => (
              <text
                key={st.name}
                x={st.x}
                y={st.y}
                textAnchor="middle"
                fill={isDarkMode ? 'rgba(255, 255, 255, 0.42)' : 'rgba(25, 25, 23, 0.55)'}
                fontSize={8.5}
                fontWeight={500}
                letterSpacing="0.14em"
                fontFamily="var(--font-mono)"
                style={{ textShadow: isDarkMode ? '0 1px 4px rgba(0,0,0,0.9)' : '0 1px 3px rgba(255,255,255,0.9)' }}
              >
                {st.name}
              </text>
            ))}
          </g>
          <g>
            {HUBS_CONFIG.map((hub) => {
              const isActive = hub.code === activeFrom || hub.code === activeTo;
              const offset = hub.labelOffset || { x: 14, y: 4 };
              const match = BASKET_ROUTES.find((r) => r.from === hub.code || r.to === hub.code);
              const selectMatch = () => {
                if (match) setSelected(match);
              };
              return (
                <g
                  key={hub.code}
                  transform={`translate(${hub.x}, ${hub.y})`}
                  style={{ cursor: match ? 'pointer' : 'default', outline: 'none' }}
                  className="netmap-hub-marker"
                  onMouseEnter={() => setHoveredHub(hub)}
                  onMouseLeave={() => setHoveredHub(null)}
                  onClick={selectMatch}
                  {...(match
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `Inspect the ${hub.city} (${hub.code}) corridor`,
                        onFocus: () => setHoveredHub(hub),
                        onBlur: () => setHoveredHub(null),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectMatch();
                          }
                        },
                      }
                    : { 'aria-hidden': true })}
                  data-testid={`network-map-hub-${hub.code.toLowerCase()}`}
                >
                  {isActive && (
                    <circle r={18} fill={isDarkMode ? 'rgba(154, 195, 160, 0.25)' : 'rgba(59, 109, 77, 0.2)'} stroke={nodeColor} strokeWidth={1.8} strokeDasharray="4 3" />
                  )}
                  <circle
                    r={isActive ? 8 : 5}
                    fill={isActive ? nodeColor : isDarkMode ? 'rgba(154, 195, 160, 0.65)' : 'rgba(59, 109, 77, 0.7)'}
                    stroke="#ffffff"
                    strokeWidth={isActive ? 2.4 : 1.5}
                    style={{ filter: isActive ? `drop-shadow(0 0 10px ${nodeColor})` : 'none', transition: 'filter 0.2s ease, stroke-width 0.2s ease' }}
                  />
                  <circle r={isActive ? 2.8 : 1.8} fill={isDarkMode ? '#050B14' : '#ffffff'} />
                  <g transform={`translate(${offset.x}, ${offset.y})`}>
                    <rect
                      x={-4} y={-11} width={32} height={16} rx={4}
                      fill={isActive ? (isDarkMode ? '#9ac3a0' : '#191917') : badgeBg}
                      stroke={isActive ? '#ffffff' : isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}
                      strokeWidth={isActive ? 1.4 : 0.8}
                      style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))', transition: 'filter 0.2s ease, fill 0.2s ease, stroke 0.2s ease' }}
                    />
                    <text x={12} y={1} textAnchor="middle" fill={isActive ? (isDarkMode ? '#050B14' : '#ffffff') : badgeTextColor} fontSize={9.5} fontWeight={500} fontFamily="var(--font-mono)">
                      {hub.code}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {hoveredHub && (
          <div
            style={{
              position: 'absolute', left: `${(hoveredHub.x / 1024) * 100}%`, top: `${(hoveredHub.y / 935) * 100}%`,
              transform: 'translate(-50%, -130%)', background: 'var(--card)', color: 'var(--foreground)',
              border: '1px solid var(--border)', padding: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)', pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
            }}
          >
            <strong>{hoveredHub.city} ({hoveredHub.code})</strong>
            <div style={{ color: 'var(--muted-foreground)', fontSize: 10 }}>State: {hoveredHub.state}</div>
          </div>
        )}
      </div>

      <div className="netmap-console">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="netmap-corridor-eyebrow">
              <Compass size={12} />
              <span>Selected corridor ({BASKET_ROUTES.findIndex((r) => r.from === activeFrom && r.to === activeTo) + 1} of {BASKET_ROUTES.length})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="netmap-corridor-title">{activeFrom} &#8644; {activeTo}</span>
              <span className={`netmap-status-pill ${activeRouteData ? '' : 'is-missing'}`}>
                {activeRouteData ? 'Index available' : 'No data yet'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div className="netmap-stat-label">Jevons index</div>
              <div className="netmap-stat-value is-green">{activeRouteData ? idx(activeRouteData.level) : '—'}</div>
            </div>
            <div>
              <div className="netmap-stat-label">Cells priced</div>
              <div className="netmap-stat-value">{activeRouteData ? count(activeRouteData.n_cells) : '—'}</div>
            </div>
            <div>
              <div className="netmap-stat-label">Basket weight</div>
              <div className="netmap-stat-value">{activeRouteData ? sharePct(activeRouteData.weight, 2) : '—'}</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[
                ['all', `All ${BASKET_ROUTES.length} corridors`],
                ['top5', 'Top 5 by weight'],
                ['trunk', `Major trunks (>${Math.round(TRUNK_WEIGHT_THRESHOLD * 100)}%)`],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilterMode(mode)}
                  className="netmap-filter-btn"
                  data-active={filterMode === mode}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
              Click a corridor chip or a hub to inspect
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6 }}>
            {displayedRoutes.map((r) => {
              const isCurrent = r.from === activeFrom && r.to === activeTo;
              const rd = byPair.get(r.pair);
              return (
                <button
                  key={r.pair}
                  type="button"
                  onClick={() => setSelected(r)}
                  data-testid={`network-map-route-${r.pair.toLowerCase()}-button`}
                  className="netmap-chip-btn"
                  data-active={isCurrent}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {r.from} &#8644; {r.to} <span style={{ opacity: 0.65, fontSize: 10 }}>({rd ? sharePct(rd.weight, 1) : '—'})</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

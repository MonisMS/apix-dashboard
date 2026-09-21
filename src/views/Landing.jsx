'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Moon, Play, Sun, TrendingUp, X } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useAudit, useCollection, useIndex, useRoutes, useWeights, useWindows } from '../api';
import { count, idx, pct, sharePct, shortDate } from '../format';
import { SERIES_COLORS } from '../chartTokens';
import { Globe } from '../components/Globe';
import { NetworkMap, filterRoutes } from '../components/NetworkMap';
import { useTour } from '../components/tour/TourContext';
import AskAI from '../components/AskAI';
import { CopilotIcon } from '../components/CopilotIcon';
import { useDarkMode } from '../hooks/useDarkMode';

const STATIC = process.env.NEXT_PUBLIC_API_STATIC === '1';

// Real collection schedule from .github/workflows/collect.yml -- "15 5 * * *" (UTC), once daily.
const COLLECT_UTC_HOUR = 5;
const COLLECT_UTC_MINUTE = 15;

function nextCollectionLabel(now) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    COLLECT_UTC_HOUR, COLLECT_UTC_MINUTE, 0,
  ));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const ms = next - now;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function useIstClock() {
  // Starts null, not `new Date()`. This page is prerendered on the server, and
  // a clock seeded during render would bake the build machine's time into the
  // HTML and mismatch on hydration a second later.
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return { now: null, time: null, nextIn: null };
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const time = ist.toLocaleTimeString('en-GB', { hour12: false });
  return { now, time, nextIn: nextCollectionLabel(now) };
}

const SERIES_MODES = [
  { label: 'Headline', value: 'headline' },
  { label: 'By booking window', value: 'windows' },
];

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' };

// Movement colours. Hue is allowed here because it is carrying the data.
const UP_COLOR = 'var(--destructive)';
const DOWN_COLOR = 'var(--success)';

function Caret({ up }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 13, height: 13 }} aria-hidden="true">
      {up ? <path d="M12 5l7 9H5z" /> : <path d="M12 19l7-9H5z" />}
    </svg>
  );
}

/** Our own mark: a fare line over a baseline rule. */
function LogoMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 24, height: 24 }}
      aria-hidden="true"
    >
      <path d="M3 20h18M6 16l3-9 3 5 3-7 3 11" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, toggle] = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

/**
 * The imputation caveat, stated in the page's own numbers or not stated at
 * all. Every figure comes off the latest index point, so if a future run
 * imputes nothing the band does not render -- there is no evergreen warning
 * copy here to go stale.
 */
function ShortfallBar({ point, onDismiss }) {
  return (
    <div
      role="alert"
      className="relative flex items-center gap-3 px-9 py-1.5 text-center text-[12px] font-medium text-[#17181A] sm:px-10 sm:py-2 sm:text-[13.5px]"
      style={{ background: 'var(--warn-fill)' }}
    >
      <p className="flex-1 leading-snug">
        {count(point.n_cells_imputed)} of {count(point.n_cells)} price cells had no fare to
        compare today, so they follow the movement of the routes around them. That covers{' '}
        {sharePct(point.weight_imputed, 1)} of the basket.
        {/* The justification is worth saying, but not worth five lines on a
            phone before anything else is visible. */}
        <span className="hidden sm:inline">
          {' '}We publish the number with the gap stated rather than hold it back.
        </span>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss this notice"
        className="absolute right-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#17181A]/70 hover:bg-black/10 hover:text-[#17181A]"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Big mono number over a small uppercase label. */
function HeroStat({ value, label }) {
  return (
    <div>
      <p className="tabular text-[23px] font-medium leading-none tracking-[-0.02em]">{value}</p>
      <p className="tabular mt-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
    </div>
  );
}

export default function Landing() {
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [seriesMode, setSeriesMode] = useState('headline');
  const [mapFilter, setMapFilter] = useState('all');
  const { start: startTour } = useTour();
  const index = useIndex();
  const routes = useRoutes();
  const collection = useCollection();
  const audit = useAudit();
  const windows = useWindows();
  const weights = useWeights();
  const clock = useIstClock();

  const points = index.data?.points ?? [];
  const last = points[points.length - 1];
  const cov = index.data?.coverage;
  const sweep = collection.data?.sweeps?.[0];
  const dod = points.length > 1 ? (points[points.length - 1].level / points[points.length - 2].level - 1) * 100 : null;

  // Nothing here falls back to a literal. A missing query renders an em-dash
  // via the format helpers, which is the honest state, not a placeholder 12.
  const routeCount = routes.data?.n_routes ?? null;
  const observations = collection.data?.summary?.observations ?? null;

  // The aside beside the map showed a fixed top ten whatever the map was
  // filtered to, so "All 12 corridors" listed 10 and "Top 5 by weight" still
  // listed 10. It now runs the map's own filter over the same routes.
  const mapRoutes = filterRoutes(
    [...(routes.data?.routes ?? [])].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
    mapFilter,
  );
  const mapPax = mapRoutes.reduce((sum, r) => sum + (r.pax_cy ?? 0), 0) || null;

  const showShortfall = !noticeDismissed && last?.n_cells_imputed > 0;
  const indexLabel = last ? `Index, ${shortDate(last.period_end)}` : 'Index';

  // The index is referenced to the mean of its base window, so 100 is that
  // window's average and the distance from 100 is the honest "vs base" figure.
  const vsBase = last ? last.level - 100 : null;
  const refLabel = index.data?.reference?.label
    ? `${index.data.reference.window?.[0] ? 'base window' : 'base'} = 100${index.data.reference.is_provisional ? ' (provisional)' : ''}`
    : 'base = 100';

  const nDays = cov?.n_points ?? null;
  const faresPerDay = observations && nDays ? Math.round(observations / nDays) : null;

  // Whole days between the last collected date and today. Keyed off the clock
  // rather than Date.now() so it stays null until mount -- the server renders
  // at build time, and "3 days stale" baked into static HTML would both be
  // wrong and mismatch on hydration.
  const staleDays = cov?.last_date && clock.now
    ? Math.max(0, Math.round((clock.now - new Date(`${cov.last_date}T00:00:00`)) / 86_400_000))
    : null;

  const cpiWeight = weights.data?.cpi_context?.airfare_weight_pct ?? null;

  // Headline, or the five advance-purchase leads it is built from.
  const winSeries = windows.data?.windows ?? [];
  const activeSeries =
    seriesMode === 'headline'
      ? [{ key: 'APIx', color: 'var(--chart-1)' }]
      : winSeries.map((w, i) => ({ key: `T+${w.lead_time_days}`, color: SERIES_COLORS[i] }));

  const chartRows = (() => {
    if (seriesMode === 'headline') {
      return points.map((p) => ({ date: shortDate(p.period_start), APIx: p.level }));
    }
    const byDate = new Map();
    winSeries.forEach((w) => {
      (w.points ?? []).forEach((pt) => {
        const d = shortDate(pt.period_start);
        if (!byDate.has(d)) byDate.set(d, { date: d });
        byDate.get(d)[`T+${w.lead_time_days}`] = pt.level;
      });
    });
    return [...byDate.values()];
  })();

  // Each route's push on the headline: its basket weight times its own move.
  const contributions = (routes.data?.routes ?? [])
    .filter((r) => r.pct_change_1p !== null && r.pct_change_1p !== undefined)
    .map((r) => ({ pair: r.pair, contribution: r.weight * r.pct_change_1p }))
    .sort((a, b) => b.contribution - a.contribution);

  const contribSum = contributions.length
    ? contributions.reduce((acc, c) => acc + c.contribution, 0)
    : null;

  const apiSample = [
    'GET /api/v1/index',
    '',
    '{',
    '  "series_id": "APIX.ALL",',
    `  "reference": { "factor": ${index.data?.reference?.factor ?? '…'}, "is_provisional": ${index.data?.reference?.is_provisional ?? '…'} },`,
    '  "coverage":  {',
    `    "routes_with_data": ${cov?.routes_with_data ?? '…'}, "routes_in_basket": ${cov?.routes_in_basket ?? '…'},`,
    `    "n_points": ${cov?.n_points ?? '…'}`,
    '  },',
    '  "points": [ …, {',
    `    "period_start": ${JSON.stringify(last?.period_start ?? '…')},`,
    `    "level": ${last?.level ?? '…'}, "n_cells": ${last?.n_cells ?? '…'},`,
    `    "n_cells_imputed": ${last?.n_cells_imputed ?? '…'}, "weight_imputed": ${last?.weight_imputed ?? '…'}`,
    '  } ]',
    '}',
  ].join('\n');

  // Real, cited comparison -- not a fabricated stat. The MoSPI rule on record
  // (5th EG meeting, para 4.4.5, p.169) prices one-way cheapest economy
  // non-stop at a single 15-day advance booking, and STATUS_AND_DECISIONS.md
  // records each route being priced once a month. Our collector runs on the
  // cron above, once a day, across the five leads in apix/collect.py.
  const STATS = [
    { value: count(routeCount), label: 'Routes weighted' },
    { value: '1×', label: 'sweep per day' },
    { value: count(observations), label: 'Fares collected' },
    { value: idx(last?.level), label: indexLabel },
  ];

  return (
    <div className="landing-theme min-h-screen bg-background text-foreground" style={{ '--page-bg': 'var(--background)' }}>

      <div className="sticky top-0 z-40">
        {showShortfall && <ShortfallBar point={last} onDismiss={() => setNoticeDismissed(true)} />}

        <header className="border-b border-border bg-background">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-2.5 md:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <LogoMark />
              <span className="leading-tight">
                <span className="block text-[15px] font-bold tracking-[.01em]">APIx</span>
                <span className="block text-[11px] text-muted-foreground">
                  Ministry of Statistics &middot; Problem SIH26056
                </span>
              </span>
            </Link>

            <nav aria-label="Primary" className="hidden lg:flex">
              <Link
                href="/overview"
                data-tour="nav-dashboard"
                className="inline-flex items-center gap-1.5 text-[14.5px] font-medium text-foreground hover:text-muted-foreground"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Dashboard
              </Link>
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-5">
              <AskAI
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 gap-1.5 rounded-[7px] px-4 text-[14.5px] font-medium"
                  >
                    <CopilotIcon size={16} /> AskAI
                  </Button>
                }
              />
              <Button
                size="sm"
                className="h-10 rounded-[7px] px-4 text-[14.5px] font-medium"
                onClick={startTour}
                data-tour="guide-me"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Guide me
              </Button>
              <div className="hidden text-right leading-tight sm:block">
                <div className="tabular text-[13px] text-foreground">
                  {clock.time ?? '--:--:--'} IST
                </div>
                <div className="tabular text-[11.5px] text-muted-foreground">
                  next check in {clock.nextIn ?? '—'}
                </div>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </header>
      </div>

      <section className="landing-hero landing-hero-grid">
          <div className="landing-copy max-w-[620px] px-[26px] py-[46px]">
            <h1
              className="font-semibold"
              style={{
                fontSize: 'clamp(31px, 3.6vw, 46px)',
                letterSpacing: '-0.032em',
                lineHeight: 1.1,
              }}
            >
              Every fare in India,
              <br />
              reduced to <span style={{ color: 'var(--muted-foreground)' }}>one honest number</span>
            </h1>

            <p
              className="mt-[18px]"
              style={{
                color: 'var(--ink-2)',
                fontSize: 16,
                lineHeight: 1.62,
                maxWidth: '46ch',
              }}
            >
              The rule on record prices airfare for the CPI once a month, at a single
              fifteen-day advance booking. APIx prices its whole basket every day, across five
              advance-purchase windows, and reports what it could not match.
            </p>

            <div className="landing-stat-row mt-[30px]">
              {STATS.map((stat) => (
                <HeroStat key={stat.label} value={stat.value} label={stat.label} />
              ))}
            </div>

            <div className="mt-[28px] flex flex-wrap gap-2.5">
              <Button
                className="h-11 rounded-[7px] px-5 text-[14.5px] font-medium"
                onClick={startTour}
                data-tour="cta-tour"
              >
                <Play className="h-[15px] w-[15px]" aria-hidden="true" /> Walk me through it
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-[7px] border-[var(--rule-strong)] bg-transparent px-5 text-[14.5px] font-medium shadow-none"
              >
                <Link href="/methodology">
                  <TrendingUp className="h-[15px] w-[15px]" aria-hidden="true" /> See the price surface
                </Link>
              </Button>
            </div>
          </div>

          <Globe className="landing-globe" />
      </section>
      <div className="landing-hero-fade" aria-hidden="true" />

      <main className="lc-body">
        <div className="lc-explain">
          <div>
            <b>What this page shows.</b> One number for what it costs to fly in India right now,
            against the average of the reference window it is based on. It is built from{' '}
            {count(observations)} fares collected automatically across {count(routeCount)} routes,
            once a day, at five advance-purchase windows, with no one typing anything in.
          </div>
        </div>

        <div className="lc-grid">
          <section className="lc-panel">
            <div className="lc-panel-l">
              <div className="lc-lbl">National airfare price index</div>
              <div className="lc-fig">{idx(last?.level)}</div>

              <div className="lc-delta-row">
                <span className="lc-delta">
                  <Caret up={dod >= 0} />
                  {pct(dod)} <span className="sm">vs previous day</span>
                </span>
                <span className="lc-delta">
                  <Caret up={vsBase >= 0} />
                  {pct(vsBase)} <span className="sm">vs reference window</span>
                </span>
              </div>

              <p className="mb-1 text-[14px]" style={{ color: 'var(--ink-2)' }}>
                <b>Read it like this:</b> flying costs{' '}
                <b>{vsBase === null ? '—' : `${Math.abs(vsBase).toFixed(2)}% ${vsBase >= 0 ? 'more' : 'less'}`}</b>{' '}
                than it did over the five days the index is referenced to.
              </p>

              <p className="text-[12.5px]" style={{ color: 'var(--muted-foreground)' }}>
                {last ? shortDate(last.period_end) : '—'} &middot; {refLabel} &middot;
                departure-date basis &middot; Jevons &times; Young
              </p>

              <div className="lc-prov">
                <div className="lc-lbl" style={{ marginBottom: 1 }}>Proof attached to this number</div>
                <div className="lc-prow"><span className="k">Fares used</span><span className="v">{count(observations)}</span></div>
                <div className="lc-prow"><span className="k">Coverage</span><span className="v">{cov ? `${cov.routes_with_data} / ${cov.routes_in_basket}` : '—'}</span></div>
                <div className="lc-prow"><span className="k">Estimated</span><span className="v">{sharePct(last?.weight_imputed, 2)}</span></div>
                <div className="lc-prow"><span className="k">Revised since</span><span className="v">never</span></div>
                <div className="lc-prow"><span className="k">Transitivity drift</span><span className="v">{pct(audit.data?.transitivity?.drift_pct)}</span></div>
              </div>
            </div>

            <div className="lc-panel-r">
              <div className="lc-card-h">
                <div>
                  <div className="lc-finding">
                    {vsBase === null
                      ? 'Index awaiting its first complete reference window'
                      : `Fares sit ${Math.abs(vsBase).toFixed(2)}% ${vsBase >= 0 ? 'above' : 'below'} their reference-window average`}
                  </div>
                  <p className="lc-sub">
                    The dark line is the headline index. Switching to booking windows splits it into the
                    five advance-purchase leads it is built from (T+1 through T+45), which is
                    where most of the day-to-day movement actually lives.
                  </p>
                </div>
                <div className="lc-seg" role="group" aria-label="Series shown">
                  {SERIES_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      aria-pressed={seriesMode === m.value}
                      onClick={() => setSeriesMode(m.value)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="lc-legend">
                {activeSeries.map((s) => (
                  <span className="lc-lg" key={s.key}>
                    <i style={{ background: s.color }} />
                    {s.key}
                  </span>
                ))}
              </div>

              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 6, right: 26, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={52} />
                    <RTooltip
                      contentStyle={{
                        background: 'var(--popover)', border: '1px solid var(--border)',
                        borderRadius: 8, fontSize: 12.5,
                      }}
                      labelStyle={{ color: 'var(--muted-foreground)' }}
                    />
                    {activeSeries.map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        stroke={s.color}
                        strokeWidth={s.key === 'APIx' ? 2 : 1.4}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <div className="lc-stats">
            <div className="lc-stat">
              <span className="k">Routes weighted</span>
              <span className="v">{count(routeCount)}</span>
              <span className="n">DGCA passenger-traffic basket</span>
            </div>
            <div className="lc-stat">
              <span className="k">Checks per day</span>
              <span className="v">1</span>
              <span className="n">the rule on record: one a month</span>
            </div>
            <div className="lc-stat">
              <span className="k">Fares read daily</span>
              <span className="v">{count(faresPerDay)}</span>
              <span className="n">no human in the loop</span>
            </div>
            <div className="lc-stat">
              <span className="k">How stale</span>
              <span className="v">{staleDays === null ? '—' : `${staleDays}d`}</span>
              <span className="n">since the last completed sweep</span>
            </div>
            <div className="lc-stat">
              <span className="k">Airfare in CPI</span>
              <span className="v">{cpiWeight === null ? '—' : `${cpiWeight.toFixed(3)}%`}</span>
              <span className="n">its weight in the 2024 basket</span>
            </div>
          </div>

          <section>
            <div className="lc-finding">Where the basket reaches</div>
            <p className="lc-sub" style={{ marginBottom: 14 }}>
              Click a hub or a corridor chip to inspect it. The moving beacon is a visualization of
              the selected corridor, not live flight tracking. The index, cells priced and basket
              weight shown for it are real, pulled from the same data as the table above.
            </p>
            <div className="netmap-layout">
              <NetworkMap
                routes={routes.data?.routes ?? []}
                filterMode={mapFilter}
                onFilterMode={setMapFilter}
              />
              <aside className="netmap-notes">
                <div className="netmap-note-figure">
                  {/* 3,74,75,530 in Indian digit grouping is hard to take in
                      at a glance; crore is how this size of number is read
                      here. The exact figure stays on hover. */}
                  <strong title={`${count(mapPax)} passenger journeys`}>
                    {mapPax ? `${(mapPax / 1e7).toFixed(2)} crore` : '—'}
                  </strong>
                  <p>
                    DGCA passenger journeys (CY2025) on the {mapRoutes.length}{' '}
                    {mapRoutes.length === 1 ? 'corridor' : 'corridors'} shown on the map.
                  </p>
                </div>
                <div>
                  <div className="netmap-ranking-header">
                    <span className="eyebrow">Highest-weighted corridors</span>
                    <span className="tag">Basket share</span>
                  </div>
                  {mapRoutes.map((r, i) => (
                    <div className="netmap-hub-row" key={r.pair}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{r.pair}</strong>
                        <small>{count(r.pax_cy)} DGCA passengers, CY2025</small>
                      </div>
                      <span className="netmap-hub-share">{sharePct(r.weight, 1)}</span>
                    </div>
                  ))}
                  {mapRoutes.length === 0 && (
                    <p className="text-xs text-muted-foreground">Route weights are unavailable right now.</p>
                  )}
                </div>
              </aside>
            </div>
          </section>

          <div className="lc-g2">
            <section className="lc-card">
              <div className="lc-finding">Which routes moved the index today</div>
              <p className="lc-sub">
                Busy routes move the national number more than quiet ones, because each route is
                weighted by expenditure (passengers times mean fare), not by how many flights it
                has.
              </p>
              <div className="lc-legend">
                <span className="lc-lg"><i style={{ background: UP_COLOR }} />Pushed the index up</span>
                <span className="lc-lg"><i style={{ background: DOWN_COLOR }} />Pulled it down</span>
              </div>
              <div style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contributions} layout="vertical" margin={{ top: 4, right: 14, left: 6, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <ReferenceLine x={0} stroke="var(--muted-foreground)" />
                    <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} unit="pp" />
                    <YAxis type="category" dataKey="pair" tick={AXIS_TICK} tickLine={false} axisLine={false} width={72} />
                    <RTooltip
                      cursor={{ fill: 'var(--muted)', fillOpacity: 0.55 }}
                      wrapperStyle={{ outline: 'none' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const v = payload[0].value;
                        return (
                          <div
                            style={{
                              background: 'var(--popover)',
                              color: 'var(--popover-foreground)',
                              border: '1px solid var(--border)',
                              padding: '8px 10px',
                              fontSize: 12,
                              boxShadow: '0 2px 8px rgb(0 0 0 / 0.12)',
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
                            <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {v >= 0 ? '+' : ''}{v.toFixed(3)} pp of the headline move
                            </div>
                            <div style={{ color: 'var(--muted-foreground)', marginTop: 2 }}>
                              {v >= 0 ? 'pushed the index up' : 'pulled the index down'}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="contribution" isAnimationActive={false} radius={[0, 3, 3, 0]} maxBarSize={18}>
                      {contributions.map((c) => (
                        <Cell key={c.pair} fill={c.contribution >= 0 ? UP_COLOR : DOWN_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="lc-note">
                <b>These do not add up, and that is the point.</b> The twelve contributions sum to{' '}
                {contribSum === null ? '—' : `${contribSum.toFixed(2)} pp`} against a headline move of{' '}
                {pct(dod)}. The gap is imputed cells and day-to-day sample churn, and it is shown
                rather than spread silently across the routes.
              </div>
            </section>

            <section className="lc-card">
              <div className="lc-finding">The number leaves as plain, versioned JSON</div>
              <p className="lc-sub">
                No integration project and no bespoke format. Every figure on this page is one
                public GET away, with its coverage and reference window attached to the response.
              </p>
              <pre className="lc-code">{apiSample}</pre>
              <div className="lc-note">
                <b>Nothing is published without its shortfall.</b> Every response carries how many
                routes reported, how much was imputed, and whether the reference window is still
                provisional, so a number can be checked before it is quoted.
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-[80rem] grid-cols-2 gap-8 px-4 py-10 md:grid-cols-4 md:px-8">
          <div className="col-span-2 md:col-span-1">
            <span className="font-mono text-sm font-semibold">APIx</span>
            <p className="mt-2 text-xs text-muted-foreground">
              A real-time airfare price index for India. Independent SIH26056 prototype -- not an
              official MoSPI, NSO, or RBI product.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/overview" className="text-muted-foreground hover:text-foreground">Overview</Link></li>
              <li><Link href="/methodology" className="text-muted-foreground hover:text-foreground">Methodology</Link></li>
              <li><Link href="/api-docs" className="text-muted-foreground hover:text-foreground">API Docs</Link></li>
              <li><Link href="/tariffs" className="text-muted-foreground hover:text-foreground">Data Sources</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data &amp; Provenance</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/data" className="text-muted-foreground hover:text-foreground">Collection Log</Link></li>
              <li><Link href="/validation" className="text-muted-foreground hover:text-foreground">Validation vs MoSPI</Link></li>
              <li><Link href="/cleaning" className="text-muted-foreground hover:text-foreground">Cleaning Methodology</Link></li>
              <li><Link href="/split" className="text-muted-foreground hover:text-foreground">Base Fare &amp; Taxes</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href="https://github.com" className="text-muted-foreground hover:text-foreground">GitHub Repo</a></li>
              <li><Link href="/methodology" className="text-muted-foreground hover:text-foreground">About</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground md:px-8">
            <span suppressHydrationWarning>&copy; {new Date().getFullYear()} APIx &middot; Built for Smart India Hackathon 2026 &middot; Problem Statement 26056 &middot; MoSPI</span>
            <div className="flex items-center gap-3">
              <span>v0.1.0-prototype</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

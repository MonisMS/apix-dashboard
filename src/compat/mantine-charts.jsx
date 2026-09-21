/**
 * Drop-in replacements for the @mantine/charts components the existing pages
 * use, built directly on Recharts (already a dependency) with the same
 * CSS-variable color tokens as the rest of the app. See src/compat/mantine.jsx
 * for why this compat layer exists.
 */
import { Fragment } from 'react';
import {
  Area, AreaChart as RAreaChart, Bar, BarChart as RBarChart, CartesianGrid,
  Cell, LabelList, Line, LineChart as RLineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart as RScatterChart, Tooltip, XAxis,
  YAxis,
} from 'recharts';
import { resolveColor } from './style';

const GRID = 'var(--border)';
const AXIS = 'var(--muted-foreground)';

function TooltipBox({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-none border border-border p-2 text-xs"
      style={{
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        boxShadow: '0 2px 8px rgb(0 0 0 / 0.12)',
      }}
    >
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 tabular-nums">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-medium">{valueFormatter ? valueFormatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function AreaChart({
  h = 260, data, dataKey, series = [], valueFormatter, yAxisProps, withDots = true, fillOpacity = 0.15,
}) {
  return (
    <ResponsiveContainer width="100%" height={h}>
      <RAreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={dataKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={40} {...(yAxisProps ?? {})} />
        <Tooltip
          content={<TooltipBox valueFormatter={valueFormatter} />}
          wrapperStyle={{ outline: 'none' }}
          cursor={{ fill: 'var(--muted)', fillOpacity: 0.55, stroke: GRID }}
        />
        {series.map((s) => (
          <Area
            key={s.name}
            type="linear"
            dataKey={s.name}
            stroke={resolveColor(s.color)}
            fill={resolveColor(s.color)}
            fillOpacity={fillOpacity}
            dot={withDots ? { r: 2.5 } : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
            strokeWidth={1.75}
          />
        ))}
      </RAreaChart>
    </ResponsiveContainer>
  );
}

export function LineChart({
  h = 260, data, dataKey, series = [], valueFormatter, yAxisProps, xAxisProps, withDots = true, referenceLines = [],
}) {
  return (
    <ResponsiveContainer width="100%" height={h}>
      <RLineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={dataKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} {...(xAxisProps ?? {})} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={40} {...(yAxisProps ?? {})} />
        <Tooltip
          content={<TooltipBox valueFormatter={valueFormatter} />}
          wrapperStyle={{ outline: 'none' }}
          cursor={{ stroke: GRID, strokeWidth: 1 }}
        />
        {referenceLines.map((rl) => (
          <ReferenceLine
            key={rl.y}
            y={rl.y}
            stroke={resolveColor(rl.color)}
            strokeDasharray="4 4"
            // A bare string label is placed by Recharts at the line's centre
            // and painted outside the plot area, so "reference = 100" was
            // clipped by the container edge. Anchoring it inside the plot,
            // with an explicit fill so it is legible in both themes, keeps it
            // on screen at every width.
            label={
              rl.label
                ? {
                    value: rl.label,
                    position: rl.labelPosition ?? 'insideTopLeft',
                    fill: AXIS,
                    fontSize: 11,
                  }
                : undefined
            }
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.name}
            type="linear"
            dataKey={s.name}
            stroke={resolveColor(s.color)}
            dot={withDots ? { r: 2.5 } : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
            strokeWidth={1.75}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  );
}

export function BarChart({ h = 260, data, dataKey, series = [], valueFormatter, yAxisProps, xAxisProps }) {
  return (
    <ResponsiveContainer width="100%" height={h}>
      <RBarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={dataKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} {...(xAxisProps ?? {})} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={40} {...(yAxisProps ?? {})} />
        <Tooltip
          content={<TooltipBox valueFormatter={valueFormatter} />}
          wrapperStyle={{ outline: 'none' }}
          cursor={{ fill: 'var(--muted)', fillOpacity: 0.55, stroke: GRID }}
        />
        {series.map((s) => (
          <Bar key={s.name} dataKey={s.name} fill={resolveColor(s.color)} radius={[3, 3, 0, 0]} maxBarSize={36} />
        ))}
      </RBarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ size = 200, thickness = 26, data = [], valueFormatter, chartLabel }) {
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={size / 2 - thickness}
          outerRadius={size / 2}
          startAngle={90}
          endAngle={-270}
          strokeWidth={1}
          stroke="var(--card)"
        >
          {data.map((d, i) => (
            <Cell key={d.name ?? i} fill={resolveColor(d.color)} />
          ))}
        </Pie>
        <Tooltip
          content={<TooltipBox valueFormatter={valueFormatter} />}
          wrapperStyle={{ outline: 'none' }}
          cursor={{ fill: 'var(--muted)', fillOpacity: 0.55, stroke: GRID }}
        />
      </PieChart>
      {chartLabel && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
        >
          {chartLabel}
        </div>
      )}
    </div>
  );
}

const DIVERGING = ['var(--destructive)', 'var(--warning)', 'var(--muted)', 'var(--chart-3)', 'var(--success)'];
const SEQUENTIAL = ['var(--chart-5)', 'var(--chart-4)', 'var(--chart-3)', 'var(--chart-2)', 'var(--chart-1)'];

function cellColor(value, domain, signed) {
  if (value === null || value === undefined) return 'var(--muted)';
  const scale = signed ? DIVERGING : SEQUENTIAL;
  const [lo, hi] = domain ?? [0, 1];
  const t = hi === lo ? 0.5 : (value - lo) / (hi - lo);
  const idx = Math.max(0, Math.min(scale.length - 1, Math.round(t * (scale.length - 1))));
  return scale[idx];
}

/** Routes x dates matrix. Mantine's MatrixChart isn't Recharts-based either, so this is a plain CSS grid. */
export function MatrixChart({
  data = [], xLabels = [], yLabels = [], domain, cellSize = 56, gap = 4, cellRadius = 6,
  yLabelsWidth = 90, getTooltipLabel,
}) {
  const byKey = new Map(data.map((c) => [`${c.y}__${c.x}`, c.value]));
  const values = data.map((c) => c.value).filter((v) => v !== null && v !== undefined);
  const maxAbs = values.length ? Math.max(...values.map(Math.abs)) : 1;
  const resolvedDomain = domain ?? [Math.min(0, ...values), Math.max(1, ...values)];
  const signed = !!domain && domain[0] < 0;

  return (
    <div className="inline-block">
      <div style={{ display: 'grid', gridTemplateColumns: `${yLabelsWidth}px repeat(${xLabels.length}, ${cellSize}px)`, gap }}>
        <div />
        {xLabels.map((x) => (
          <div key={x} className="text-center text-[11px] text-muted-foreground" style={{ height: 24 }}>{x}</div>
        ))}
        {yLabels.map((y) => (
          <Fragment key={y}>
            <div className="flex items-center text-[11px] text-muted-foreground truncate" style={{ width: yLabelsWidth }}>
              {y}
            </div>
            {xLabels.map((x) => {
              const v = byKey.get(`${y}__${x}`);
              return (
                <div
                  key={`${y}-${x}`}
                  title={getTooltipLabel?.({ y, x, value: v })}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: cellRadius,
                    background: cellColor(v, resolvedDomain, signed),
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}


/**
 * A labelled scatter: each entity placed on two measures at once.
 *
 * Added for /routes, where the chart was a ranked bar of one number. A bar
 * chart of a single static field cannot answer the question that page is
 * really asking -- whether the routes carrying the most weight are the ones
 * sitting away from the reference -- because that question is about two
 * measures together.
 *
 * Every point is direct-labelled, so identity never depends on colour, and
 * colour only repeats the side of the reference line the point already sits
 * on.
 */
export function ScatterPlot({
  h = 320,
  data = [],
  xKey,
  yKey,
  labelKey,
  xName,
  yName,
  refY,
  refLabel,
  colorOf = () => 'var(--chart-2)',
  xFormatter = (v) => v,
  yFormatter = (v) => v,
  xTicksFormatter,
  yTicksFormatter,
}) {
  const xs = data.map((d) => d[xKey]).filter((v) => v != null);
  const ys = data.map((d) => d[yKey]).filter((v) => v != null);
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.18 || 1;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.18 || 1;

  // Direct labels collide when two entities land close together -- on the
  // routes data, two pairs sit within ~15px of each other. Decide up/down per
  // point in normalised space (approximating the plot's aspect) so every
  // label stays legible without dropping any.
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const spanY = Math.max(...ys) - Math.min(...ys) || 1;
  const placed = [];
  const below = data.map((d) => {
    const nx = ((d[xKey] - Math.min(...xs)) / spanX) * 900;
    const ny = ((d[yKey] - Math.min(...ys)) / spanY) * 300;
    const clash = placed.some((q) => !q.below && Math.hypot(q.nx - nx, q.ny - ny) < 46);
    placed.push({ nx, ny, below: clash });
    return clash;
  });

  return (
    <ResponsiveContainer width="100%" height={h}>
      <RScatterChart margin={{ top: 16, right: 20, left: 4, bottom: 28 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey={xKey}
          name={xName}
          stroke={AXIS}
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          domain={[Math.min(...xs) - padX, Math.max(...xs) + padX]}
          tickFormatter={xTicksFormatter}
          label={{ value: xName, position: 'insideBottom', offset: -16, fill: AXIS, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey={yKey}
          name={yName}
          stroke={AXIS}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={46}
          domain={[Math.min(...ys) - padY, Math.max(...ys) + padY]}
          tickFormatter={yTicksFormatter}
          label={{ value: yName, angle: -90, position: 'insideLeft', fill: AXIS, fontSize: 11 }}
        />
        {refY != null && (
          <ReferenceLine
            y={refY}
            stroke={AXIS}
            strokeDasharray="4 4"
            label={refLabel ? { value: refLabel, position: 'insideTopLeft', fill: AXIS, fontSize: 11 } : undefined}
          />
        )}
        <Tooltip
          cursor={{ stroke: GRID, strokeDasharray: '3 3' }}
          wrapperStyle={{ outline: 'none' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <div
                className="rounded-none border border-border p-2 text-xs"
                style={{ background: 'var(--popover)', color: 'var(--popover-foreground)' }}
              >
                <div className="mb-1 font-medium">{p[labelKey]}</div>
                <div className="tabular-nums">{xName}: {xFormatter(p[xKey])}</div>
                <div className="tabular-nums">{yName}: {yFormatter(p[yKey])}</div>
              </div>
            );
          }}
        />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d[labelKey]} fill={colorOf(d)} r={6} />
          ))}
          <LabelList
            dataKey={labelKey}
            content={({ x, y, value, index }) => (
              <text
                x={x}
                y={y + (below[index] ? 17 : -10)}
                textAnchor="middle"
                fontSize={10}
                fill={AXIS}
              >
                {value}
              </text>
            )}
          />
        </Scatter>
      </RScatterChart>
    </ResponsiveContainer>
  );
}

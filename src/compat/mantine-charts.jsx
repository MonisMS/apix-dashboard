/**
 * Drop-in replacements for the @mantine/charts components the existing pages
 * use, built directly on Recharts (already a dependency) with the same
 * CSS-variable color tokens as the rest of the app. See src/compat/mantine.jsx
 * for why this compat layer exists.
 */
import { Fragment } from 'react';
import {
  Area, AreaChart as RAreaChart, Bar, BarChart as RBarChart, CartesianGrid,
  Cell, Line, LineChart as RLineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { resolveColor } from './style';

const GRID = 'var(--border)';
const AXIS = 'var(--muted-foreground)';

function TooltipBox({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}: {valueFormatter ? valueFormatter(p.value) : p.value}</span>
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
        <Tooltip content={<TooltipBox valueFormatter={valueFormatter} />} />
        {series.map((s) => (
          <Area
            key={s.name}
            type="linear"
            dataKey={s.name}
            stroke={resolveColor(s.color)}
            fill={resolveColor(s.color)}
            fillOpacity={fillOpacity}
            dot={withDots ? { r: 2.5 } : false}
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
      <RLineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={dataKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={{ stroke: GRID }} {...(xAxisProps ?? {})} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={40} {...(yAxisProps ?? {})} />
        <Tooltip content={<TooltipBox valueFormatter={valueFormatter} />} />
        {referenceLines.map((rl) => (
          <ReferenceLine key={rl.y} y={rl.y} label={rl.label} stroke={resolveColor(rl.color)} strokeDasharray="4 4" />
        ))}
        {series.map((s) => (
          <Line
            key={s.name}
            type="linear"
            dataKey={s.name}
            stroke={resolveColor(s.color)}
            dot={withDots ? { r: 2.5 } : false}
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
        <Tooltip content={<TooltipBox valueFormatter={valueFormatter} />} />
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
        <Tooltip content={<TooltipBox valueFormatter={valueFormatter} />} />
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

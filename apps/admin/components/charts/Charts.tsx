'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ghsCompact, num } from '@/lib/format';

/**
 * Charts.
 *
 * Rules applied to all of them, because a chart is the easiest place in a
 * console to be confidently wrong:
 *  - every chart has a text alternative. A <table> in an sr-only block carries
 *    the same numbers, because a canvas is invisible to a screen reader and
 *    "look at the graph" is not an answer.
 *  - no data and failed-to-load are different states and never render as a flat
 *    line at zero.
 *  - entrance animation is off. The numbers must be readable immediately, and
 *    an animating axis is motion with no meaning.
 *  - grid lines sit at low contrast so they never compete with the data.
 *  - money is formatted through the same helper as the rest of the console, so
 *    a chart can never disagree with the table beside it.
 */

const AXIS = {
  stroke: 'var(--text-faint)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

const GRID = { stroke: 'var(--line)', strokeDasharray: '3 3', vertical: false };

function ChartFrame({
  height = 220,
  children,
  table,
}: {
  height?: number;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ height }} aria-hidden="true">
        {children}
      </div>
      <div className="sr-only">{table}</div>
    </div>
  );
}

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  formatter: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="popover px-2.5 py-2">
      <p className="text-[11px] text-text-faint mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="t-small num flex items-center gap-1.5">
          <span className="dot" style={{ background: p.color }} />
          {p.name}: <strong>{formatter(p.value ?? 0)}</strong>
        </p>
      ))}
    </div>
  );
}

function NoData({ height = 220, message }: { height?: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center text-center"
      style={{ height }}
      role="status"
    >
      <p className="t-small text-text-faint max-w-[34ch]">{message}</p>
    </div>
  );
}

type DayPoint = { date: string; valuePesewas?: number; value?: number };

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export function RevenueChart({ data }: { data: DayPoint[] | null }) {
  if (!data) return <NoData message="Revenue could not be loaded. This is an error, not zero revenue." />;
  if (data.length === 0) {
    return <NoData message="No settled fares in the last 14 days." />;
  }

  const rows = data.map((d) => ({ date: d.date, value: (d.valuePesewas ?? 0) / 100 }));

  return (
    <ChartFrame
      table={
        <table>
          <caption>Settled revenue per day, last 14 days, in Ghana cedis</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{shortDate(d.date)}</td>
                <td>{ghsCompact(d.valuePesewas ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={18} />
          <YAxis {...AXIS} width={54} tickFormatter={(v) => `₵${Math.round(v)}`} />
          <Tooltip
            content={<TooltipBox formatter={(v) => ghsCompact(v * 100)} />}
            cursor={{ stroke: 'var(--line-strong)' }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name="Revenue"
            stroke="var(--accent)"
            strokeWidth={1.75}
            fill="url(#revFill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function TripsChart({ data }: { data: DayPoint[] | null }) {
  if (!data) return <NoData message="Trip volume could not be loaded." />;
  if (data.length === 0) return <NoData message="No trips in the last 14 days." />;

  const rows = data.map((d) => ({ date: d.date, value: d.value ?? 0 }));

  return (
    <ChartFrame
      table={
        <table>
          <caption>Trips created per day, last 14 days</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Trips</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date}>
                <td>{shortDate(d.date)}</td>
                <td>{num(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={18} />
          <YAxis {...AXIS} width={40} allowDecimals={false} />
          <Tooltip
            content={<TooltipBox formatter={(v) => `${num(v)} trips`} />}
            cursor={{ fill: 'var(--surface-3)' }}
          />
          <Bar dataKey="value" name="Trips" fill="var(--info)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Status mix. A horizontal bar rather than a pie: trip status has far more than
 * the five categories a pie can carry, and comparing lengths beats comparing
 * angles at every count.
 */
export function StatusBreakdown({
  data,
}: {
  data: Record<string, number> | null;
}) {
  if (!data) return <NoData height={180} message="Status breakdown could not be loaded." />;

  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return <NoData height={180} message="No trips recorded yet." />;

  const total = entries.reduce((s, [, v]) => s + v, 0);

  const colourFor = (status: string) => {
    if (status === 'COMPLETED') return 'var(--accent)';
    if (status === 'CANCELLED' || status === 'NO_SHOW') return 'var(--danger)';
    if (status === 'EXPIRED' || status === 'NO_DRIVERS_FOUND') return 'var(--warn)';
    return 'var(--info)';
  };

  return (
    <ul className="space-y-2.5">
      {entries.map(([status, count]) => {
        const share = (count / total) * 100;
        return (
          <li key={status}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="t-small text-text-dim">
                {status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </span>
              <span className="t-small num text-text-faint">
                {num(count)} · {share.toFixed(1)}%
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-surface-3 overflow-hidden"
              role="img"
              aria-label={`${status.replace(/_/g, ' ')}: ${count} trips, ${share.toFixed(1)} percent`}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(share, 1)}%`, background: colourFor(status) }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Cash versus card. The single most important split on a cash-majority platform. */
export function PaymentMixChart({
  mix,
}: {
  mix: { cash: number; card: number } | null;
}) {
  if (!mix) return <NoData height={180} message="Payment mix could not be loaded." />;

  const total = mix.cash + mix.card;
  if (total === 0) return <NoData height={180} message="No bookings recorded yet." />;

  const rows = [
    { name: 'Cash', value: mix.cash, fill: 'var(--accent)' },
    { name: 'Card / MoMo', value: mix.card, fill: 'var(--info)' },
  ];

  return (
    <ChartFrame
      height={180}
      table={
        <table>
          <caption>Bookings by payment method</caption>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{num(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" {...AXIS} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...AXIS} width={84} />
          <Tooltip
            content={<TooltipBox formatter={(v) => `${num(v)} bookings`} />}
            cursor={{ fill: 'var(--surface-3)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'var(--text-faint)' }}
            formatter={(v) => <span style={{ color: 'var(--text-dim)' }}>{v}</span>}
          />
          <Bar dataKey="value" name="Bookings" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

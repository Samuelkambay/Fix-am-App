import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../../components/ui';
import { le, leShort, num } from '../../lib/format';

interface Day {
  day: string;
  bookings: number;
  gmv_minor: number;
}

/** Fills days with no bookings so the time axis is continuous. */
function fill(daily: Day[], days: number): Day[] {
  const map = new Map(daily.map((d) => [d.day, d]));
  const out: Day[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, bookings: 0, gmv_minor: 0 });
  }
  return out;
}

const shortDay = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** SVG presentation attributes do not reliably resolve CSS variables, so read the token's current value (and follow theme changes). */
function useTokens(names: string[]): Record<string, string> {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const update = () => setV(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

/** Two small multiples sharing the time axis (never a dual-axis chart): GMV, then bookings. */
export default function DailyCharts({ daily, days }: { daily: Day[]; days: number }) {
  const data = useMemo(() => fill(daily, days), [daily, days]);
  const [table, setTable] = useState(false);
  const t = useTokens(['--series-1', '--grid', '--text-3', '--surface-2']);
  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' };
  const axis = { stroke: t['--text-3'], fontSize: 11, tickLine: false, axisLine: false } as const;

  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="small muted">
          {num(data.reduce((a, d) => a + d.bookings, 0))} bookings · {le(data.reduce((a, d) => a + d.gmv_minor, 0))} GMV
        </span>
        <Button size="sm" variant="ghost" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {table ? (
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="right">Bookings</th>
                <th className="right">GMV</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{shortDay(d.day)}</td>
                  <td className="right num">{d.bookings}</td>
                  <td className="right num">{le(d.gmv_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="small strong text-2">GMV per day (completed jobs)</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={t['--grid']} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={24} />
                <YAxis tickFormatter={(v: number) => leShort(v)} {...axis} width={64} />
                <Tooltip
                  cursor={{ fill: t['--surface-2'] }}
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => shortDay(String(l))}
                  formatter={(v) => [le(Number(v)), 'GMV']}
                />
                <Bar dataKey="gmv_minor" fill={t['--series-1']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="small strong text-2">Bookings per day</div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={t['--grid']} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={24} />
                <YAxis allowDecimals={false} {...axis} width={64} />
                <Tooltip
                  cursor={{ fill: t['--surface-2'] }}
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => shortDay(String(l))}
                  formatter={(v) => [num(Number(v)), 'Bookings']}
                />
                <Bar dataKey="bookings" fill={t['--series-1']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

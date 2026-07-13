import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useStatsMessagesQuery } from '../hooks/queries';
import type { StatsPeriod } from '../services/api';
import { formatChatLabel } from '../utils/chatLabel';
import './DashboardCharts.css';

const PERIODS: StatsPeriod[] = ['24h', '7d', '30d'];

// Stable, distinct color per message type (recharts needs literal colors). Keyed by type name —
// not array index — so two types can never share a color, and a slice keeps its color even when the
// set of present types changes between requests. Covers every type mapMessageType() can emit.
const TYPE_COLORS: Record<string, string> = {
  text: '#0cadf3',
  image: '#046c9a',
  contact: '#56c3e1',
  document: '#f59e0b',
  audio: '#06b6d4',
  voice: '#ec4899',
  video: '#14b8a6',
  sticker: '#ef4444',
  location: '#84cc16',
  poll: '#6366f1',
  revoked: '#f43f5e',
  masked: '#8b5cf6',
  unknown: '#7a8484',
};

// Deterministic fallback for any unmapped type, so its color is stable across renders.
const FALLBACK_COLORS = ['#0cadf3', '#56c3e1', '#046c9a', '#10b981', '#6366f1', '#eab308'];
function colorForType(name: string): string {
  if (TYPE_COLORS[name]) return TYPE_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// '2026-06-24 14:00:00' (hour buckets) → '14:00'; '2026-06-24' (day buckets) → '06-24'.
function formatTick(ts: string, period: StatsPeriod): string {
  return period === '24h' ? ts.slice(11, 16) : ts.slice(5);
}

type TopChatRow = {
  /** Unique stable key for the axis (recharts category). */
  id: string;
  shortLabel: string;
  fullLabel: string;
  count: number;
};

/** Custom Y tick: truncated label, no overlap with neighbouring rows. */
function TopChatYTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  labels: Map<string, string>;
}) {
  const { x = 0, y = 0, payload, labels } = props;
  const id = payload?.value ?? '';
  const text = labels.get(id) ?? id;
  return (
    <text
      x={x - 6}
      y={y}
      dy={4}
      textAnchor="end"
      fill="var(--text-secondary)"
      fontSize={11}
      className="top-chat-tick"
    >
      {text}
    </text>
  );
}

export function DashboardCharts() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<StatsPeriod>('7d');
  const { data, isLoading, isError, error } = useStatsMessagesQuery(period);

  // Non-admin keys 403 on /stats/messages → hide the section entirely. Any OTHER error (e.g. a
  // server 500) is a real fault: surface a small notice below instead of silently vanishing, which
  // is what masked the #488 stats crash and made the whole chart "disappear" with no explanation.
  const forbidden = (error as (Error & { status?: number }) | null)?.status === 403;

  const timeSeries = useMemo(
    () => (data?.timeSeries ?? []).map(p => ({ ...p, label: formatTick(p.timestamp, period) })),
    [data?.timeSeries, period],
  );
  const byType = useMemo(
    () =>
      Object.entries(data?.byType ?? {})
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    [data?.byType],
  );

  const topChats: TopChatRow[] = useMemo(() => {
    const rows = (data?.topChats ?? []).slice(0, 8);
    const usedShort = new Map<string, number>();
    return rows.map(c => {
      const label = formatChatLabel(c.chatId, c.chatName);
      let short = label.short;
      // Keep axis categories unique so two "Private ···1005" contacts don't collide.
      const n = (usedShort.get(short) ?? 0) + 1;
      usedShort.set(short, n);
      if (n > 1) short = `${short.replace(/…$/, '')} (${n})`;
      return {
        id: c.chatId || label.full,
        shortLabel: short,
        fullLabel: label.full,
        count: c.messageCount,
      };
    });
  }, [data?.topChats]);

  const topChatLabelMap = useMemo(() => new Map(topChats.map(r => [r.id, r.shortLabel])), [topChats]);
  const topChatFullMap = useMemo(() => new Map(topChats.map(r => [r.id, r.fullLabel])), [topChats]);

  if (isError && forbidden) return null;

  const hasData = timeSeries.length > 0 || byType.length > 0 || topChats.length > 0;

  return (
    <section className="dashboard-charts">
      <div className="charts-header">
        <div className="charts-title">
          <BarChart3 size={18} />
          <h2>{t('dashboard.charts.title')}</h2>
        </div>
        <div className="period-toggle" role="group" aria-label={t('dashboard.charts.title')}>
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              className={`period-tab ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {t(`dashboard.charts.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="charts-empty">{t('common.loading')}</div>
      ) : isError ? (
        <div className="charts-empty">{t('dashboard.charts.error')}</div>
      ) : !hasData ? (
        <div className="charts-empty">{t('dashboard.charts.empty')}</div>
      ) : (
        <div className="charts-grid">
          <div className="chart-card chart-wide">
            <h3>{t('dashboard.charts.overTime')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={timeSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0cadf3" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0cadf3" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gReceived" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#046c9a" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#046c9a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="sent"
                  name={t('dashboard.charts.sent')}
                  stroke="#0cadf3"
                  fill="url(#gSent)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="received"
                  name={t('dashboard.charts.received')}
                  stroke="#046c9a"
                  fill="url(#gReceived)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3>{t('dashboard.charts.byType')}</h3>
            {byType.length === 0 ? (
              <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={byType} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {byType.map(entry => (
                      <Cell key={entry.name} fill={colorForType(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="chart-card chart-top-chats">
            <h3>{t('dashboard.charts.topChats')}</h3>
            {topChats.length === 0 ? (
              <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(260, topChats.length * 36 + 40)}>
                <BarChart
                  data={topChats}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
                  <YAxis
                    type="category"
                    dataKey="id"
                    width={118}
                    interval={0}
                    tick={<TopChatYTick labels={topChatLabelMap} />}
                  />
                  <Tooltip
                    formatter={(value) => [value ?? 0, t('dashboard.charts.messages')]}
                    labelFormatter={(id) => topChatFullMap.get(String(id ?? '')) ?? String(id ?? '')}
                    contentStyle={{
                      background: 'var(--bg-white)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name={t('dashboard.charts.messages')}
                    fill="#0cadf3"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

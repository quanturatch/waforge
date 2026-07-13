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
import { BarChart3, Inbox } from 'lucide-react';
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
  id: string;
  shortLabel: string;
  fullLabel: string;
  count: number;
};

function TopChatYTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  labels: Map<string, string>;
}) {
  const { x = 0, y = 0, payload, labels } = props;
  const id = payload?.value ?? '';
  const text = labels.get(id) ?? id;
  const display = text.length > 16 ? `${text.slice(0, 14)}…` : text;
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
      {display}
    </text>
  );
}

/** Shared tooltip skin that follows app theme tokens (light + dark). */
function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  const title = labelFormatter ? labelFormatter(label ?? '') : String(label ?? '');
  return (
    <div className="chart-tooltip">
      {title ? <div className="chart-tooltip-label">{title}</div> : null}
      <ul className="chart-tooltip-list">
        {payload.map((row, i) => (
          <li key={`${row.name}-${i}`}>
            <span className="chart-tooltip-swatch" style={{ background: row.color }} />
            <span className="chart-tooltip-name">{row.name}</span>
            <span className="chart-tooltip-value">
              {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
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

  const typeTotal = useMemo(() => byType.reduce((sum, row) => sum + row.value, 0), [byType]);

  if (isError && forbidden) return null;

  const hasData = timeSeries.length > 0 || byType.length > 0 || topChats.length > 0;

  return (
    <section className="dashboard-charts">
      <div className="charts-header">
        <div className="charts-title">
          <span className="charts-title-icon" aria-hidden>
            <BarChart3 size={18} />
          </span>
          <div>
            <h2>{t('dashboard.charts.title')}</h2>
            <p className="charts-subtitle">
              {t('dashboard.charts.subtitle', {
                defaultValue: 'Traffic volume and mix for the selected period',
              })}
            </p>
          </div>
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
        <div className="charts-empty charts-loading">{t('common.loading', { defaultValue: 'Loading…' })}</div>
      ) : isError ? (
        <div className="charts-empty charts-error">{t('dashboard.charts.error')}</div>
      ) : !hasData ? (
        <div className="charts-empty charts-empty-state">
          <Inbox size={32} strokeWidth={1.5} />
          <p className="charts-empty-title">{t('dashboard.charts.empty')}</p>
          <p className="charts-empty-hint">
            {t('dashboard.charts.emptyHint', {
              defaultValue: 'Connect a session and exchange a few messages to populate these charts.',
            })}
          </p>
        </div>
      ) : (
        <div className="charts-grid">
          <div className="chart-card chart-wide">
            <div className="chart-card-head">
              <h3>{t('dashboard.charts.overTime')}</h3>
              <span className="chart-card-meta">
                {t('dashboard.charts.overTimeMeta', { defaultValue: 'Sent vs received' })}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={timeSeries} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0cadf3" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0cadf3" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gReceived" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#046c9a" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#046c9a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  name={t('dashboard.charts.sent')}
                  stroke="#0cadf3"
                  fill="url(#gSent)"
                  strokeWidth={2.25}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="received"
                  name={t('dashboard.charts.received')}
                  stroke="#046c9a"
                  fill="url(#gReceived)"
                  strokeWidth={2.25}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <div className="chart-card-head">
              <h3>{t('dashboard.charts.byType')}</h3>
              <span className="chart-card-meta">
                {typeTotal > 0
                  ? t('dashboard.charts.byTypeMeta', {
                      defaultValue: '{{count}} total',
                      count: typeTotal.toLocaleString(),
                    })
                  : null}
              </span>
            </div>
            {byType.length === 0 ? (
              <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
            ) : (
              <div className="pie-wrap">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={byType}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={2.5}
                      stroke="var(--bg-white)"
                      strokeWidth={2}
                    >
                      {byType.map(entry => (
                        <Cell key={entry.name} fill={colorForType(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-center" aria-hidden>
                  <span className="pie-center-value">{typeTotal.toLocaleString()}</span>
                  <span className="pie-center-label">{t('dashboard.charts.messages')}</span>
                </div>
                <ul className="pie-legend">
                  {byType.slice(0, 6).map(entry => (
                    <li key={entry.name}>
                      <span className="pie-legend-swatch" style={{ background: colorForType(entry.name) }} />
                      <span className="pie-legend-name">{entry.name}</span>
                      <span className="pie-legend-value">{entry.value.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="chart-card chart-top-chats">
            <div className="chart-card-head">
              <h3>{t('dashboard.charts.topChats')}</h3>
              <span className="chart-card-meta">
                {t('dashboard.charts.topChatsMeta', { defaultValue: 'Most active' })}
              </span>
            </div>
            {topChats.length === 0 ? (
              <div className="charts-empty small">{t('dashboard.charts.empty')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(260, topChats.length * 34 + 48)}>
                <BarChart
                  data={topChats}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  barCategoryGap="22%"
                >
                  <defs>
                    <linearGradient id="gBar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#0cadf3" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#56c3e1" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="id"
                    width={112}
                    interval={0}
                    tick={<TopChatYTick labels={topChatLabelMap} />}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={props => (
                      <ChartTooltip
                        active={props.active}
                        payload={
                          props.payload as unknown as ReadonlyArray<{
                            name?: string;
                            value?: number | string;
                            color?: string;
                          }>
                        }
                        label={props.label as string | number}
                        labelFormatter={id => topChatFullMap.get(String(id ?? '')) ?? String(id ?? '')}
                      />
                    )}
                  />
                  <Bar
                    dataKey="count"
                    name={t('dashboard.charts.messages')}
                    fill="url(#gBar)"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={18}
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

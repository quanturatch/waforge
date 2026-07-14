import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Webhook,
  Activity,
  Loader2,
  X,
  Smartphone,
  MessagesSquare,
  Link2,
  Plus,
  ArrowRight,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  queryKeys,
  useSessionsQuery,
  useSessionStatsQuery,
  useWebhooksQuery,
  useStopSessionMutation,
  useStatsOverviewQuery,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './Dashboard.css';

// recharts is heavy (~150kB gzip); load the analytics section on demand so it never bloats the
// main/login bundle and only ships when the dashboard actually renders.
const DashboardCharts = lazy(() => import('../components/DashboardCharts').then(m => ({ default: m.DashboardCharts })));

const AUTO_REFRESH_MS = 2 * 60 * 1000;
const AUTO_REFRESH_STORAGE_KEY = 'waforge_dashboard_auto_refresh';

function readAutoRefreshPref(): boolean {
  try {
    return localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: sessions = [],
    isLoading: loadingSessions,
    error: sessionsError,
    dataUpdatedAt: sessionsUpdatedAt,
  } = useSessionsQuery();
  const { data: stats, dataUpdatedAt: statsUpdatedAt } = useSessionStatsQuery();
  const { data: webhooks = [], dataUpdatedAt: webhooksUpdatedAt } = useWebhooksQuery();
  // /stats/overview is ADMIN-only; for a non-admin key it 403s → overview stays undefined and the
  // message cards fall back to '—' without breaking the (un-gated) session cards.
  const { data: overview, dataUpdatedAt: overviewUpdatedAt } = useStatsOverviewQuery();
  const stopMutation = useStopSessionMutation();
  const [disconnectConfirm, setDisconnectConfirm] = useState<{ id: string; name: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(readAutoRefreshPref);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refreshDashboard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionStats });
    void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
    void queryClient.invalidateQueries({ queryKey: queryKeys.statsOverview });
    // Prefix match: all periods for message analytics charts
    void queryClient.invalidateQueries({ queryKey: ['stats', 'messages'] });
  }, [queryClient]);

  // Persist preference
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, autoRefresh ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [autoRefresh]);

  // Poll every 2 minutes when enabled; pause while disconnect modal is open
  useEffect(() => {
    if (!autoRefresh || disconnectConfirm) return;
    const id = window.setInterval(() => {
      refreshDashboard();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, disconnectConfirm, refreshDashboard]);

  // Soft clock for "Updated Xm ago" label (every 15s)
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  const lastUpdatedAt = useMemo(
    () => Math.max(sessionsUpdatedAt || 0, statsUpdatedAt || 0, webhooksUpdatedAt || 0, overviewUpdatedAt || 0),
    [sessionsUpdatedAt, statsUpdatedAt, webhooksUpdatedAt, overviewUpdatedAt],
  );

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return t('dashboard.autoRefresh.waiting', { defaultValue: 'Waiting for data…' });
    const secs = Math.max(0, Math.floor((nowTick - lastUpdatedAt) / 1000));
    if (secs < 15) return t('dashboard.autoRefresh.justNow', { defaultValue: 'Updated just now' });
    if (secs < 60) return t('dashboard.autoRefresh.secsAgo', { defaultValue: 'Updated {{n}}s ago', n: secs });
    const mins = Math.floor(secs / 60);
    return t('dashboard.autoRefresh.minsAgo', { defaultValue: 'Updated {{n}}m ago', n: mins });
  }, [lastUpdatedAt, nowTick, t]);

  const toggleAutoRefresh = () => {
    setAutoRefresh(prev => {
      const next = !prev;
      if (next) {
        // Immediate refresh when turning on so the board is current
        refreshDashboard();
        setNowTick(Date.now());
      }
      return next;
    });
  };
  const messagesToday = overview ? overview.messages.today.sent + overview.messages.today.received : null;
  const totalMessages = overview ? overview.messages.sent + overview.messages.received : null;
  const loading = loadingSessions;
  const error =
    sessionsError instanceof Error
      ? sessionsError.message
      : sessionsError
        ? t('dashboard.loadError')
        : null;
  const webhookCount = webhooks.length;
  const connectedCount = stats?.ready ?? 0;
  const totalSessions = stats?.total ?? sessions.length;

  const handleDisconnect = async (id: string) => {
    try {
      await stopMutation.mutateAsync(id);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnectConfirm(null);
    }
  };

  const statsCards = [
    {
      key: 'sessions',
      label: t('dashboard.stats.activeSessions'),
      value: connectedCount,
      hint: t('dashboard.stats.connectedHint', {
        defaultValue: '{{count}} of {{total}} online',
        count: connectedCount,
        total: totalSessions,
      }),
      icon: Radio,
      tone: 'primary' as const,
    },
    {
      key: 'today',
      label: t('dashboard.stats.messagesToday'),
      value: messagesToday,
      hint: t('dashboard.stats.todayHint', { defaultValue: 'Sent + received today' }),
      icon: Send,
      tone: 'success' as const,
    },
    {
      key: 'webhooks',
      label: t('dashboard.stats.webhooksConfigured'),
      value: webhookCount,
      hint: t('dashboard.stats.webhooksHint', { defaultValue: 'Event destinations' }),
      icon: Webhook,
      tone: 'info' as const,
    },
    {
      key: 'total',
      label: t('dashboard.stats.totalMessages'),
      value: totalMessages,
      hint: t('dashboard.stats.totalHint', { defaultValue: 'All-time traffic' }),
      icon: Activity,
      tone: 'accent' as const,
    },
  ];

  const quickLinks = [
    {
      to: '/sessions',
      title: t('dashboard.quick.sessionsTitle', { defaultValue: 'Sessions' }),
      desc: t('dashboard.quick.sessionsDesc', { defaultValue: 'Connect or manage WhatsApp accounts' }),
      icon: Smartphone,
      cta: t('dashboard.quick.sessionsCta', { defaultValue: 'Manage' }),
    },
    {
      to: '/chats',
      title: t('dashboard.quick.chatsTitle', { defaultValue: 'Chats' }),
      desc: t('dashboard.quick.chatsDesc', { defaultValue: 'Read and reply to conversations' }),
      icon: MessagesSquare,
      cta: t('dashboard.quick.chatsCta', { defaultValue: 'Open' }),
    },
    {
      to: '/webhooks',
      title: t('dashboard.quick.webhooksTitle', { defaultValue: 'Webhooks' }),
      desc: t('dashboard.quick.webhooksDesc', { defaultValue: 'Push events to your backend' }),
      icon: Link2,
      cta: t('dashboard.quick.webhooksCta', { defaultValue: 'Configure' }),
    },
  ];

  const formatLastActive = (date?: string) => {
    if (!date) return t('common.never');
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return t('common.justNow');
    if (diff < 3600000) return t('common.minAgo', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('common.hoursAgo', { count: Math.floor(diff / 3600000) });
    return new Date(date).toLocaleDateString();
  };

  const formatStatus = (status: string) => t(`sessionStatus.${status}`, { defaultValue: status });

  const formatStatValue = (value: number | null) => {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString();
  };

  if (loading) {
    return (
      <div className="dashboard dashboard-loading">
        <Loader2 className="animate-spin" size={32} />
        <p>{t('common.loading', { defaultValue: 'Loading…' })}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="dashboard-error" role="alert">
          {t('dashboard.errorPrefix', { message: error })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={
          <span className={`status-badge ${connectedCount > 0 ? 'connected' : 'disconnected'}`}>
            {connectedCount > 0
              ? t('dashboard.badge.online', {
                  defaultValue: '{{count}} online',
                  count: connectedCount,
                })
              : t('common.disconnected', { defaultValue: 'Disconnected' })}
          </span>
        }
        actions={
          <div className="auto-refresh">
            <span className="auto-refresh-meta" title={lastUpdatedLabel}>
              {autoRefresh ? lastUpdatedLabel : t('dashboard.autoRefresh.offHint', { defaultValue: 'Manual refresh only' })}
            </span>
            <button
              type="button"
              className={`auto-refresh-toggle ${autoRefresh ? 'on' : 'off'}`}
              role="switch"
              aria-checked={autoRefresh}
              aria-label={t('dashboard.autoRefresh.aria', {
                defaultValue: 'Auto-refresh dashboard every 2 minutes',
              })}
              onClick={toggleAutoRefresh}
            >
              <RefreshCw size={14} className={autoRefresh ? 'spin-slow' : undefined} aria-hidden />
              <span className="auto-refresh-label">
                {t('dashboard.autoRefresh.label', { defaultValue: 'Auto-refresh' })}
              </span>
              <span className="auto-refresh-interval">2 min</span>
              <span className="auto-refresh-switch" aria-hidden>
                <span className="auto-refresh-knob" />
              </span>
            </button>
          </div>
        }
      />

      {/* KPI cards — one glance health */}
      <div className="stats-grid">
        {statsCards.map(({ key, label, value, hint, icon: Icon, tone }) => (
          <div key={key} className={`stat-card tone-${tone}`}>
            <div className="stat-header">
              <span className="stat-label">{label}</span>
              <span className={`stat-icon-wrap tone-${tone}`} aria-hidden>
                <Icon size={18} />
              </span>
            </div>
            <div className="stat-value">{formatStatValue(value)}</div>
            <div className="stat-hint">{hint}</div>
          </div>
        ))}
      </div>

      {/* Quick navigation — makes the home page actionable */}
      <section className="quick-section" aria-label={t('dashboard.quick.title', { defaultValue: 'Quick actions' })}>
        <div className="section-header">
          <h2>{t('dashboard.quick.title', { defaultValue: 'Quick actions' })}</h2>
          <span className="section-subtitle">
            {t('dashboard.quick.subtitle', { defaultValue: 'Jump to common tasks' })}
          </span>
        </div>
        <div className="quick-grid">
          {quickLinks.map(({ to, title, desc, icon: Icon, cta }) => (
            <button key={to} type="button" className="quick-card" onClick={() => navigate(to)}>
              <span className="quick-icon" aria-hidden>
                <Icon size={22} />
              </span>
              <span className="quick-body">
                <span className="quick-title">{title}</span>
                <span className="quick-desc">{desc}</span>
              </span>
              <span className="quick-cta">
                {cta}
                <ArrowRight size={14} />
              </span>
            </button>
          ))}
        </div>
      </section>

      <Suspense
        fallback={
          <div className="charts-suspense">
            <Loader2 className="animate-spin" size={22} />
          </div>
        }
      >
        <DashboardCharts />
      </Suspense>

      <section className="sessions-section">
        <div className="section-header">
          <div className="section-heading">
            <h2>{t('dashboard.sessionsOverview')}</h2>
            <span className="section-subtitle">
              {t('dashboard.showingSessions', { shown: sessions.length, total: totalSessions })}
            </span>
          </div>
          <button type="button" className="btn-section" onClick={() => navigate('/sessions')}>
            <Plus size={16} />
            {t('dashboard.manageSessions', { defaultValue: 'All sessions' })}
          </button>
        </div>

        <div className="sessions-table">
          <div className="table-header" role="row">
            <span>{t('dashboard.columns.session', { defaultValue: 'Session' })}</span>
            <span>{t('dashboard.columns.phone')}</span>
            <span>{t('dashboard.columns.status')}</span>
            <span>{t('dashboard.columns.lastActive')}</span>
            <span>{t('dashboard.columns.actions')}</span>
          </div>
          {sessions.length === 0 ? (
            <div className="sessions-empty">
              <MessageSquare size={36} strokeWidth={1.5} />
              <p>{t('dashboard.noSessions')}</p>
              <button type="button" className="btn-primary-sm" onClick={() => navigate('/sessions')}>
                <Plus size={16} />
                {t('dashboard.createSession', { defaultValue: 'Create session' })}
              </button>
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="table-row" role="row">
                <div className="session-info-cell">
                  <span className="session-name" title={session.name}>
                    {session.name}
                  </span>
                  <span className="session-id" title={session.id}>
                    {session.id.substring(0, 8)}…
                  </span>
                </div>
                <span className="phone">{session.phone || '—'}</span>
                <span className={`status-pill ${session.status}`}>{formatStatus(session.status)}</span>
                <span className="last-active">{formatLastActive(session.lastActive)}</span>
                <div className="actions">
                  <button type="button" className="btn-sm" onClick={() => navigate('/sessions')}>
                    {t('dashboard.view')}
                  </button>
                  {['ready', 'initializing', 'connecting', 'qr_ready', 'authenticating'].includes(session.status) && (
                    <button
                      type="button"
                      className="btn-sm danger"
                      onClick={() => setDisconnectConfirm({ id: session.id, name: session.name })}
                    >
                      {t('dashboard.disconnect')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {disconnectConfirm && (
        <div className="modal-overlay" onClick={() => setDisconnectConfirm(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('dashboard.disconnectConfirmTitle')}</h2>
              <button className="btn-icon" onClick={() => setDisconnectConfirm(null)} aria-label={t('common.close')}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="dashboard.disconnectConfirmMessage"
                  values={{ name: disconnectConfirm.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setDisconnectConfirm(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={stopMutation.isPending}
                onClick={() => handleDisconnect(disconnectConfirm.id)}
              >
                {stopMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
                {t('dashboard.disconnectConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

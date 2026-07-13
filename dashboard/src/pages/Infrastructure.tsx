import { useState, useEffect, useRef, useCallback, type DragEvent, type CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Database,
  Server,
  HardDrive,
  Save,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Download,
  Upload,
  Bot,
  Sparkles,
  Copy,
  Shield,
  GripVertical,
  RotateCcw,
} from 'lucide-react';
import { infraApi, API_BASE_URL, aiApi, moderationApi } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import { getApiKey } from '../utils/storage-keys';
import { getMcpUrl } from '../utils/publicUrl';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useInfraStatusQuery, useInfraConfigQuery } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import './Infrastructure.css';

/** End-user cards on Infrastructure (engine picker is advanced/ops — not shown). */
const INFRA_SECTION_IDS = ['database', 'mcp', 'ai', 'groupCleanup', 'redis', 'storage'] as const;
type InfraSectionId = (typeof INFRA_SECTION_IDS)[number];
const INFRA_ORDER_KEY = 'waforge_infra_section_order';

function loadSectionOrder(): InfraSectionId[] {
  try {
    const raw = localStorage.getItem(INFRA_ORDER_KEY);
    if (!raw) return [...INFRA_SECTION_IDS];
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [...INFRA_SECTION_IDS];
    const valid = parsed.filter((id): id is InfraSectionId =>
      (INFRA_SECTION_IDS as readonly string[]).includes(id),
    );
    for (const id of INFRA_SECTION_IDS) {
      if (!valid.includes(id)) valid.push(id);
    }
    return valid;
  } catch {
    return [...INFRA_SECTION_IDS];
  }
}

import sqliteIcon from '../assets/icons/sqlite.svg';
import postgresIcon from '../assets/icons/postgresql.svg';
import folderIcon from '../assets/icons/folder.svg';
import s3Icon from '../assets/icons/s3.svg';

interface DatabaseConfig {
  type: 'sqlite' | 'postgres';
  builtIn: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  poolSize: number;
  sslEnabled: boolean;
  sslRejectUnauthorized: boolean;
}

interface RedisConfig {
  builtIn: boolean;
  host: string;
  port: string;
  password: string;
  connected: boolean;
}

interface StorageConfig {
  type: 'local' | 's3';
  builtIn: boolean;
  localPath: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint: string;
}

interface EngineConfig {
  type: string;
  headless: boolean;
  sessionDataPath: string;
  browserArgs: string;
}

interface McpConfig {
  enabled: boolean;
  readonly: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

interface AiConfig {
  autoReplyEnabled: boolean;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  mode: 'auto' | 'draft';
  replyToGroups: boolean;
  maxTokens: number;
  temperature: number;
  apiKeySet: boolean;
}

interface GroupCleanupConfig {
  enabled: boolean;
  keywords: string;
  sessions: string;
  forEveryone: boolean;
  dryRun: boolean;
  requireAdmin: boolean;
  delayMs: number;
}

interface QueueStats {
  pending: number;
  completed: number;
  failed: number;
}

export function Infrastructure() {
  const { t } = useTranslation();
  useDocumentTitle(t('infrastructure.title'));
  const toast = useToast();
  const { data: infraStatus, isLoading: loading, isError: statusError } = useInfraStatusQuery();
  const { data: savedConfig } = useInfraConfigQuery();
  const [saving, setSaving] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<InfraSectionId[]>(loadSectionOrder);
  const [dragSectionId, setDragSectionId] = useState<InfraSectionId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<InfraSectionId | null>(null);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restartCountdown, setRestartCountdown] = useState(0);
  const [restartStatus, setRestartStatus] = useState<'idle' | 'restarting' | 'waiting' | 'success' | 'error'>('idle');

  const [dbConfig, setDbConfig] = useState<DatabaseConfig>({
    type: 'sqlite',
    builtIn: false,
    host: 'localhost',
    port: '5432',
    username: 'postgres',
    password: '',
    database: 'WaForge',
    schema: 'public',
    poolSize: 10,
    sslEnabled: false,
    sslRejectUnauthorized: true,
  });

  const [redisConfig, setRedisConfig] = useState<RedisConfig>({
    builtIn: false,
    host: 'localhost',
    port: '6379',
    password: '',
    connected: false,
  });

  const [storageConfig, setStorageConfig] = useState<StorageConfig>({
    type: 'local',
    builtIn: false,
    localPath: './data/media',
    s3Bucket: '',
    s3Region: 'ap-southeast-1',
    s3AccessKey: '',
    s3SecretKey: '',
    s3Endpoint: '',
  });

  const [queueStats, setQueueStats] = useState({
    webhooks: { pending: 0, completed: 0, failed: 0 } as QueueStats,
  });

  const [engineConfig, setEngineConfig] = useState<EngineConfig>({
    type: 'whatsapp-web.js',
    headless: true,
    sessionDataPath: './data/sessions',
    browserArgs: '--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu',
  });

  const [mcpConfig, setMcpConfig] = useState<McpConfig>({
    enabled: false,
    readonly: true,
    rateLimitMax: 60,
    rateLimitWindowMs: 60000,
  });

  const [aiConfig, setAiConfig] = useState<AiConfig>({
    autoReplyEnabled: false,
    provider: 'openai',
    apiKey: '',
    model: '',
    baseUrl: '',
    systemPrompt: '',
    mode: 'auto',
    replyToGroups: false,
    maxTokens: 512,
    temperature: 0.7,
    apiKeySet: false,
  });
  const [aiTestText, setAiTestText] = useState('Hello, what can you help me with?');
  const [aiTestResult, setAiTestResult] = useState('');
  const [aiTesting, setAiTesting] = useState(false);

  const [groupCleanup, setGroupCleanup] = useState<GroupCleanupConfig>({
    enabled: false,
    keywords: 'happy birthday,hbd,birthady',
    sessions: '',
    forEveryone: true,
    dryRun: false,
    requireAdmin: true,
    delayMs: 800,
  });
  const [cleanupTestText, setCleanupTestText] = useState('Happy Birthday!!!');
  const [cleanupTestResult, setCleanupTestResult] = useState('');
  const [cleanupTesting, setCleanupTesting] = useState(false);

  const [redisEnabled, setRedisEnabled] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState(false);
  const [pendingProfiles, setPendingProfiles] = useState<string[]>([]);
  const [previousProfiles, setPreviousProfiles] = useState<string[]>([]);
  // Set when the just-saved config changes the DB or storage backend vs what's running, so the restart
  // modal can warn that the new backend starts empty and offer a data backup before switching (#488).
  const [dbSwitch, setDbSwitch] = useState(false);
  const [storageSwitch, setStorageSwitch] = useState(false);
  const [migrating, setMigrating] = useState(false);
  // After a successful save (before the restart reloads the page), /config holds the new value but
  // /status still holds the old one — so suppress the "pinned by environment" note, which infers a pin
  // from exactly that divergence and would otherwise mislabel a pending change.
  const [savePending, setSavePending] = useState(false);

  // Whether the editable form has been seeded from the server once. After that, a background refetch
  // (react-query refetchOnWindowFocus) must NOT re-seed the editable fields or it would wipe the
  // operator's in-progress, unsaved edits. A successful save restarts → full page reload, re-arming it.
  const formHydrated = useRef(false);

  // LIVE indicators (not editable) — always reflect the running process, every refetch.
  useEffect(() => {
    if (!infraStatus) return;
    setRedisConfig(prev => ({ ...prev, connected: infraStatus.redis.connected }));
    setQueueStats({ webhooks: infraStatus.queue.webhooks });
  }, [infraStatus]);

  // Seed the EDITABLE selections from live /status ONCE (the running selection), guarded so a refetch
  // can't clobber an unsaved edit. These are also the badge sources, so on first paint they show what's
  // actually running (#488 family).
  useEffect(() => {
    if (!infraStatus || formHydrated.current) return;
    setDbConfig(prev => ({
      ...prev,
      type: (infraStatus.database.type as 'sqlite' | 'postgres') || 'sqlite',
      host: infraStatus.database.host || 'localhost',
      // builtIn reflects whether WaForge's bundled container is actually running (live), not saved intent.
      builtIn: infraStatus.database.builtIn,
    }));
    setRedisConfig(prev => ({
      ...prev,
      host: infraStatus.redis.host,
      port: String(infraStatus.redis.port),
      builtIn: infraStatus.redis.builtIn,
    }));
    setRedisEnabled(infraStatus.redis.enabled);
    setStorageConfig(prev => ({
      ...prev,
      type: infraStatus.storage.type,
      localPath: infraStatus.storage.path || './uploads',
      builtIn: infraStatus.storage.builtIn,
    }));
    setQueueEnabled(infraStatus.queue.enabled);
  }, [infraStatus]);

  // Hydrate the editable form from the saved config (data/.env.generated) ONCE — only the detail fields
  // /status does not expose (username, pool size, SSL flags, S3 details, host/port). The "what's
  // running" fields (type, redis enabled, storage type, built-in) are owned by the live /status effect
  // above. Secrets are never returned, so their inputs stay empty; an empty submit preserves the stored
  // secret on the backend (#226).
  useEffect(() => {
    if (!savedConfig || formHydrated.current) return;
    // NOTE: builtIn for db/redis/storage is owned by the live /status effect above (it reflects the
    // actually-running bundled container), so it is intentionally NOT set here from saved intent.
    setDbConfig(prev => ({
      ...prev,
      host: savedConfig.database.host || prev.host,
      port: savedConfig.database.port || prev.port,
      username: savedConfig.database.username || prev.username,
      database: savedConfig.database.database || prev.database,
      schema: savedConfig.database.schema || prev.schema,
      poolSize: savedConfig.database.poolSize,
      sslEnabled: savedConfig.database.sslEnabled,
      sslRejectUnauthorized: savedConfig.database.sslRejectUnauthorized,
    }));
    setRedisConfig(prev => ({
      ...prev,
      host: savedConfig.redis.host || prev.host,
      port: savedConfig.redis.port || prev.port,
    }));
    setStorageConfig(prev => ({
      ...prev,
      localPath: savedConfig.storage.localPath || prev.localPath,
      s3Bucket: savedConfig.storage.s3Bucket || prev.s3Bucket,
      s3Region: savedConfig.storage.s3Region || prev.s3Region,
      s3Endpoint: savedConfig.storage.s3Endpoint || prev.s3Endpoint,
    }));
    setEngineConfig(prev => ({
      ...prev,
      headless: savedConfig.engine.headless,
      sessionDataPath: savedConfig.engine.sessionDataPath || prev.sessionDataPath,
      browserArgs: savedConfig.engine.browserArgs || prev.browserArgs,
    }));
    if (savedConfig.mcp) {
      setMcpConfig({
        enabled: savedConfig.mcp.enabled,
        readonly: savedConfig.mcp.readonly,
        rateLimitMax: savedConfig.mcp.rateLimitMax,
        rateLimitWindowMs: savedConfig.mcp.rateLimitWindowMs,
      });
    }
    if (savedConfig.ai) {
      setAiConfig(prev => ({
        ...prev,
        autoReplyEnabled: savedConfig.ai!.autoReplyEnabled,
        provider: savedConfig.ai!.provider || prev.provider,
        model: savedConfig.ai!.model || prev.model,
        baseUrl: savedConfig.ai!.baseUrl || prev.baseUrl,
        systemPrompt: savedConfig.ai!.systemPrompt || prev.systemPrompt,
        mode: savedConfig.ai!.mode || prev.mode,
        replyToGroups: savedConfig.ai!.replyToGroups,
        maxTokens: savedConfig.ai!.maxTokens || prev.maxTokens,
        temperature: savedConfig.ai!.temperature ?? prev.temperature,
        apiKeySet: savedConfig.ai!.apiKeySet,
        apiKey: '',
      }));
    }
    if (savedConfig.groupCleanup) {
      setGroupCleanup({
        enabled: savedConfig.groupCleanup.enabled,
        keywords: savedConfig.groupCleanup.keywords || '',
        sessions: savedConfig.groupCleanup.sessions || '',
        forEveryone: savedConfig.groupCleanup.forEveryone,
        dryRun: savedConfig.groupCleanup.dryRun,
        requireAdmin: savedConfig.groupCleanup.requireAdmin,
        delayMs: savedConfig.groupCleanup.delayMs || 800,
      });
    }
  }, [savedConfig]);

  // Lock the editable form once both sources have seeded it, so later background refetches only refresh
  // the live indicators above and never overwrite unsaved edits.
  useEffect(() => {
    if (infraStatus && savedConfig) formHydrated.current = true;
  }, [infraStatus, savedConfig]);

  const persistSectionOrder = useCallback((next: InfraSectionId[]) => {
    setSectionOrder(next);
    localStorage.setItem(INFRA_ORDER_KEY, JSON.stringify(next));
  }, []);

  const resetSectionOrder = () => {
    localStorage.removeItem(INFRA_ORDER_KEY);
    setSectionOrder([...INFRA_SECTION_IDS]);
    toast.success(t('infrastructure.layout.resetOk'));
  };

  const sectionStyle = (id: InfraSectionId): CSSProperties => ({
    order: Math.max(0, sectionOrder.indexOf(id)),
  });

  const onSectionDragStart = (id: InfraSectionId) => (e: DragEvent) => {
    setDragSectionId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const onSectionDragOver = (id: InfraSectionId) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== id) setDropTargetId(id);
  };

  const onSectionDrop = (id: InfraSectionId) => (e: DragEvent) => {
    e.preventDefault();
    const fromId = (dragSectionId || e.dataTransfer.getData('text/plain')) as InfraSectionId;
    setDropTargetId(null);
    setDragSectionId(null);
    if (!fromId || fromId === id) return;
    if (!(INFRA_SECTION_IDS as readonly string[]).includes(fromId)) return;
    const next = [...sectionOrder];
    const from = next.indexOf(fromId);
    const to = next.indexOf(id);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    persistSectionOrder(next);
  };

  const onSectionDragEnd = () => {
    setDragSectionId(null);
    setDropTargetId(null);
  };

  const sectionClass = (id: InfraSectionId, extra = '') =>
    [
      'infra-card',
      extra,
      dragSectionId === id ? 'is-dragging' : '',
      dropTargetId === id && dragSectionId && dragSectionId !== id ? 'is-drop-target' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const DragHandle = ({ id }: { id: InfraSectionId }) => (
    <button
      type="button"
      className="section-drag-handle"
      draggable
      title={t('infrastructure.layout.dragHint')}
      aria-label={t('infrastructure.layout.dragHint')}
      onDragStart={onSectionDragStart(id)}
      onDragEnd={onSectionDragEnd}
    >
      <GripVertical size={16} />
    </button>
  );

  if (loading) {
    return (
      <div
        className="infrastructure-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  // If the live infrastructure status can't be loaded, do NOT render the editable form: it would seed
  // from component defaults (sqlite/local/built-in:false) and a Save could flip a running backend to
  // external+empty. Show an error + retry instead. (#488 review)
  if (statusError || !infraStatus) {
    return (
      <div className="infrastructure-page">
        <PageHeader title={t('infrastructure.title')} subtitle={t('infrastructure.subtitle')} />
        <div className="infra-card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <AlertTriangle size={32} style={{ color: 'var(--warning, #d97706)', marginBottom: '1rem' }} />
          <p style={{ margin: 0 }}>{t('infrastructure.statusLoadError')}</p>
          <button className="btn-secondary" style={{ marginTop: '1.25rem' }} onClick={() => window.location.reload()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  const updateDbConfig = (key: keyof DatabaseConfig, value: string | number | boolean) =>
    setDbConfig(prev => ({ ...prev, [key]: value }));
  const updateRedisConfig = (key: keyof RedisConfig, value: string | boolean) =>
    setRedisConfig(prev => ({ ...prev, [key]: value }));
  const updateStorageConfig = (key: keyof StorageConfig, value: string | boolean) =>
    setStorageConfig(prev => ({ ...prev, [key]: value }));
  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const payload = {
        database: { ...dbConfig },
        redis: { enabled: redisEnabled, ...redisConfig },
        queue: { enabled: queueEnabled },
        storage: { ...storageConfig },
        engine: { ...engineConfig },
        mcp: { ...mcpConfig },
        ai: {
          autoReplyEnabled: aiConfig.autoReplyEnabled,
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey || undefined,
          model: aiConfig.model,
          baseUrl: aiConfig.baseUrl,
          systemPrompt: aiConfig.systemPrompt,
          mode: aiConfig.mode,
          replyToGroups: aiConfig.replyToGroups,
          maxTokens: aiConfig.maxTokens,
          temperature: aiConfig.temperature,
        },
        groupCleanup: { ...groupCleanup },
      };

      const result = await infraApi.saveConfig(payload);
      if (result.saved) {
        setSavePending(true);
        setPreviousProfiles(pendingProfiles);
        setPendingProfiles(result.profiles || []);
        // Flag a backend switch vs what's actually running so the restart modal can warn about the
        // empty-database / orphaned-media data move before it happens. A switch is: changing type;
        // flipping built-in↔external (different physical backend); OR retargeting an external Postgres
        // to a different host/port/database (also a different, empty DB). Host/port/db aren't all in
        // /status, so compare the edited form against the still-cached saved config.
        const dbExternalRetarget =
          dbConfig.type === 'postgres' &&
          !dbConfig.builtIn &&
          !!savedConfig &&
          (dbConfig.host !== savedConfig.database.host ||
            dbConfig.port !== savedConfig.database.port ||
            dbConfig.database !== savedConfig.database.database);
        setDbSwitch(
          !!infraStatus &&
            (dbConfig.type !== infraStatus.database.type ||
              (dbConfig.type === 'postgres' && dbConfig.builtIn !== infraStatus.database.builtIn) ||
              dbExternalRetarget),
        );
        // Scope: this warns on a backend-TYPE change (local↔s3) and a built-in↔external flip — the cases
        // that point at a different store. It does NOT warn on same-backend repointing (e.g. a new S3
        // bucket/endpoint or a new local path); region/endpoint aren't on /status to compare reliably.
        setStorageSwitch(
          !!infraStatus &&
            (storageConfig.type !== infraStatus.storage.type ||
              (storageConfig.type === 's3' && storageConfig.builtIn !== infraStatus.storage.builtIn)),
        );
        setShowRestartModal(true);
      } else {
        toast.error(t('infrastructure.toasts.saveFailed'), result.message);
      }
    } catch (err) {
      toast.error(t('infrastructure.toasts.saveFailed'), err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  // Download a JSON backup of all Data-DB tables. Called BEFORE a DB switch (while still on the old
  // database) so the data can be re-imported into the new one — switching otherwise starts empty (#488).
  const handleExportBackup = async () => {
    setMigrating(true);
    try {
      const dump = await infraApi.exportData();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waforge-backup-${dump.exportedAt?.slice(0, 10) || 'data'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(t('infrastructure.migration.exportFailed'), err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setMigrating(false);
    }
  };

  // Restore a previously-exported backup into the CURRENT database (use after switching + restart).
  // Import REPLACES all current data, so validate + confirm (showing the row count) before any call.
  const handleImportBackup = async (file: File) => {
    let parsed: { tables?: Record<string, unknown[]> };
    try {
      parsed = JSON.parse(await file.text()) as { tables?: Record<string, unknown[]> };
    } catch {
      toast.error(t('infrastructure.migration.importFailed'), t('infrastructure.migration.invalidFile'));
      return;
    }
    if (!parsed?.tables || typeof parsed.tables !== 'object') {
      toast.error(t('infrastructure.migration.importFailed'), t('infrastructure.migration.invalidFile'));
      return;
    }
    const rows = Object.values(parsed.tables).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
    if (!window.confirm(t('infrastructure.migration.importConfirm', { rows }))) return;
    setMigrating(true);
    try {
      const res = await infraApi.importData(parsed.tables);
      if (res.imported) toast.success(t('infrastructure.migration.importOk'));
      else toast.error(t('infrastructure.migration.importFailed'), (res.warnings || []).slice(0, 3).join('; ') || res.message);
    } catch (err) {
      // A large backup can exceed the request body cap (default 25mb) — give an actionable message
      // instead of a bare "Payload Too Large". The status is carried on the Error by the api client.
      const status = (err as { status?: number } | null)?.status;
      const detail =
        status === 413
          ? t('infrastructure.migration.importTooLarge')
          : err instanceof Error
            ? err.message
            : t('common.unknownError');
      toast.error(t('infrastructure.migration.importFailed'), detail);
    } finally {
      setMigrating(false);
    }
  };

  const handleRestart = async () => {
    setRestartStatus('restarting');
    setRestartCountdown(30);

    const profilesToRemove = previousProfiles.filter(p => !pendingProfiles.includes(p));

    try {
      const response = await infraApi.restart(pendingProfiles, profilesToRemove);
      if (response.estimatedTime) setRestartCountdown(response.estimatedTime);
    } catch {
      // Expected — server shutting down
    }

    setRestartStatus('waiting');
    let intervalRef: ReturnType<typeof setInterval> | null = null;
    const stopCountdown = () => {
      if (intervalRef) {
        clearInterval(intervalRef);
        intervalRef = null;
      }
    };

    intervalRef = setInterval(() => {
      setRestartCountdown(prev => {
        if (prev <= 1) {
          stopCountdown();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    checkServerHealth(stopCountdown);
  };

  const checkServerHealth = async (stopCountdown?: () => void) => {
    let attempts = 0;
    const maxAttempts = 60;

    const check = async () => {
      try {
        await infraApi.healthCheck();
        stopCountdown?.();
        setRestartCountdown(0);
        setRestartStatus('success');
        setTimeout(() => window.location.reload(), 2000);
      } catch {
        attempts++;
        if (attempts < maxAttempts) setTimeout(check, 1000);
        else setRestartStatus('error');
      }
    };

    setTimeout(check, 3000);
  };

  // A setting whose RUNNING value (/status) differs from the SAVED file (/config) is being pinned by a
  // host/.env environment variable, which wins at runtime — so a dashboard change to it won't apply
  // until that variable is unset. Surface that honestly instead of letting the control look effective.
  const dbPinnedByEnv =
    !savePending && !!infraStatus && !!savedConfig && infraStatus.database.type !== savedConfig.database.type;
  const redisPinnedByEnv =
    !savePending && !!infraStatus && !!savedConfig && infraStatus.redis.enabled !== savedConfig.redis.enabled;
  const storagePinnedByEnv =
    !savePending && !!infraStatus && !!savedConfig && infraStatus.storage.type !== savedConfig.storage.type;
  const envPinNote = (pinned: boolean) =>
    pinned ? (
      <p className="env-pin-note">
        <AlertTriangle size={14} /> {t('infrastructure.envPinNote')}
      </p>
    ) : null;

  return (
    <div className="infrastructure-page">
      <PageHeader title={t('infrastructure.title')} subtitle={t('infrastructure.subtitle')} />

      <div className="layout-toolbar">
        <p className="layout-hint">{t('infrastructure.layout.hint')}</p>
        <button type="button" className="btn-secondary btn-sm" onClick={resetSectionOrder}>
          <RotateCcw size={14} />
          {t('infrastructure.layout.reset')}
        </button>
      </div>

      <div className="infra-sections">
        {/* Database */}
        <section
          className={sectionClass('database')}
          style={sectionStyle('database')}
          onDragOver={onSectionDragOver('database')}
          onDrop={onSectionDrop('database')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="database" />
              <Database size={20} />
              <h2>{t('infrastructure.database.title')}</h2>
            </div>
            <span className={`status-indicator ${dbConfig.type === 'postgres' ? 'connected' : 'sqlite'}`}>
              ● {dbConfig.type === 'postgres' ? 'PostgreSQL' : 'SQLite'}
            </span>
          </div>
          {envPinNote(dbPinnedByEnv)}

          <div className="radio-group">
            <label className={`radio-option ${dbConfig.type === 'sqlite' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="dbType"
                checked={dbConfig.type === 'sqlite'}
                onChange={() => updateDbConfig('type', 'sqlite')}
              />
              <img src={sqliteIcon} alt="" className="watermark-icon" />
              <span>{t('infrastructure.database.sqlite')}</span>
              <small>{t('infrastructure.database.sqliteDesc')}</small>
            </label>
            <label className={`radio-option ${dbConfig.type === 'postgres' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="dbType"
                checked={dbConfig.type === 'postgres'}
                onChange={() => updateDbConfig('type', 'postgres')}
              />
              <img src={postgresIcon} alt="" className="watermark-icon" />
              <span>{t('infrastructure.database.postgres')}</span>
              <small>{t('infrastructure.database.postgresDesc')}</small>
            </label>
          </div>

          {dbConfig.type === 'postgres' && (
            <>
              <div className="toggle-row" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <div className="toggle-info">
                  <span>{t('infrastructure.database.useBuiltIn')}</span>
                  <small>{t('infrastructure.database.builtInDesc')}</small>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={dbConfig.builtIn}
                    onChange={e => updateDbConfig('builtIn', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              {!dbConfig.builtIn && (
                <div className="config-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('common.host')}</label>
                      <input type="text" value={dbConfig.host} onChange={e => updateDbConfig('host', e.target.value)} />
                    </div>
                    <div className="form-group small">
                      <label>{t('common.port')}</label>
                      <input type="text" value={dbConfig.port} onChange={e => updateDbConfig('port', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('common.username')}</label>
                      <input
                        type="text"
                        value={dbConfig.username}
                        onChange={e => updateDbConfig('username', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('common.password')}</label>
                      <input
                        type="password"
                        value={dbConfig.password}
                        onChange={e => updateDbConfig('password', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('infrastructure.database.dbName')}</label>
                      <input
                        type="text"
                        value={dbConfig.database}
                        onChange={e => updateDbConfig('database', e.target.value)}
                      />
                    </div>
                    <div className="form-group small">
                      <label>{t('infrastructure.database.poolSize')}</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={dbConfig.poolSize}
                        onChange={e => updateDbConfig('poolSize', parseInt(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('infrastructure.database.schema')}</label>
                      <input
                        type="text"
                        value={dbConfig.schema}
                        onChange={e => updateDbConfig('schema', e.target.value)}
                        placeholder="public"
                      />
                      <small>{t('infrastructure.database.schemaDesc')}</small>
                    </div>
                  </div>
                  <div className="toggle-row">
                    <div className="toggle-info">
                      <span>{t('infrastructure.database.ssl')}</span>
                      <small>{t('infrastructure.database.sslDesc')}</small>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={dbConfig.sslEnabled}
                        onChange={e => updateDbConfig('sslEnabled', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  {dbConfig.sslEnabled && (
                    <div className="toggle-row">
                      <div className="toggle-info">
                        <span>{t('infrastructure.database.sslRejectUnauthorized')}</span>
                        <small>{t('infrastructure.database.sslRejectUnauthorizedDesc')}</small>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={dbConfig.sslRejectUnauthorized}
                          onChange={e => updateDbConfig('sslRejectUnauthorized', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div
            className="empty-state-card"
            style={{
              padding: '2.5rem',
              textAlign: 'center',
              background: 'var(--bg-light)',
              borderRadius: '12px',
              border: '1px dashed var(--border)',
              marginTop: '1rem',
            }}
          >
            <Database size={32} style={{ color: 'var(--success)', marginBottom: '1rem', opacity: 0.7 }} />
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9375rem', fontWeight: 500 }}>
              {t('infrastructure.database.migrationsTitle')}
            </p>
            <p
              style={{
                margin: '0.75rem 0 0',
                color: 'var(--success)',
                fontSize: '0.875rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
              }}
            >
              <CheckCircle size={16} />
              {t('infrastructure.database.migrationsStatus')}
            </p>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.5 }}>
              {t('infrastructure.database.migrationsHint')}
            </p>
          </div>

          {/* Data backup / restore — used to carry data across a database switch (#488). */}
          <div className="data-migration-row">
            <div>
              <strong>{t('infrastructure.migration.backupTitle')}</strong>
              <small>{t('infrastructure.migration.backupHint')}</small>
            </div>
            <div className="data-migration-actions">
              <button className="btn-secondary btn-sm" onClick={handleExportBackup} disabled={migrating}>
                {migrating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {t('infrastructure.migration.export')}
              </button>
              <label className="btn-secondary btn-sm" style={{ cursor: migrating ? 'default' : 'pointer' }}>
                <Upload size={14} />
                {t('infrastructure.migration.import')}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  disabled={migrating}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportBackup(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </section>

        {/* MCP — one-click agent tools (engine type is auto-managed; not exposed to end users) */}
        <section
          className={sectionClass('mcp')}
          style={sectionStyle('mcp')}
          onDragOver={onSectionDragOver('mcp')}
          onDrop={onSectionDrop('mcp')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="mcp" />
              <Bot size={20} />
              <h2>{t('infrastructure.mcp.title')}</h2>
            </div>
            <span className={`status-indicator ${mcpConfig.enabled ? 'connected' : 'disconnected'}`}>
              ● {mcpConfig.enabled ? t('common.enabled') : t('common.disabled')}
            </span>
          </div>
          <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('infrastructure.mcp.description')}
          </p>
          <div className="toggle-row" style={{ marginBottom: '1rem' }}>
            <div className="toggle-info">
              <span>{t('infrastructure.mcp.enable')}</span>
              <small>{t('infrastructure.mcp.enableDesc')}</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={mcpConfig.enabled}
                onChange={e => setMcpConfig(prev => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          {mcpConfig.enabled && (
            <>
              <div className="toggle-row" style={{ marginBottom: '1rem' }}>
                <div className="toggle-info">
                  <span>{t('infrastructure.mcp.readonly')}</span>
                  <small>{t('infrastructure.mcp.readonlyDesc')}</small>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={mcpConfig.readonly}
                    onChange={e => setMcpConfig(prev => ({ ...prev, readonly: e.target.checked }))}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
              <div className="config-form">
                <div className="form-group">
                  <label>{t('infrastructure.mcp.endpoint')}</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <code style={{ flex: 1, wordBreak: 'break-all' }}>{getMcpUrl()}</code>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        void copyToClipboard(getMcpUrl());
                        toast.success(t('infrastructure.mcp.copied'));
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <small>{t('infrastructure.mcp.endpointHint')}</small>
                </div>
                <div className="form-group">
                  <label>{t('infrastructure.mcp.claudeSnippet')}</label>
                  <textarea
                    readOnly
                    rows={8}
                    value={JSON.stringify(
                      {
                        mcpServers: {
                          waforge: {
                            url: getMcpUrl(),
                            headers: {
                              'X-API-Key': getApiKey() || 'YOUR_API_KEY',
                            },
                          },
                        },
                      },
                      null,
                      2,
                    )}
                    style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}
                  />
                  <small>{t('infrastructure.mcp.claudeHint')}</small>
                </div>
              </div>
            </>
          )}
        </section>

        {/* AI Auto-Reply */}
        <section
          className={sectionClass('ai')}
          style={sectionStyle('ai')}
          onDragOver={onSectionDragOver('ai')}
          onDrop={onSectionDrop('ai')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="ai" />
              <Sparkles size={20} />
              <h2>{t('infrastructure.ai.title')}</h2>
            </div>
            <span className={`status-indicator ${aiConfig.autoReplyEnabled ? 'connected' : 'disconnected'}`}>
              ● {aiConfig.autoReplyEnabled ? t('common.enabled') : t('common.disabled')}
            </span>
          </div>
          <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('infrastructure.ai.description')}
          </p>
          <div className="toggle-row" style={{ marginBottom: '1rem' }}>
            <div className="toggle-info">
              <span>{t('infrastructure.ai.enable')}</span>
              <small>{t('infrastructure.ai.enableDesc')}</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={aiConfig.autoReplyEnabled}
                onChange={e => setAiConfig(prev => ({ ...prev, autoReplyEnabled: e.target.checked }))}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          <div className="config-form">
            <div className="form-row">
              <div className="form-group">
                <label>{t('infrastructure.ai.provider')}</label>
                <select
                  value={aiConfig.provider}
                  onChange={e => setAiConfig(prev => ({ ...prev, provider: e.target.value }))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Claude (Anthropic)</option>
                  <option value="grok">Grok (xAI)</option>
                  <option value="gemini">Gemini (Google)</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('infrastructure.ai.mode')}</label>
                <select
                  value={aiConfig.mode}
                  onChange={e =>
                    setAiConfig(prev => ({ ...prev, mode: e.target.value === 'draft' ? 'draft' : 'auto' }))
                  }
                >
                  <option value="auto">{t('infrastructure.ai.modeAuto')}</option>
                  <option value="draft">{t('infrastructure.ai.modeDraft')}</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>
                {t('infrastructure.ai.apiKey')}
                {aiConfig.apiKeySet ? ` (${t('infrastructure.ai.apiKeySet')})` : ''}
              </label>
              <input
                type="password"
                placeholder={aiConfig.apiKeySet ? '••••••••' : t('infrastructure.ai.apiKeyPlaceholder')}
                value={aiConfig.apiKey}
                onChange={e => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('infrastructure.ai.model')}</label>
                <input
                  type="text"
                  value={aiConfig.model}
                  placeholder="provider default if empty"
                  onChange={e => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>{t('infrastructure.ai.baseUrl')}</label>
                <input
                  type="text"
                  value={aiConfig.baseUrl}
                  placeholder="optional"
                  onChange={e => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label>{t('infrastructure.ai.systemPrompt')}</label>
              <textarea
                rows={4}
                value={aiConfig.systemPrompt}
                onChange={e => setAiConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder={t('infrastructure.ai.systemPromptPlaceholder')}
              />
            </div>
            <div className="toggle-row" style={{ marginBottom: '1rem' }}>
              <div className="toggle-info">
                <span>{t('infrastructure.ai.replyToGroups')}</span>
                <small>{t('infrastructure.ai.replyToGroupsDesc')}</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={aiConfig.replyToGroups}
                  onChange={e => setAiConfig(prev => ({ ...prev, replyToGroups: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="form-group">
              <label>{t('infrastructure.ai.testPrompt')}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={aiTestText}
                  onChange={e => setAiTestText(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={aiTesting}
                  onClick={async () => {
                    setAiTesting(true);
                    setAiTestResult('');
                    try {
                      // Persist key first if entered so live test uses saved env when already enabled;
                      // otherwise test uses current process env only.
                      const res = await aiApi.test(aiTestText);
                      setAiTestResult(res.reply);
                      toast.success(t('infrastructure.ai.testOk'));
                    } catch (err) {
                      toast.error(
                        t('infrastructure.ai.testFailed'),
                        err instanceof Error ? err.message : t('common.unknownError'),
                      );
                    } finally {
                      setAiTesting(false);
                    }
                  }}
                >
                  {aiTesting ? <Loader2 size={16} className="animate-spin" /> : t('infrastructure.ai.test')}
                </button>
              </div>
              {aiTestResult && (
                <pre
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'var(--bg-light)',
                    borderRadius: 'var(--radius)',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.85rem',
                  }}
                >
                  {aiTestResult}
                </pre>
              )}
              <small>{t('infrastructure.ai.testHint')}</small>
            </div>
          </div>
        </section>

        {/* Group keyword auto-cleanup */}
        <section
          className={sectionClass('groupCleanup')}
          style={sectionStyle('groupCleanup')}
          onDragOver={onSectionDragOver('groupCleanup')}
          onDrop={onSectionDrop('groupCleanup')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="groupCleanup" />
              <Shield size={20} />
              <h2>{t('infrastructure.groupCleanup.title')}</h2>
            </div>
            <span className={`status-indicator ${groupCleanup.enabled ? 'connected' : 'disconnected'}`}>
              ● {groupCleanup.enabled ? t('common.enabled') : t('common.disabled')}
            </span>
          </div>
          <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('infrastructure.groupCleanup.description')}
          </p>
          <div className="toggle-row" style={{ marginBottom: '1rem' }}>
            <div className="toggle-info">
              <span>{t('infrastructure.groupCleanup.enable')}</span>
              <small>{t('infrastructure.groupCleanup.enableDesc')}</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={groupCleanup.enabled}
                onChange={e => setGroupCleanup(prev => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          <div className="config-form">
            <div className="form-group">
              <label>{t('infrastructure.groupCleanup.keywords')}</label>
              <textarea
                rows={3}
                value={groupCleanup.keywords}
                onChange={e => setGroupCleanup(prev => ({ ...prev, keywords: e.target.value }))}
                placeholder="happy birthday, hbd, birthady, congrats"
              />
              <small>{t('infrastructure.groupCleanup.keywordsHint')}</small>
            </div>
            <div className="form-group">
              <label>{t('infrastructure.groupCleanup.sessions')}</label>
              <input
                type="text"
                value={groupCleanup.sessions}
                onChange={e => setGroupCleanup(prev => ({ ...prev, sessions: e.target.value }))}
                placeholder={t('infrastructure.groupCleanup.sessionsPlaceholder')}
              />
            </div>
            <div className="toggle-row" style={{ marginBottom: '0.75rem' }}>
              <div className="toggle-info">
                <span>{t('infrastructure.groupCleanup.requireAdmin')}</span>
                <small>{t('infrastructure.groupCleanup.requireAdminDesc')}</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={groupCleanup.requireAdmin}
                  onChange={e => setGroupCleanup(prev => ({ ...prev, requireAdmin: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="toggle-row" style={{ marginBottom: '0.75rem' }}>
              <div className="toggle-info">
                <span>{t('infrastructure.groupCleanup.forEveryone')}</span>
                <small>{t('infrastructure.groupCleanup.forEveryoneDesc')}</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={groupCleanup.forEveryone}
                  onChange={e => setGroupCleanup(prev => ({ ...prev, forEveryone: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="toggle-row" style={{ marginBottom: '0.75rem' }}>
              <div className="toggle-info">
                <span>{t('infrastructure.groupCleanup.dryRun')}</span>
                <small>{t('infrastructure.groupCleanup.dryRunDesc')}</small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={groupCleanup.dryRun}
                  onChange={e => setGroupCleanup(prev => ({ ...prev, dryRun: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="form-group">
              <label>{t('infrastructure.groupCleanup.testLabel')}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={cleanupTestText}
                  onChange={e => setCleanupTestText(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={cleanupTesting}
                  onClick={async () => {
                    setCleanupTesting(true);
                    setCleanupTestResult('');
                    try {
                      const res = await moderationApi.testKeyword(cleanupTestText);
                      setCleanupTestResult(
                        res.matched
                          ? t('infrastructure.groupCleanup.testMatch', { keyword: res.keyword })
                          : t('infrastructure.groupCleanup.testNoMatch'),
                      );
                    } catch (err) {
                      toast.error(
                        t('infrastructure.groupCleanup.testFailed'),
                        err instanceof Error ? err.message : t('common.unknownError'),
                      );
                    } finally {
                      setCleanupTesting(false);
                    }
                  }}
                >
                  {cleanupTesting ? <Loader2 size={16} className="animate-spin" /> : t('infrastructure.groupCleanup.test')}
                </button>
              </div>
              {cleanupTestResult && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {cleanupTestResult}
                </p>
              )}
              <small>{t('infrastructure.groupCleanup.testHint')}</small>
            </div>
          </div>
        </section>

        {/* Redis */}
        <section
          className={sectionClass('redis')}
          style={sectionStyle('redis')}
          onDragOver={onSectionDragOver('redis')}
          onDrop={onSectionDrop('redis')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="redis" />
              <Server size={20} />
              <h2>{t('infrastructure.redis.title')}</h2>
            </div>
            <span
              className={`status-indicator ${redisEnabled && redisConfig.connected ? 'connected' : 'disconnected'}`}
            >
              ● {redisEnabled
                ? redisConfig.connected
                  ? t('infrastructure.statusLabels.connected')
                  : t('infrastructure.statusLabels.disconnected')
                : t('infrastructure.statusLabels.disabled')}
            </span>
          </div>
          {envPinNote(redisPinnedByEnv)}

          <div
            className="toggle-row"
            style={{
              borderBottom: redisEnabled ? '1px solid var(--border)' : 'none',
              marginBottom: redisEnabled ? '1.5rem' : 0,
              paddingBottom: redisEnabled ? '1.25rem' : 0,
            }}
          >
            <div className="toggle-info">
              <span>{t('infrastructure.redis.enable')}</span>
              <small>{t('infrastructure.redis.enableDesc')}</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={redisEnabled}
                onChange={e => {
                  setRedisEnabled(e.target.checked);
                  if (!e.target.checked) setQueueEnabled(false);
                }}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {redisEnabled ? (
            <>
              <div className="toggle-row" style={{ marginBottom: '1rem' }}>
                <div className="toggle-info">
                  <span>{t('infrastructure.redis.useBuiltIn')}</span>
                  <small>{t('infrastructure.redis.builtInDesc')}</small>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={redisConfig.builtIn}
                    onChange={e => updateRedisConfig('builtIn', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              {!redisConfig.builtIn && (
                <div className="config-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('common.host')}</label>
                      <input
                        type="text"
                        value={redisConfig.host}
                        onChange={e => updateRedisConfig('host', e.target.value)}
                      />
                    </div>
                    <div className="form-group small">
                      <label>{t('common.port')}</label>
                      <input
                        type="text"
                        value={redisConfig.port}
                        onChange={e => updateRedisConfig('port', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('common.password')}</label>
                      <input
                        type="password"
                        value={redisConfig.password}
                        onChange={e => updateRedisConfig('password', e.target.value)}
                        placeholder={t('infrastructure.redis.passwordOptional')}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div
                className="toggle-row"
                style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '0.5rem' }}
              >
                <div className="toggle-info">
                  <span>{t('infrastructure.redis.queueTitle')}</span>
                  <small>{t('infrastructure.redis.queueDesc')}</small>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={queueEnabled} onChange={e => setQueueEnabled(e.target.checked)} />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              {queueEnabled && (
                <div className="queue-stats">
                  <h3>{t('infrastructure.redis.statsTitle')}</h3>
                  <div className="stats-row">
                    <div className="queue-stat-card">
                      <h4>{t('infrastructure.redis.webhookQueue')}</h4>
                      <div className="stat-values">
                        <div className="stat-item pending">
                          <span className="value">{queueStats.webhooks.pending}</span>
                          <span className="label">{t('infrastructure.redis.pending')}</span>
                        </div>
                        <div className="stat-item completed">
                          <span className="value">{queueStats.webhooks.completed.toLocaleString()}</span>
                          <span className="label">{t('infrastructure.redis.completed')}</span>
                        </div>
                        <div className="stat-item failed">
                          <span className="value">{queueStats.webhooks.failed}</span>
                          <span className="label">{t('infrastructure.redis.failed')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="queue-actions">
                    <button
                      className="btn-outline"
                      onClick={() => {
                        // The BullBoard route requires an ADMIN API key in the X-API-Key header — a plain
                        // browser tab can't send one, so copy the URL for use with an authenticated client
                        // / reverse proxy instead of opening a tab that 401s.
                        const base = API_BASE_URL.startsWith('http')
                          ? API_BASE_URL
                          : `${window.location.origin}${API_BASE_URL}`;
                        void copyToClipboard(`${base}/admin/queues`).then(ok => {
                          if (ok) {
                            toast.success(
                              t('infrastructure.redis.bullMqUrlCopied'),
                              t('infrastructure.redis.bullMqUrlHint'),
                            );
                          }
                        });
                      }}
                    >
                      <ExternalLink size={16} />
                      {t('infrastructure.redis.viewBullMq')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              className="empty-state-card"
              style={{
                padding: '2.5rem',
                textAlign: 'center',
                background: 'var(--bg-light)',
                borderRadius: '12px',
                border: '1px dashed var(--border)',
                marginTop: '1rem',
              }}
            >
              <Server size={32} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.5 }} />
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9375rem', fontWeight: 500 }}>
                {t('infrastructure.redis.disabledTitle')}
              </p>
              <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.5 }}>
                {t('infrastructure.redis.disabledDesc')}
              </p>
            </div>
          )}
        </section>

        {/* Storage */}
        <section
          className={sectionClass('storage')}
          style={sectionStyle('storage')}
          onDragOver={onSectionDragOver('storage')}
          onDrop={onSectionDrop('storage')}
        >
          <div className="card-header">
            <div className="header-left">
              <DragHandle id="storage" />
              <HardDrive size={20} />
              <h2>{t('infrastructure.storage.title')}</h2>
            </div>
            {(() => {
              // S3 selected but the backend isn't reachable → warn instead of a misleading green.
              const s3Unreachable = storageConfig.type === 's3' && infraStatus?.storage.s3Available === false;
              const cls = storageConfig.type !== 's3' ? 'sqlite' : s3Unreachable ? 'disconnected' : 'connected';
              return (
                <span className={`status-indicator ${cls}`}>
                  ● {storageConfig.type === 's3' ? (s3Unreachable ? t('infrastructure.storage.s3Unreachable') : 'S3') : 'Local'}
                </span>
              );
            })()}
          </div>
          {envPinNote(storagePinnedByEnv)}

          <div className="radio-group">
            <label className={`radio-option ${storageConfig.type === 'local' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="storageType"
                checked={storageConfig.type === 'local'}
                onChange={() => updateStorageConfig('type', 'local')}
              />
              <img src={folderIcon} alt="" className="watermark-icon" />
              <span>{t('infrastructure.storage.local')}</span>
              <small>{t('infrastructure.storage.localDesc')}</small>
            </label>
            <label className={`radio-option ${storageConfig.type === 's3' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="storageType"
                checked={storageConfig.type === 's3'}
                onChange={() => updateStorageConfig('type', 's3')}
              />
              <img src={s3Icon} alt="" className="watermark-icon" />
              <span>{t('infrastructure.storage.s3')}</span>
              <small>{t('infrastructure.storage.s3Desc')}</small>
            </label>
          </div>

          <div className="config-form">
            {storageConfig.type === 'local' && (
              <div className="form-group">
                <label>{t('infrastructure.storage.storagePath')}</label>
                <input
                  type="text"
                  value={storageConfig.localPath}
                  onChange={e => updateStorageConfig('localPath', e.target.value)}
                />
              </div>
            )}

            {storageConfig.type === 's3' && (
              <>
                <div className="toggle-row" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                  <div className="toggle-info">
                    <span>{t('infrastructure.storage.useBuiltIn')}</span>
                    <small>{t('infrastructure.storage.builtInDesc')}</small>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={storageConfig.builtIn}
                      onChange={e => updateStorageConfig('builtIn', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                {!storageConfig.builtIn && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>{t('infrastructure.storage.bucket')}</label>
                        <input
                          type="text"
                          value={storageConfig.s3Bucket}
                          onChange={e => updateStorageConfig('s3Bucket', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('infrastructure.storage.region')}</label>
                        <input
                          type="text"
                          value={storageConfig.s3Region}
                          onChange={e => updateStorageConfig('s3Region', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>{t('infrastructure.storage.accessKey')}</label>
                        <input
                          type="text"
                          value={storageConfig.s3AccessKey}
                          onChange={e => updateStorageConfig('s3AccessKey', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>{t('infrastructure.storage.secretKey')}</label>
                        <input
                          type="password"
                          value={storageConfig.s3SecretKey}
                          onChange={e => updateStorageConfig('s3SecretKey', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>{t('infrastructure.storage.endpoint')}</label>
                      <input
                        type="text"
                        value={storageConfig.s3Endpoint}
                        onChange={e => updateStorageConfig('s3Endpoint', e.target.value)}
                        placeholder={t('infrastructure.storage.endpointHint')}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {showRestartModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px', textAlign: 'center' }}>
            <div className="modal-header" style={{ justifyContent: 'center', borderBottom: 'none' }}>
              <h2>
                {restartStatus === 'idle' && t('infrastructure.restart.idleTitle')}
                {restartStatus === 'restarting' && t('infrastructure.restart.restartingTitle')}
                {restartStatus === 'waiting' && t('infrastructure.restart.waitingTitle')}
                {restartStatus === 'success' && t('infrastructure.restart.successTitle')}
                {restartStatus === 'error' && t('infrastructure.restart.errorTitle')}
              </h2>
            </div>
            <div className="modal-body" style={{ padding: '2rem' }}>
              {restartStatus === 'idle' && (
                <>
                  <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                    <Trans i18nKey="infrastructure.restart.idleDesc" components={{ code: <code />, br: <br /> }} />
                  </p>
                  {(dbSwitch || storageSwitch) && (
                    <div className="migration-warning">
                      <AlertTriangle size={18} />
                      <div>
                        <strong>{t('infrastructure.migration.title')}</strong>
                        {dbSwitch && <p>{t('infrastructure.migration.dbWarning')}</p>}
                        {storageSwitch && <p>{t('infrastructure.migration.storageWarning')}</p>}
                        {dbSwitch && (
                          <button className="btn-secondary btn-sm" onClick={handleExportBackup} disabled={migrating}>
                            {migrating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            {t('infrastructure.migration.downloadBackup')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={() => setShowRestartModal(false)}>
                      {t('infrastructure.restart.later')}
                    </button>
                    <button className="btn-primary" onClick={handleRestart}>
                      {t('infrastructure.restart.now')}
                    </button>
                  </div>
                </>
              )}

              {(restartStatus === 'restarting' || restartStatus === 'waiting') && (
                <>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <Loader2 className="animate-spin" size={48} style={{ color: 'var(--success)', marginBottom: '1rem' }} />
                    <p style={{ fontSize: '1.125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                      {restartCountdown > 0
                        ? t('infrastructure.restart.restartingMsg', { count: restartCountdown })
                        : t('infrastructure.restart.checking')}
                    </p>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '8px',
                      background: 'var(--border)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: restartCountdown > 0 ? `${((30 - restartCountdown) / 30) * 100}%` : '100%',
                        height: '100%',
                        background: 'linear-gradient(90deg, #22C55E, #10B981)',
                        transition: 'width 1s linear',
                      }}
                    />
                  </div>
                  <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    {t('infrastructure.restart.dontClose')}
                  </p>
                </>
              )}

              {restartStatus === 'success' && (
                <>
                  <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: '1rem' }} />
                  <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                    {t('infrastructure.restart.successMsg')}
                  </p>
                </>
              )}

              {restartStatus === 'error' && (
                <>
                  <p style={{ fontSize: '1rem', color: 'var(--error)', marginBottom: '1rem' }}>
                    {t('infrastructure.restart.errorMsg')}
                  </p>
                  <button className="btn-primary" onClick={() => window.location.reload()}>
                    {t('infrastructure.restart.reload')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="page-footer">
        <button className="btn-primary large" onClick={handleSaveConfig} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {saving ? t('infrastructure.saving') : t('infrastructure.saveConfig')}
        </button>
      </footer>
    </div>
  );
}

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Plus,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  X,
  Globe,
  KeyRound,
  Database,
  Copy,
  Check,
  Play,
  RotateCw,
  LayoutGrid,
  List,
  Search,
  ArrowDownWideNarrow,
  Clock,
  Calendar,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCodexAccountStore } from '../stores/useCodexAccountStore';
import * as codexService from '../services/codexService';
import {
  getCodexPlanDisplayName,
  getCodexQuotaClass,
  formatCodexResetTime,
} from '../types/codex';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';

export function CodexAccountsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'zh-CN';
  const {
    accounts,
    currentAccount,
    loading,
    fetchAccounts,
    fetchCurrentAccount,
    deleteAccounts,
    refreshQuota,
    refreshAllQuotas,
    switchAccount,
  } = useCodexAccountStore();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'oauth' | 'token' | 'import'>('oauth');
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'FREE' | 'PLUS' | 'PRO' | 'TEAM' | 'ENTERPRISE'>('all');
  const [sortBy, setSortBy] = useState<'weekly' | 'hourly' | 'created_at' | 'weekly_reset' | 'hourly_reset'>('created_at');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('asc');
  const [switching, setSwitching] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone?: 'error' } | null>(null);
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [addMessage, setAddMessage] = useState('');
  const [oauthUrl, setOauthUrl] = useState('');
  const [oauthUrlCopied, setOauthUrlCopied] = useState(false);
  const [oauthPrepareError, setOauthPrepareError] = useState<string | null>(null);
  const [oauthPortInUse, setOauthPortInUse] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showAddModalRef = useRef(showAddModal);
  const addTabRef = useRef(addTab);
  const addStatusRef = useRef(addStatus);
  const oauthActiveRef = useRef(false);

  useEffect(() => {
    showAddModalRef.current = showAddModal;
    addTabRef.current = addTab;
    addStatusRef.current = addStatus;
  }, [showAddModal, addTab, addStatus]);

  useEffect(() => {
    fetchAccounts();
    fetchCurrentAccount();
  }, [fetchAccounts, fetchCurrentAccount]);

  // 监听 OAuth 回调
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<string>('codex-oauth-callback-received', async (event) => {
      if (!showAddModalRef.current) return;
      if (addTabRef.current !== 'oauth') return;
      if (addStatusRef.current === 'loading') return;

      const code = event.payload;
      if (!code) return;

      setAddStatus('loading');
      setAddMessage(t('codex.oauth.exchanging', '正在交换令牌...'));

      try {
        await codexService.completeCodexOAuth(code);
        await fetchAccounts();
        await fetchCurrentAccount();
        setAddStatus('success');
        setAddMessage(t('codex.oauth.success', '授权成功'));
        setTimeout(() => {
          setShowAddModal(false);
          resetAddModalState();
        }, 1200);
      } catch (e) {
        setAddStatus('error');
        setAddMessage(t('codex.oauth.failed', '授权失败') + ': ' + String(e));
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [fetchAccounts, fetchCurrentAccount, t]);

  const prepareOauthUrl = useCallback(() => {
    if (!showAddModalRef.current || addTabRef.current !== 'oauth') return;
    if (oauthActiveRef.current) return;
    oauthActiveRef.current = true;
    setOauthPrepareError(null);
    setOauthPortInUse(null);
    codexService
      .prepareCodexOAuthUrl()
      .then((url) => {
        if (typeof url === 'string' && url.length > 0 && showAddModalRef.current && addTabRef.current === 'oauth') {
          setOauthUrl(url);
          return;
        }
        oauthActiveRef.current = false;
      })
      .catch((e) => {
        oauthActiveRef.current = false;
        const match = String(e).match(/CODEX_OAUTH_PORT_IN_USE:(\d+)/);
        if (match) {
          const port = Number(match[1]);
          setOauthPortInUse(Number.isNaN(port) ? null : port);
          setOauthPrepareError(t('codex.oauth.portInUse', { port: match[1] }));
          return;
        }
        setOauthPrepareError(t('codex.oauth.failed', '授权失败') + ': ' + String(e));
        console.error('准备 Codex OAuth 链接失败:', e);
      });
  }, [t]);

  // 准备 OAuth URL
  useEffect(() => {
    if (!showAddModal || addTab !== 'oauth' || oauthUrl) return;
    prepareOauthUrl();
  }, [showAddModal, addTab, oauthUrl, prepareOauthUrl]);

  // 关闭弹窗时取消 OAuth
  useEffect(() => {
    if (showAddModal && addTab === 'oauth') return;
    if (!oauthActiveRef.current) return;
    codexService.cancelCodexOAuth().catch(() => {});
    oauthActiveRef.current = false;
    setOauthUrl('');
    setOauthUrlCopied(false);
  }, [showAddModal, addTab]);

  const handleRefresh = async (accountId: string) => {
    setRefreshing(accountId);
    try {
      await refreshQuota(accountId);
    } catch (e) {
      console.error(e);
    }
    setRefreshing(null);
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await refreshAllQuotas();
    } catch (e) {
      console.error(e);
    }
    setRefreshingAll(false);
  };

  const handleDelete = (accountId: string) => {
    setDeleteConfirm({
      ids: [accountId],
      message: t('messages.deleteConfirm', '确定要删除此账号吗？'),
    });
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    setDeleteConfirm({
      ids: Array.from(selected),
      message: t('messages.batchDeleteConfirm', { count: selected.size }),
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm || deleting) return;
    setDeleting(true);
    try {
      await deleteAccounts(deleteConfirm.ids);
      setSelected((prev) => {
        const next = new Set(prev);
        deleteConfirm.ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const resetAddModalState = () => {
    setAddStatus('idle');
    setAddMessage('');
    setTokenInput('');
    setOauthUrl('');
    setOauthUrlCopied(false);
    setOauthPrepareError(null);
    setOauthPortInUse(null);
  };

  const openAddModal = (tab: 'oauth' | 'token' | 'import') => {
    setAddTab(tab);
    setShowAddModal(true);
    resetAddModalState();
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    resetAddModalState();
  };

  const handleSwitch = async (accountId: string) => {
    setMessage(null);
    setSwitching(accountId);
    try {
      const account = await switchAccount(accountId);
      setMessage({ text: t('codex.switched', { email: account.email }) });
    } catch (e) {
      setMessage({ text: t('codex.switchFailed', { error: String(e) }), tone: 'error' });
    }
    setSwitching(null);
  };

  const handleImportFromLocal = async () => {
    setImporting(true);
    setAddStatus('loading');
    setAddMessage(t('codex.import.importing', '正在导入本地账号...'));
    try {
      const account = await codexService.importCodexFromLocal();
      await fetchAccounts();
      
      // 配额刷新失败不影响导入结果
      try {
        await refreshQuota(account.id);
        await fetchAccounts();
      } catch (quotaErr) {
        console.warn('配额刷新失败（可稍后重试）:', quotaErr);
      }
      
      setAddStatus('success');
      setAddMessage(t('codex.import.successMsg', '导入成功: {{email}}').replace('{{email}}', account.email));
      setTimeout(() => {
        setShowAddModal(false);
        resetAddModalState();
      }, 1200);
    } catch (e) {
      setAddStatus('error');
      const errorMsg = String(e).replace(/^Error:\s*/, '');
      setAddMessage(t('codex.import.failedMsg', '导入失败: {{error}}').replace('{{error}}', errorMsg));
    }
    setImporting(false);
  };

  const handleTokenImport = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setAddStatus('error');
      setAddMessage(t('codex.token.empty', '请输入 Token 或 JSON'));
      return;
    }

    setImporting(true);
    setAddStatus('loading');
    setAddMessage(t('codex.token.importing', '正在导入...'));

    try {
      // 尝试作为 JSON 导入
      const accounts = await codexService.importCodexFromJson(trimmed);
      await fetchAccounts();
      for (const acc of accounts) {
        await refreshQuota(acc.id).catch(() => {});
      }
      await fetchAccounts();
      setAddStatus('success');
      setAddMessage(t('codex.token.importSuccessMsg', '成功导入 {{count}} 个账号').replace('{{count}}', String(accounts.length)));
      setTimeout(() => {
        setShowAddModal(false);
        resetAddModalState();
      }, 1200);
    } catch (e) {
      setAddStatus('error');
      const errorMsg = String(e).replace(/^Error:\s*/, '');
      setAddMessage(t('codex.token.importFailedMsg', '导入失败: {{error}}').replace('{{error}}', errorMsg));
    }
    setImporting(false);
  };

  const handleCopyOauthUrl = async () => {
    if (!oauthUrl) return;
    try {
      await navigator.clipboard.writeText(oauthUrl);
      setOauthUrlCopied(true);
      window.setTimeout(() => setOauthUrlCopied(false), 1200);
    } catch (e) {
      console.error('复制失败:', e);
    }
  };

  const handleReleaseOauthPort = async () => {
    const port = oauthPortInUse;
    if (!port) return;
    const confirmed = await confirmDialog(
      t('codex.oauth.portInUseConfirm', { port }),
      {
        title: t('codex.oauth.portInUseTitle'),
        kind: 'warning',
        okLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
      }
    );
    if (!confirmed) return;

    setOauthPrepareError(null);
    try {
      await codexService.closeCodexOAuthPort();
    } catch (e) {
      setOauthPrepareError(t('codex.oauth.portCloseFailed', { error: String(e) }));
      setOauthPortInUse(port);
      return;
    }

    prepareOauthUrl();
  };

  const handleOpenOauthUrl = async () => {
    if (!oauthUrl) return;
    try {
      await openUrl(oauthUrl);
    } catch (e) {
      console.error('打开浏览器失败:', e);
      // 回退方案：复制到剪贴板
      await navigator.clipboard.writeText(oauthUrl).catch(() => {});
      setOauthUrlCopied(true);
      setTimeout(() => setOauthUrlCopied(false), 1200);
    }
  };

  const saveJsonFile = async (json: string, defaultFileName: string) => {
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return null;
    await invoke('save_text_file', { path: filePath, content: json });
    return filePath;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const ids = selected.size > 0 ? Array.from(selected) : accounts.map((a) => a.id);
      const json = await codexService.exportCodexAccounts(ids);
      const defaultName = `codex_accounts_${new Date().toISOString().slice(0, 10)}.json`;
      const savedPath = await saveJsonFile(json, defaultName);
      if (savedPath) {
        setMessage({ text: `${t('common.success')}: ${savedPath}` });
      }
    } catch (e) {
      setMessage({ text: t('messages.exportFailed', { error: String(e) }), tone: 'error' });
    }
    setExporting(false);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    const allIds = filteredAccounts.map((account) => account.id);
    const allSelected = selected.size === allIds.length && allIds.length > 0;
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const normalizePlan = (planType?: string) => getCodexPlanDisplayName(planType);

  const tierCounts = useMemo(() => {
    const counts = {
      all: accounts.length,
      FREE: 0,
      PLUS: 0,
      PRO: 0,
      TEAM: 0,
      ENTERPRISE: 0,
    };
    accounts.forEach((account) => {
      const tier = normalizePlan(account.plan_type);
      if (tier in counts) {
        counts[tier as keyof typeof counts] += 1;
      }
    });
    return counts;
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    let result = [...accounts];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((account) => account.email.toLowerCase().includes(query));
    }

    if (filterType !== 'all') {
      result = result.filter((account) => normalizePlan(account.plan_type) === filterType);
    }

    result.sort((a, b) => {
      if (sortBy === 'created_at') {
        const diff = b.created_at - a.created_at;
        return sortDirection === 'desc' ? diff : -diff;
      }

      if (sortBy === 'weekly_reset' || sortBy === 'hourly_reset') {
        const aReset =
          sortBy === 'weekly_reset'
            ? a.quota?.weekly_reset_time ?? null
            : a.quota?.hourly_reset_time ?? null;
        const bReset =
          sortBy === 'weekly_reset'
            ? b.quota?.weekly_reset_time ?? null
            : b.quota?.hourly_reset_time ?? null;
        if (aReset === null && bReset === null) return 0;
        if (aReset === null) return 1;
        if (bReset === null) return -1;
        const diff = bReset - aReset;
        return sortDirection === 'desc' ? diff : -diff;
      }

      const aValue = sortBy === 'weekly' ? a.quota?.weekly_percentage ?? -1 : a.quota?.hourly_percentage ?? -1;
      const bValue = sortBy === 'weekly' ? b.quota?.weekly_percentage ?? -1 : b.quota?.hourly_percentage ?? -1;
      const diff = bValue - aValue;
      return sortDirection === 'desc' ? diff : -diff;
    });

    return result;
  }, [accounts, filterType, searchQuery, sortBy, sortDirection]);

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    return (
      d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <div className="codex-accounts-page">
      {/* 页面标题 */}
      <div className="page-header">
        <h1>{t('codex.title', 'Codex 账号管理')}</h1>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`message-bar ${message.tone === 'error' ? 'error' : 'success'}`}>
          {message.text}
          <button onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder={t('codex.search', '搜索账号...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="view-switcher">
            <button
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title={t('codex.view.list', '列表视图')}
            >
              <List size={16} />
            </button>
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title={t('codex.view.grid', '卡片视图')}
            >
              <LayoutGrid size={16} />
            </button>
          </div>

          <div className="filter-select">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              aria-label={t('codex.filterLabel', '筛选')}
            >
              <option value="all">{t('codex.filter.all', { count: tierCounts.all })}</option>
              <option value="FREE">{t('codex.filter.free', { count: tierCounts.FREE })}</option>
              <option value="PLUS">{t('codex.filter.plus', { count: tierCounts.PLUS })}</option>
              <option value="PRO">{t('codex.filter.pro', { count: tierCounts.PRO })}</option>
              <option value="TEAM">{t('codex.filter.team', { count: tierCounts.TEAM })}</option>
              <option value="ENTERPRISE">{t('codex.filter.enterprise', { count: tierCounts.ENTERPRISE })}</option>
            </select>
          </div>

          <div className="sort-select">
            <ArrowDownWideNarrow size={14} className="sort-icon" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label={t('codex.sortLabel', '排序')}
            >
              <option value="created_at">{t('codex.sort.createdAt', '按创建时间')}</option>
              <option value="weekly">{t('codex.sort.weekly', '按周配额')}</option>
              <option value="hourly">{t('codex.sort.hourly', '按5小时配额')}</option>
              <option value="weekly_reset">{t('codex.sort.weeklyReset', '按周配额重置时间')}</option>
              <option value="hourly_reset">{t('codex.sort.hourlyReset', '按5小时配额重置时间')}</option>
            </select>
          </div>

          <button
            className="sort-direction-btn"
            onClick={() => setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            title={
              sortDirection === 'desc'
                ? t('codex.sort.descTooltip', '当前：降序，点击切换为升序')
                : t('codex.sort.ascTooltip', '当前：升序，点击切换为降序')
            }
            aria-label={t('codex.sort.toggleDirection', '切换排序方向')}
          >
            {sortDirection === 'desc' ? '⬇' : '⬆'}
          </button>
        </div>
        <div className="toolbar-right">
          <button
            className="btn btn-primary icon-only"
            onClick={() => openAddModal('oauth')}
            title={t('codex.addAccount', '添加账号')}
            aria-label={t('codex.addAccount', '添加账号')}
          >
            <Plus size={14} />
          </button>
          <button
            className="btn btn-secondary icon-only"
            onClick={handleRefreshAll}
            disabled={refreshingAll || accounts.length === 0}
            title={t('codex.refreshAll', '刷新全部')}
            aria-label={t('codex.refreshAll', '刷新全部')}
          >
            <RefreshCw size={14} className={refreshingAll ? 'loading-spinner' : ''} />
          </button>
          <button
            className="btn btn-secondary icon-only"
            onClick={() => openAddModal('token')}
            disabled={importing}
            title={t('codex.import.label', '导入')}
            aria-label={t('codex.import.label', '导入')}
          >
            <Download size={14} />
          </button>
          <button
            className="btn btn-secondary export-btn icon-only"
            onClick={handleExport}
            disabled={exporting}
            title={selected.size > 0 ? `${t('codex.export', '导出')} (${selected.size})` : t('codex.export', '导出')}
            aria-label={selected.size > 0 ? `${t('codex.export', '导出')} (${selected.size})` : t('codex.export', '导出')}
          >
            <Upload size={14} />
          </button>
          {selected.size > 0 && (
            <button
              className="btn btn-danger icon-only"
              onClick={handleBatchDelete}
              title={`${t('common.delete', '删除')} (${selected.size})`}
              aria-label={`${t('common.delete', '删除')} (${selected.size})`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 账号列表 */}
      {loading && accounts.length === 0 ? (
        <div className="loading-container">
          <RefreshCw size={24} className="loading-spinner" />
          <p>{t('common.loading', '加载中...')}</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <Globe size={48} />
          <h3>{t('codex.empty.title', '暂无账号')}</h3>
          <p>{t('codex.empty.description', '点击"添加账号"开始管理您的 Codex 账号')}</p>
          <button className="btn btn-primary" onClick={() => openAddModal('oauth')}>
            <Plus size={16} />
            {t('codex.addAccount', '添加账号')}
          </button>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="empty-state">
          <h3>{t('codex.noMatch.title', '没有匹配的账号')}</h3>
          <p>{t('codex.noMatch.desc', '请尝试调整搜索或筛选条件')}</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="codex-accounts-grid">
          {filteredAccounts.map((account) => {
            const isCurrent = currentAccount?.id === account.id;
            const planKey = getCodexPlanDisplayName(account.plan_type);
            const planLabel = t(`codex.plan.${planKey.toLowerCase()}`, planKey);
            const isSelected = selected.has(account.id);

            return (
              <div
                key={account.id}
                className={`codex-account-card ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
              >
                {/* 卡片头部 */}
                <div className="card-top">
                  <div className="card-select">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(account.id)}
                    />
                  </div>
                  <span className="account-email" title={account.email}>
                    {account.email}
                  </span>
                  {isCurrent && <span className="current-tag">{t('codex.current', '当前')}</span>}
                  <span className={`tier-badge ${planKey.toLowerCase()}`}>{planLabel}</span>
                </div>

                {/* 配额显示 */}
                <div className="codex-quota-section">
                  {/* 5小时配额 */}
                  <div className="quota-item">
                    <div className="quota-header">
                      <Clock size={14} />
                      <span className="quota-label">{t('codex.quota.hourly', '5小时配额')}</span>
                      <span className={`quota-pct ${getCodexQuotaClass(account.quota?.hourly_percentage ?? 100)}`}>
                        {account.quota?.hourly_percentage ?? 100}%
                      </span>
                    </div>
                    <div className="quota-bar-track">
                      <div
                        className={`quota-bar ${getCodexQuotaClass(account.quota?.hourly_percentage ?? 100)}`}
                        style={{ width: `${account.quota?.hourly_percentage ?? 100}%` }}
                      />
                    </div>
                    {account.quota?.hourly_reset_time && (
                      <span className="quota-reset">
                        {formatCodexResetTime(account.quota.hourly_reset_time, locale, t)}
                      </span>
                    )}
                  </div>

                  {/* 周配额 */}
                  <div className="quota-item">
                    <div className="quota-header">
                      <Calendar size={14} />
                      <span className="quota-label">{t('codex.quota.weekly', '周配额')}</span>
                      <span className={`quota-pct ${getCodexQuotaClass(account.quota?.weekly_percentage ?? 100)}`}>
                        {account.quota?.weekly_percentage ?? 100}%
                      </span>
                    </div>
                    <div className="quota-bar-track">
                      <div
                        className={`quota-bar ${getCodexQuotaClass(account.quota?.weekly_percentage ?? 100)}`}
                        style={{ width: `${account.quota?.weekly_percentage ?? 100}%` }}
                      />
                    </div>
                    {account.quota?.weekly_reset_time && (
                      <span className="quota-reset">
                        {formatCodexResetTime(account.quota.weekly_reset_time, locale, t)}
                      </span>
                    )}
                  </div>

                  {!account.quota && (
                    <div className="quota-empty">{t('codex.quota.noData', '暂无配额数据')}</div>
                  )}
                </div>

                {/* 卡片底部 */}
                <div className="card-footer">
                  <span className="card-date">{formatDate(account.created_at)}</span>
                  <div className="card-actions">
                    <button
                      className={`card-action-btn ${!isCurrent ? 'success' : ''}`}
                      onClick={() => handleSwitch(account.id)}
                      disabled={!!switching}
                      title={t('codex.switch', '切换')}
                    >
                      {switching === account.id ? (
                        <RefreshCw size={14} className="loading-spinner" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      className="card-action-btn"
                      onClick={() => handleRefresh(account.id)}
                      disabled={refreshing === account.id}
                      title={t('codex.refreshQuota', '刷新配额')}
                    >
                      <RotateCw
                        size={14}
                        className={refreshing === account.id ? 'loading-spinner' : ''}
                      />
                    </button>
                    <button
                      className="card-action-btn danger"
                      onClick={() => handleDelete(account.id)}
                      title={t('common.delete', '删除')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="account-table-container">
          <table className="account-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === filteredAccounts.length && filteredAccounts.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ width: 260 }}>{t('codex.columns.email', '账号')}</th>
                <th style={{ width: 140 }}>{t('codex.columns.plan', '订阅')}</th>
                <th>{t('codex.columns.hourly', '5小时配额')}</th>
                <th>{t('codex.columns.weekly', '周配额')}</th>
                <th className="sticky-action-header table-action-header">{t('codex.columns.actions', '操作')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => {
                const isCurrent = currentAccount?.id === account.id;
                const planKey = getCodexPlanDisplayName(account.plan_type);
                const planLabel = t(`codex.plan.${planKey.toLowerCase()}`, planKey);
                return (
                  <tr key={account.id} className={isCurrent ? 'current' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(account.id)}
                        onChange={() => toggleSelect(account.id)}
                      />
                    </td>
                    <td>
                      <div className="account-cell">
                        <div className="account-main-line">
                          <span className="account-email-text" title={account.email}>{account.email}</span>
                          {isCurrent && <span className="mini-tag current">{t('codex.current', '当前')}</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`tier-badge ${planKey.toLowerCase()}`}>{planLabel}</span>
                    </td>
                    <td>
                      <div className="quota-item">
                        <div className="quota-header">
                          <span className="quota-name">{t('codex.quota.hourly', '5小时配额')}</span>
                          <span className={`quota-value ${getCodexQuotaClass(account.quota?.hourly_percentage ?? 100)}`}>
                            {account.quota?.hourly_percentage ?? 100}%
                          </span>
                        </div>
                        <div className="quota-progress-track">
                          <div
                            className={`quota-progress-bar ${getCodexQuotaClass(account.quota?.hourly_percentage ?? 100)}`}
                            style={{ width: `${account.quota?.hourly_percentage ?? 100}%` }}
                          />
                        </div>
                        {account.quota?.hourly_reset_time && (
                          <div className="quota-footer">
                            <span className="quota-reset">
                              {formatCodexResetTime(account.quota.hourly_reset_time, locale, t)}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="quota-item">
                        <div className="quota-header">
                          <span className="quota-name">{t('codex.quota.weekly', '周配额')}</span>
                          <span className={`quota-value ${getCodexQuotaClass(account.quota?.weekly_percentage ?? 100)}`}>
                            {account.quota?.weekly_percentage ?? 100}%
                          </span>
                        </div>
                        <div className="quota-progress-track">
                          <div
                            className={`quota-progress-bar ${getCodexQuotaClass(account.quota?.weekly_percentage ?? 100)}`}
                            style={{ width: `${account.quota?.weekly_percentage ?? 100}%` }}
                          />
                        </div>
                        {account.quota?.weekly_reset_time && (
                          <div className="quota-footer">
                            <span className="quota-reset">
                              {formatCodexResetTime(account.quota.weekly_reset_time, locale, t)}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="sticky-action-cell table-action-cell">
                      <div className="action-buttons">
                        <button
                          className={`action-btn ${!isCurrent ? 'success' : ''}`}
                          onClick={() => handleSwitch(account.id)}
                          disabled={!!switching}
                          title={t('codex.switch', '切换')}
                        >
                          {switching === account.id ? <RefreshCw size={14} className="loading-spinner" /> : <Play size={14} />}
                        </button>
                        <button
                          className="action-btn"
                          onClick={() => handleRefresh(account.id)}
                          disabled={refreshing === account.id}
                          title={t('codex.refreshQuota', '刷新配额')}
                        >
                          <RotateCw size={14} className={refreshing === account.id ? 'loading-spinner' : ''} />
                        </button>
                        <button
                          className="action-btn danger"
                          onClick={() => handleDelete(account.id)}
                          title={t('common.delete', '删除')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 添加账号弹窗 */}
      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-content codex-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('codex.addModal.title', '添加 Codex 账号')}</h2>
              <button className="modal-close" onClick={closeAddModal}>
                <X size={20} />
              </button>
            </div>

            {/* Tab 切换 */}
            <div className="modal-tabs">
              <button
                className={`modal-tab ${addTab === 'oauth' ? 'active' : ''}`}
                onClick={() => setAddTab('oauth')}
              >
                <Globe size={16} />
                {t('codex.addModal.oauth', 'OAuth 登录')}
              </button>
              <button
                className={`modal-tab ${addTab === 'token' ? 'active' : ''}`}
                onClick={() => setAddTab('token')}
              >
                <KeyRound size={16} />
                {t('codex.addModal.token', 'JSON 导入')}
              </button>
              <button
                className={`modal-tab ${addTab === 'import' ? 'active' : ''}`}
                onClick={() => setAddTab('import')}
              >
                <Database size={16} />
                {t('codex.addModal.local', '本地导入')}
              </button>
            </div>

            <div className="modal-body">
              {/* OAuth 登录 */}
              {addTab === 'oauth' && (
                <div className="add-section">
                  <p className="section-desc">
                    {t('codex.oauth.desc', '点击下方按钮，在浏览器中完成 OpenAI 账号授权')}
                  </p>
                  {oauthUrl ? (
                    <div className="oauth-url-section">
                      <div className="oauth-url-box">
                        <input type="text" value={oauthUrl} readOnly />
                        <button onClick={handleCopyOauthUrl}>
                          {oauthUrlCopied ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <button className="btn btn-primary btn-full" onClick={handleOpenOauthUrl}>
                        <Globe size={16} />
                        {t('codex.oauth.openBrowser', '在浏览器中打开')}
                      </button>
                      <p className="oauth-hint">
                        {t('codex.oauth.hint', '完成授权后，此窗口将自动更新')}
                      </p>
                    </div>
                  ) : oauthPrepareError ? (
                    <>
                      <div className="add-status error">
                        <X size={16} />
                        <span>{oauthPrepareError}</span>
                      </div>
                      {oauthPortInUse ? (
                        <button
                          className="btn btn-secondary btn-full"
                          style={{ marginTop: '8px' }}
                          onClick={handleReleaseOauthPort}
                        >
                          {t('codex.oauth.portInUseAction', 'Close port and retry')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="oauth-loading">
                      <RefreshCw size={20} className="loading-spinner" />
                      <span>{t('codex.oauth.preparing', '正在准备授权链接...')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Token 导入 */}
              {addTab === 'token' && (
                <div className="add-section">
                  <p className="section-desc">
                    {t('codex.token.desc', '粘贴 auth.json 内容或账号 JSON 数据')}
                  </p>
                  <textarea
                    className="token-input"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={t('codex.token.placeholder', '粘贴 JSON 内容...')}
                    rows={8}
                  />
                  <button
                    className="btn btn-primary btn-full"
                    onClick={handleTokenImport}
                    disabled={importing || !tokenInput.trim()}
                  >
                    <Download size={16} />
                    {t('codex.token.import', '导入')}
                  </button>
                </div>
              )}

              {/* 本地导入 */}
              {addTab === 'import' && (
                <div className="add-section">
                  <p className="section-desc">
                    {t('codex.local.desc', '从 ~/.codex/auth.json 导入当前已登录的账号')}
                  </p>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={handleImportFromLocal}
                    disabled={importing}
                  >
                    <Database size={16} />
                    {importing ? t('common.loading', '加载中...') : t('codex.local.import', '获取本地账号')}
                  </button>
                </div>
              )}

              {/* 状态消息 */}
              {addStatus !== 'idle' && (
                <div className={`add-status ${addStatus}`}>
                  {addStatus === 'loading' && <RefreshCw size={16} className="loading-spinner" />}
                  {addStatus === 'success' && <Check size={16} />}
                  {addStatus === 'error' && <X size={16} />}
                  <span>{addMessage}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('common.confirm', '确认')}</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p>{deleteConfirm.message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                {t('common.cancel', '取消')}
              </button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? <RefreshCw size={16} className="loading-spinner" /> : null}
                {t('common.delete', '删除')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

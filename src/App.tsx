import { useEffect, useState } from 'react';
import './App.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { AccountsPage } from './pages/AccountsPage';
import { CodexAccountsPage } from './pages/CodexAccountsPage';

import { FingerprintsPage } from './pages/FingerprintsPage';
import { WakeupTasksPage } from './pages/WakeupTasksPage';
import { SettingsPage } from './pages/SettingsPage';
import { SideNav } from './components/layout/SideNav';
import { UpdateNotification } from './components/UpdateNotification';
import { CloseConfirmDialog } from './components/CloseConfirmDialog';
import { Page } from './types/navigation';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { changeLanguage, getCurrentLanguage, normalizeLanguage } from './i18n';

import { DashboardPage } from './pages/DashboardPage';

interface GeneralConfigTheme {
  theme: string;
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [updateNotificationKey, setUpdateNotificationKey] = useState(0);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  
  // 启用自动刷新 hook
  useAutoRefresh();

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const applyTheme = (newTheme: string) => {
      if (newTheme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    };

    const watchSystemTheme = () => {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else {
        mediaQuery.addListener(handleChange);
      }

      return () => {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handleChange);
        } else {
          mediaQuery.removeListener(handleChange);
        }
      };
    };

    const initTheme = async () => {
      try {
        const config = await invoke<GeneralConfigTheme>('get_general_config');
        applyTheme(config.theme);
        if (config.theme === 'system') {
          cleanup = watchSystemTheme();
        }
      } catch (error) {
        console.error('Failed to load theme config:', error);
      }
    };

    initTheme();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  // Check for updates on startup
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        console.log('[App] Checking if we should check for updates...');
        const shouldCheck = await invoke<boolean>('should_check_updates');
        console.log('[App] Should check updates:', shouldCheck);

        if (shouldCheck) {
          setShowUpdateNotification(true);
          // 标记已经检查过了
          await invoke('update_last_check_time');
          console.log('[App] Update check cycle initiated and last check time updated.');
        }
      } catch (error) {
        console.error('Failed to check update settings:', error);
      }
    };

    // Delay check to avoid blocking initial render
    const timer = setTimeout(checkUpdates, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<string>('settings:language_changed', (event) => {
      const nextLanguage = normalizeLanguage(String(event.payload || ''));
      if (!nextLanguage || nextLanguage === getCurrentLanguage()) {
        return;
      }
      changeLanguage(nextLanguage);
      window.dispatchEvent(new CustomEvent('general-language-updated', { detail: { language: nextLanguage } }));
    }).then((fn) => { unlisten = fn; });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const handleUpdateRequest = () => {
      setUpdateNotificationKey(Date.now());
      setShowUpdateNotification(true);
    };
    window.addEventListener('update-check-requested', handleUpdateRequest);
    return () => {
      window.removeEventListener('update-check-requested', handleUpdateRequest);
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen('tray:refresh_quota', async () => {
      try {
        await invoke('refresh_current_quota');
      } catch (error) {
        console.error('Failed to refresh Antigravity quotas:', error);
      }
      try {
        await invoke('refresh_current_codex_quota');
      } catch (error) {
        console.error('Failed to refresh Codex quotas:', error);
      }
    }).then((fn) => { unlisten = fn; });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 监听窗口关闭请求事件
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen('window:close_requested', () => {
      setShowCloseDialog(true);
    }).then((fn) => { unlisten = fn; });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

        listen<string>('tray:navigate', (event) => {
          const target = String(event.payload || '');
          switch (target) {
            case 'overview':
            case 'codex':
            case 'settings':
              setPage(target as Page);
              break;
            default:
              break;
          }
        }).then((fn) => { unlisten = fn; });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 窗口拖拽处理
  const handleDragStart = () => {
    getCurrentWindow().startDragging();
  };

  return (
    <div className="app-container">
      {/* 更新通知 */}
      {showUpdateNotification && (
        <UpdateNotification key={updateNotificationKey} onClose={() => setShowUpdateNotification(false)} />
      )}

      {/* 关闭确认对话框 */}
      {showCloseDialog && (
        <CloseConfirmDialog onClose={() => setShowCloseDialog(false)} />
      )}
      
      {/* 顶部固定拖拽区域 */}
      <div 
        className="drag-region"
        data-tauri-drag-region 
        onMouseDown={handleDragStart}
      />
      
      {/* 左侧悬浮导航 */}
      <SideNav page={page} setPage={setPage} />

      <div className="main-wrapper">
        {/* overview 现在是合并后的账号总览页面 */}

        {page === 'dashboard' && <DashboardPage onNavigate={setPage} />}
        {page === 'overview' && <AccountsPage onNavigate={setPage} />}
        {page === 'codex' && <CodexAccountsPage />}
        {page === 'fingerprints' && <FingerprintsPage onNavigate={setPage} />}
        {page === 'wakeup' && <WakeupTasksPage onNavigate={setPage} />}
        {page === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

export default App;

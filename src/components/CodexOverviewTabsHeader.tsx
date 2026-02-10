import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClock, Layers } from 'lucide-react';
import { CodexIcon } from './icons/CodexIcon';

export type CodexTab = 'overview' | 'wakeup' | 'instances';

interface CodexOverviewTabsHeaderProps {
  active: CodexTab;
  onTabChange?: (tab: CodexTab) => void;
}

interface TabSpec {
  key: CodexTab;
  label: string;
  icon: ReactNode;
}

export function CodexOverviewTabsHeader({
  active,
  onTabChange,
}: CodexOverviewTabsHeaderProps) {
  const { t } = useTranslation();
  
  const tabs: TabSpec[] = [
    {
      key: 'overview',
      label: t('overview.title', '账号总览'),
      icon: <CodexIcon className="tab-icon" />,
    },
    {
      key: 'wakeup',
      label: t('wakeup.title', 'Wakeup Tasks'),
      icon: <AlarmClock className="tab-icon" />,
    },
    {
      key: 'instances',
      label: t('instances.title', '多开实例'),
      icon: <Layers className="tab-icon" />,
    },
  ];

  const subtitle = active === 'instances'
    ? t('codex.instances.subtitle', '多实例独立配置，多账号并行运行。')
    : active === 'wakeup'
      ? t('codex.wakeup.subtitle', 'Manage Codex wakeup tasks with 3 trigger modes.')
      : t('codex.subtitle', '实时监控所有Codex账号的模型配额状态。');

  return (
    <>
      <div className="page-header">
        <div className="page-title">{t('codex.title', 'Codex 账号管理')}</div>
        <div className="page-subtitle">{subtitle}</div>
      </div>
      <div className="page-tabs-row page-tabs-center">
        <div className="page-tabs filter-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab${active === tab.key ? ' active' : ''}`}
              onClick={() => onTabChange?.(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

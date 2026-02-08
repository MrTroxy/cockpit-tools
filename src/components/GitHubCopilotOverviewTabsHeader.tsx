import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Github } from 'lucide-react';

export type GitHubCopilotTab = 'overview' | 'instances';

interface GitHubCopilotOverviewTabsHeaderProps {
  active: GitHubCopilotTab;
  onTabChange?: (tab: GitHubCopilotTab) => void;
}

interface TabSpec {
  key: GitHubCopilotTab;
  label: string;
  icon: ReactNode;
}

export function GitHubCopilotOverviewTabsHeader({
  active,
  onTabChange,
}: GitHubCopilotOverviewTabsHeaderProps) {
  const { t } = useTranslation();
  
  const tabs: TabSpec[] = [
    {
      key: 'overview',
      label: t('githubCopilot.overview.title', '账号总览'),
      icon: <Github className="tab-icon" />,
    },
    {
      key: 'instances',
      label: t('githubCopilot.instances.title', '多开实例'),
      icon: <Layers className="tab-icon" />,
    },
  ];

  const subtitle = active === 'instances'
    ? t('githubCopilot.instances.subtitle', '多实例独立配置，多账号并行运行。')
    : t('githubCopilot.subtitle', '实时监控所有账号的配额状态。');

  return (
    <>
      <div className="page-header">
        <div className="page-title">{t('githubCopilot.title', 'GitHub Copilot 账号管理')}</div>
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

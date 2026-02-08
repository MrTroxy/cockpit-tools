import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { Plus, Pencil, Trash2, Power, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountStore } from '../stores/useAccountStore';
import { Page } from '../types/navigation';
import { Account } from '../types/account';
import { getModelShortName } from '../utils/account';
import { OverviewTabsHeader } from '../components/OverviewTabsHeader';

const TASKS_STORAGE_KEY = 'agtools.wakeup.tasks';
const WAKEUP_ENABLED_KEY = 'agtools.wakeup.enabled';
const LEGACY_SCHEDULE_KEY = 'agtools.wakeup.schedule';
const MAX_HISTORY_ITEMS = 100;

const BASE_TIME_OPTIONS = [
  '06:00',
  '07:00',
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '22:00',
];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_PROMPT = 'hi';

type Translator = (key: string, options?: Record<string, unknown>) => string;

const BLOCKED_MODEL_IDS = new Set([
  'chat_20706',
  'chat_23310',
  'gemini-2.5-flash-thinking',
  'gemini-2.5-pro',
]);
const BLOCKED_DISPLAY_NAMES = new Set([
  'Gemini 2.5 Flash (Thinking)',
  'Gemini 2.5 Pro',
  'chat_20706',
  'chat_23310',
]);
const RECOMMENDED_LABELS = [
  'Claude Opus 4.5 (Thinking)',
  'Claude Sonnet 4.5',
  'Claude Sonnet 4.5 (Thinking)',
  'Gemini 3 Flash',
  'Gemini 3 Pro (High)',
  'Gemini 3 Pro (Low)',
  'Gemini 3 Pro Image',
  'GPT-OSS 120B (Medium)',
];
const RECOMMENDED_MODEL_IDS = [
  'MODEL_PLACEHOLDER_M12',
  'MODEL_CLAUDE_4_5_SONNET',
  'MODEL_CLAUDE_4_5_SONNET_THINKING',
  'MODEL_PLACEHOLDER_M18',
  'MODEL_PLACEHOLDER_M7',
  'MODEL_PLACEHOLDER_M8',
  'MODEL_PLACEHOLDER_M9',
  'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
  'gemini-3-flash',
  'gemini-3-pro-high',
  'gemini-3-pro-low',
  'gemini-3-pro-image',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-thinking',
  'claude-opus-4-5-thinking',
  'gpt-oss-120b-medium',
];
const RECOMMENDED_LABEL_BY_ID: Record<string, string> = {
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3-pro-high': 'Gemini 3 Pro (High)',
  'gemini-3-pro-low': 'Gemini 3 Pro (Low)',
  'gemini-3-pro-image': 'Gemini 3 Pro Image',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-sonnet-4-5-thinking': 'Claude Sonnet 4.5 (Thinking)',
  'claude-opus-4-5-thinking': 'Claude Opus 4.5 (Thinking)',
  'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
};
const getReadableModelLabel = (id: string) => RECOMMENDED_LABEL_BY_ID[id] || getModelShortName(id);
const normalizeModelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const RECOMMENDED_LABEL_KEYS = new Set(RECOMMENDED_LABELS.map(normalizeModelKey));
const RECOMMENDED_ID_SET = new Set(RECOMMENDED_MODEL_IDS.map((id) => id.toLowerCase()));
const RECOMMENDED_ID_KEYS = new Set(RECOMMENDED_MODEL_IDS.map(normalizeModelKey));
const RECOMMENDED_ORDER = (() => {
  const order = new Map<string, number>();
  RECOMMENDED_LABELS.forEach((label, index) => {
    order.set(normalizeModelKey(label), index);
  });
  const offset = RECOMMENDED_LABELS.length;
  RECOMMENDED_MODEL_IDS.forEach((id, index) => {
    const baseIndex = offset + index;
    const lower = id.toLowerCase();
    if (!order.has(lower)) {
      order.set(lower, baseIndex);
    }
    const normalized = normalizeModelKey(id);
    if (!order.has(normalized)) {
      order.set(normalized, baseIndex);
    }
  });
  return order;
})();

type TriggerMode = 'scheduled' | 'crontab' | 'quota_reset';
type RepeatMode = 'daily' | 'weekly' | 'interval';

type TriggerSource = 'scheduled' | 'crontab' | 'quota_reset';
type HistoryTriggerSource = TriggerSource | 'manual';
type HistoryTriggerType = 'manual' | 'auto';

type NoticeTone = 'error' | 'warning' | 'success';

interface WakeupPageProps {
  onNavigate?: (page: Page) => void;
}

interface AvailableModel {
  id: string;
  displayName: string;
  modelConstant?: string | null;
  recommended?: boolean | null;
}

interface ScheduleConfig {
  repeatMode: RepeatMode;
  dailyTimes: string[];
  weeklyDays: number[];
  weeklyTimes: string[];
  intervalHours: number;
  intervalStartTime: string;
  intervalEndTime: string;
  selectedModels: string[];
  selectedAccounts: string[];
  crontab?: string;
  wakeOnReset?: boolean;
  customPrompt?: string;
  maxOutputTokens?: number;
  timeWindowEnabled?: boolean;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  fallbackTimes?: string[];
}

interface WakeupTask {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  schedule: ScheduleConfig;
}

interface WakeupHistoryRecord {
  id: string;
  timestamp: number;
  triggerType: HistoryTriggerType;
  triggerSource: HistoryTriggerSource;
  taskName?: string;
  accountEmail: string;
  modelId: string;
  prompt?: string;
  success: boolean;
  message?: string;
  duration?: number;
}

interface WakeupInvokeResult {
  reply: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  traceId?: string;
  responseId?: string;
  durationMs?: number;
}

interface WakeupTaskResultPayload {
  taskId: string;
  lastRunAt: number;
  records: WakeupHistoryRecord[];
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  repeatMode: 'daily',
  dailyTimes: ['08:00'],
  weeklyDays: [1, 2, 3, 4, 5],
  weeklyTimes: ['08:00'],
  intervalHours: 4,
  intervalStartTime: '07:00',
  intervalEndTime: '22:00',
  selectedModels: ['gemini-3-flash'],
  selectedAccounts: [],
  maxOutputTokens: 0,
};

const normalizeSchedule = (schedule: ScheduleConfig): ScheduleConfig => {
  const dailyTimes = schedule.dailyTimes?.length ? schedule.dailyTimes : ['08:00'];
  const weeklyDays = schedule.weeklyDays?.length ? schedule.weeklyDays : [1, 2, 3, 4, 5];
  const weeklyTimes = schedule.weeklyTimes?.length ? schedule.weeklyTimes : ['08:00'];
  const intervalHours = schedule.intervalHours && schedule.intervalHours > 0 ? schedule.intervalHours : 4;
  const intervalStartTime = schedule.intervalStartTime || '07:00';
  const intervalEndTime = schedule.intervalEndTime || '22:00';
  const maxOutputTokens = typeof schedule.maxOutputTokens === 'number' ? schedule.maxOutputTokens : 0;
  const fallbackTimes = schedule.fallbackTimes?.length ? schedule.fallbackTimes : ['07:00'];

  return {
    ...schedule,
    dailyTimes,
    weeklyDays,
    weeklyTimes,
    intervalHours,
    intervalStartTime,
    intervalEndTime,
    maxOutputTokens,
    fallbackTimes,
  };
};

const normalizeTask = (task: WakeupTask): WakeupTask => ({
  ...task,
  schedule: normalizeSchedule({ ...DEFAULT_SCHEDULE, ...task.schedule }),
});

const parseTasks = (raw: string | null): WakeupTask[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as WakeupTask[];
    return parsed.map((task) => normalizeTask(task));
  } catch {
    return [];
  }
};

const loadTasks = (defaultTaskName: string): WakeupTask[] => {
  const rawTasks = localStorage.getItem(TASKS_STORAGE_KEY);
  if (rawTasks) return parseTasks(rawTasks);

  const legacyRaw = localStorage.getItem(LEGACY_SCHEDULE_KEY);
  if (!legacyRaw) return [];
  try {
    const legacySchedule = JSON.parse(legacyRaw) as Partial<ScheduleConfig> & { enabled?: boolean };
    const task: WakeupTask = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: defaultTaskName,
      enabled: legacySchedule.enabled ?? false,
      createdAt: Date.now(),
      schedule: normalizeSchedule({ ...DEFAULT_SCHEDULE, ...legacySchedule }),
    };
    return [task];
  } catch {
    return [];
  }
};

const loadHistory = async (): Promise<WakeupHistoryRecord[]> => {
  try {
    const records = await invoke<WakeupHistoryRecord[]>('wakeup_load_history');
    if (!Array.isArray(records)) return [];
    return records
      .filter((item) => item && typeof item.timestamp === 'number')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY_ITEMS);
  } catch (error) {
    console.error('加载唤醒历史失败:', error);
    return [];
  }
};

const formatErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const formatWakeupMessage = (
  modelId: string,
  result: WakeupInvokeResult,
  durationMs: number | undefined,
  t: Translator
) => {
  const reply = result.reply && result.reply.trim() ? result.reply.trim() : t('wakeup.format.noReply');
  const details: string[] = [];
  if (typeof durationMs === 'number') {
    details.push(t('wakeup.format.durationMs', { ms: durationMs }));
  }
  if (result.promptTokens !== undefined || result.totalTokens !== undefined) {
    const promptTokens = result.promptTokens ?? '?';
    const completionTokens = result.completionTokens ?? '?';
    const totalTokens = result.totalTokens ?? '?';
    details.push(
      t('wakeup.format.tokens', { prompt: promptTokens, completion: completionTokens, total: totalTokens })
    );
  }
  if (result.traceId) {
    details.push(t('wakeup.format.traceId', { traceId: result.traceId }));
  }
  const joiner = t('wakeup.format.detailJoiner');
  const suffix = details.length ? ` (${details.join(joiner)})` : '';
  return t('wakeup.format.message', { model: modelId, reply, suffix });
};

const normalizeTimeInput = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const calculateNextRuns = (config: ScheduleConfig, count: number) => {
  const now = new Date();
  const results: Date[] = [];

  if (config.repeatMode === 'daily' && config.dailyTimes?.length) {
    for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset += 1) {
      for (const time of [...config.dailyTimes].sort()) {
        const [h, m] = time.split(':').map(Number);
        const date = new Date(now);
        date.setDate(date.getDate() + dayOffset);
        date.setHours(h, m, 0, 0);
        if (date > now) {
          results.push(date);
          if (results.length >= count) break;
        }
      }
    }
  } else if (config.repeatMode === 'weekly' && config.weeklyDays?.length && config.weeklyTimes?.length) {
    for (let dayOffset = 0; dayOffset < 14 && results.length < count; dayOffset += 1) {
      const date = new Date(now);
      date.setDate(date.getDate() + dayOffset);
      const dayOfWeek = date.getDay();
      if (config.weeklyDays.includes(dayOfWeek)) {
        for (const time of [...config.weeklyTimes].sort()) {
          const [h, m] = time.split(':').map(Number);
          const candidate = new Date(date);
          candidate.setHours(h, m, 0, 0);
          if (candidate > now) {
            results.push(candidate);
            if (results.length >= count) break;
          }
        }
      }
    }
  } else if (config.repeatMode === 'interval') {
    const [startH, startM] = (config.intervalStartTime || '07:00').split(':').map(Number);
    const endH = config.intervalEndTime ? Number.parseInt(config.intervalEndTime.split(':')[0], 10) : 22;
    const interval = config.intervalHours || 4;

    for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset += 1) {
      for (let h = startH; h <= endH; h += interval) {
        const date = new Date(now);
        date.setDate(date.getDate() + dayOffset);
        date.setHours(h, startM, 0, 0);
        if (date > now) {
          results.push(date);
          if (results.length >= count) break;
        }
      }
    }
  }

  return results.slice(0, count);
};

const calculateCrontabNextRuns = (crontab: string, count: number) => {
  try {
    const parts = crontab.trim().split(/\s+/);
    if (parts.length < 5) return [];
    const [minute, hour] = parts;
    const results: Date[] = [];
    const now = new Date();

    const parseField = (field: string, max: number) => {
      if (field === '*') return Array.from({ length: max + 1 }, (_, i) => i);
      if (field.includes(',')) return field.split(',').map(Number);
      if (field.includes('-')) {
        const [start, end] = field.split('-').map(Number);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
      if (field.includes('/')) {
        const [, step] = field.split('/');
        const stepValue = Number(step) || 1;
        return Array.from({ length: Math.ceil((max + 1) / stepValue) }, (_, i) => i * stepValue);
      }
      return [Number(field)];
    };

    const minutes = parseField(minute, 59);
    const hours = parseField(hour, 23);

    for (let dayOffset = 0; dayOffset < 7 && results.length < count; dayOffset += 1) {
      for (const h of hours) {
        for (const m of minutes) {
          const date = new Date(now);
          date.setDate(date.getDate() + dayOffset);
          date.setHours(h, m, 0, 0);
          if (date > now) {
            results.push(date);
            if (results.length >= count) break;
          }
        }
        if (results.length >= count) break;
      }
    }

    return results;
  } catch {
    return [];
  }
};

const formatDateTime = (timestamp: number | undefined, locale: string, t: Translator) => {
  if (!timestamp) return t('wakeup.format.none');
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return t('wakeup.format.none');
  return date.toLocaleString(locale, { hour12: false });
};

const formatRunTime = (date: Date, locale: string, t: Translator) => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });

  if (date.toDateString() === now.toDateString()) {
    return t('wakeup.format.today', { time: timeStr });
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return t('wakeup.format.tomorrow', { time: timeStr });
  }
  const weekdayKey = WEEKDAY_KEYS[date.getDay()] || WEEKDAY_KEYS[0];
  return t('wakeup.format.weekdayWithTime', { day: t(`wakeup.weekdays.${weekdayKey}`), time: timeStr });
};

const formatSelectionPreview = (items: string[], maxItems: number, t: Translator) => {
  if (items.length === 0) return t('wakeup.format.notSelected');
  const joiner = t('wakeup.format.joiner');
  if (items.length <= maxItems) return items.join(joiner);
  return t('wakeup.format.moreItems', {
    items: items.slice(0, maxItems).join(joiner),
    total: items.length,
  });
};

const isRecommendedModel = (model: AvailableModel) => {
  if (model.recommended) return true;
  const name = model.displayName || model.id;
  const normalizedName = normalizeModelKey(name);
  const id = model.id || '';
  const modelConstant = model.modelConstant || '';
  if (RECOMMENDED_ID_SET.has(id.toLowerCase()) || RECOMMENDED_ID_SET.has(modelConstant.toLowerCase())) {
    return true;
  }
  if (RECOMMENDED_LABEL_KEYS.has(normalizedName)) {
    return true;
  }
  const normalizedId = normalizeModelKey(id);
  const normalizedConstant = normalizeModelKey(modelConstant);
  return RECOMMENDED_ID_KEYS.has(normalizedId) || RECOMMENDED_ID_KEYS.has(normalizedConstant);
};

const getModelOrderRank = (model: AvailableModel) => {
  const idLower = (model.id || '').toLowerCase();
  const constantLower = (model.modelConstant || '').toLowerCase();
  const normalizedId = normalizeModelKey(model.id || '');
  const normalizedConstant = normalizeModelKey(model.modelConstant || '');
  const normalizedName = normalizeModelKey(model.displayName || model.id);
  return (
    RECOMMENDED_ORDER.get(idLower)
    ?? RECOMMENDED_ORDER.get(constantLower)
    ?? RECOMMENDED_ORDER.get(normalizedId)
    ?? RECOMMENDED_ORDER.get(normalizedConstant)
    ?? RECOMMENDED_ORDER.get(normalizedName)
    ?? Number.MAX_SAFE_INTEGER
  );
};

const sortRecommendedModels = (models: AvailableModel[]) =>
  [...models].sort((a, b) => {
    const rankDiff = getModelOrderRank(a) - getModelOrderRank(b);
    if (rankDiff !== 0) return rankDiff;
    const nameA = a.displayName || a.id;
    const nameB = b.displayName || b.id;
    return nameA.localeCompare(nameB, 'en', { sensitivity: 'base', numeric: true });
  });

const filterAvailableModels = (models: AvailableModel[]) =>
  sortRecommendedModels(
    models.filter((model) => {
      const name = model.displayName || model.id;
      if (BLOCKED_MODEL_IDS.has(model.id) || BLOCKED_DISPLAY_NAMES.has(name)) {
        return false;
      }
      return isRecommendedModel(model);
    })
  );

const buildFallbackModels = (accounts: Account[]): AvailableModel[] => {
  const seen = new Set<string>();
  const models: AvailableModel[] = [];
  accounts.forEach((account) => {
    const quotaModels = account.quota?.models || [];
    quotaModels.forEach((model) => {
      const id = model.name;
      if (!id || seen.has(id)) return;
      seen.add(id);
      models.push({
        id,
        displayName: getReadableModelLabel(id),
        modelConstant: id,
        recommended: isRecommendedModel({ id, displayName: id, modelConstant: id }),
      });
    });
  });
  return models;
};

const getTriggerMode = (task: WakeupTask): TriggerMode => {
  if (task.schedule.wakeOnReset) return 'quota_reset';
  if (task.schedule.crontab) return 'crontab';
  return 'scheduled';
};

export function WakeupTasksPage({ onNavigate }: WakeupPageProps) {
  const { t, i18n } = useTranslation();
  const { accounts, currentAccount, fetchAccounts, fetchCurrentAccount } = useAccountStore();
  const locale = i18n.language || 'zh-CN';
  const [tasks, setTasks] = useState<WakeupTask[]>(() => loadTasks(t('wakeup.defaultTaskName')));
  const [wakeupEnabled, setWakeupEnabled] = useState(() => {
    const raw = localStorage.getItem(WAKEUP_ENABLED_KEY);
    return raw ? raw === 'true' : false;
  });
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone?: NoticeTone } | null>(null);
  const [historyRecords, setHistoryRecords] = useState<WakeupHistoryRecord[]>([]);
  const [testing, setTesting] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showWakeupConfirm, setShowWakeupConfirm] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formTriggerMode, setFormTriggerMode] = useState<TriggerMode>('scheduled');
  const [formRepeatMode, setFormRepeatMode] = useState<RepeatMode>('daily');
  const [formDailyTimes, setFormDailyTimes] = useState<string[]>(['08:00']);
  const [formWeeklyDays, setFormWeeklyDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formWeeklyTimes, setFormWeeklyTimes] = useState<string[]>(['08:00']);
  const [formIntervalHours, setFormIntervalHours] = useState(4);
  const [formIntervalStart, setFormIntervalStart] = useState('07:00');
  const [formIntervalEnd, setFormIntervalEnd] = useState('22:00');
  const [formSelectedModels, setFormSelectedModels] = useState<string[]>([]);
  const [formSelectedAccounts, setFormSelectedAccounts] = useState<string[]>([]);
  const [formCustomPrompt, setFormCustomPrompt] = useState('');
  const [formMaxOutputTokens, setFormMaxOutputTokens] = useState(0);
  const [formCrontab, setFormCrontab] = useState('');
  const [formCrontabError, setFormCrontabError] = useState('');
  const [formError, setFormError] = useState('');
  const [formTimeWindowEnabled, setFormTimeWindowEnabled] = useState(false);
  const [formTimeWindowStart, setFormTimeWindowStart] = useState('09:00');
  const [formTimeWindowEnd, setFormTimeWindowEnd] = useState('18:00');
  const [formFallbackTimes, setFormFallbackTimes] = useState<string[]>(['07:00']);
  const [customDailyTime, setCustomDailyTime] = useState('');
  const [customWeeklyTime, setCustomWeeklyTime] = useState('');
  const [customFallbackTime, setCustomFallbackTime] = useState('');
  const [testSelectedModels, setTestSelectedModels] = useState<string[]>([]);
  const [testSelectedAccounts, setTestSelectedAccounts] = useState<string[]>([]);
  const [testCustomPrompt, setTestCustomPrompt] = useState('');
  const [testMaxOutputTokens, setTestMaxOutputTokens] = useState(0);

  const tasksRef = useRef(tasks);
  const wakeupEnabledRef = useRef(wakeupEnabled);
  const accountEmails = useMemo(() => accounts.map((account) => account.email), [accounts]);
  const accountByEmail = useMemo(() => {
    const map = new Map<string, (typeof accounts)[number]>();
    accounts.forEach((account) => {
      map.set(account.email.toLowerCase(), account);
    });
    return map;
  }, [accounts]);
  const activeAccountEmail = currentAccount?.email || accountEmails[0] || '';

  const filteredModels = useMemo(() => filterAvailableModels(availableModels), [availableModels]);
  const modelById = useMemo(() => {
    const map = new Map<string, AvailableModel>();
    filteredModels.forEach((model) => map.set(model.id, model));
    return map;
  }, [filteredModels]);
  const modelConstantById = useMemo(() => {
    const map = new Map<string, string>();
    filteredModels.forEach((model) => {
      map.set(model.id, model.modelConstant || model.id);
    });
    return map;
  }, [filteredModels]);
  const modelConstantRef = useRef(modelConstantById);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    modelConstantRef.current = modelConstantById;
  }, [modelConstantById]);

  useEffect(() => {
    wakeupEnabledRef.current = wakeupEnabled;
  }, [wakeupEnabled]);

  useEffect(() => {
    fetchAccounts();
    fetchCurrentAccount();
  }, [fetchAccounts, fetchCurrentAccount]);

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    // 触发事件通知设置页面
    window.dispatchEvent(new Event('wakeup-tasks-updated'));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(WAKEUP_ENABLED_KEY, String(wakeupEnabled));
  }, [wakeupEnabled]);

  // 唤醒历史现在由后端存储，组件加载时异步加载
  useEffect(() => {
    loadHistory().then(setHistoryRecords);
  }, []);

  useEffect(() => {
    invoke('set_wakeup_override', { enabled: wakeupEnabled }).catch((error) => {
      console.error('唤醒互斥通知失败:', error);
    });
  }, [wakeupEnabled]);

  useEffect(() => {
    invoke('wakeup_sync_state', { enabled: wakeupEnabled, tasks }).catch((error) => {
      console.error('[WakeupTasks] 同步唤醒任务状态失败:', error);
    });
  }, [tasks, wakeupEnabled]);

  useEffect(() => {
    const handleTaskResult = (event: Event) => {
      const custom = event as CustomEvent<WakeupTaskResultPayload>;
      if (!custom.detail) return;
      const { taskId, lastRunAt, records } = custom.detail;
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, lastRunAt } : task)));
      if (records?.length) {
        loadHistory().then(setHistoryRecords);
      }
    };

    window.addEventListener('wakeup-task-result', handleTaskResult as EventListener);
    return () => {
      window.removeEventListener('wakeup-task-result', handleTaskResult as EventListener);
    };
  }, []);

  useEffect(() => {
    const loadModels = async () => {
      if (accounts.length === 0) {
        setAvailableModels([]);
        setModelsLoading(false);
        return;
      }
      setModelsLoading(true);
      const fallbackModels = filterAvailableModels(buildFallbackModels(accounts));
      try {
        const models = await invoke<AvailableModel[]>('fetch_available_models');
        const filtered = filterAvailableModels(models);
        if (filtered.length > 0) {
          setAvailableModels(filtered);
        } else if (fallbackModels.length > 0) {
          setAvailableModels(fallbackModels);
        } else {
          setAvailableModels([]);
        }
      } catch (error) {
        console.error('获取模型列表失败:', error);
        if (fallbackModels.length > 0) {
          setAvailableModels(fallbackModels);
        } else {
          setNotice({ text: t('wakeup.notice.modelsFetchFailed'), tone: 'warning' });
          setAvailableModels([]);
        }
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, [accounts.length, currentAccount?.id]);

  useEffect(() => {
    if (tasks.length === 0) return;
    if (accountEmails.length === 0 && filteredModels.length === 0) return;

    let changed = false;
    const modelIds = filteredModels.map((model) => model.id);
    const nextTasks = tasks.map((task) => {
      let nextSchedule = normalizeSchedule({ ...DEFAULT_SCHEDULE, ...task.schedule });
      if (accountEmails.length > 0) {
        const nextAccounts = nextSchedule.selectedAccounts.filter((email) =>
          accountEmails.includes(email)
        );
        if (nextAccounts.length === 0) {
          nextAccounts.push(accountEmails[0]);
        }
        if (nextAccounts.join('|') !== nextSchedule.selectedAccounts.join('|')) {
          nextSchedule = { ...nextSchedule, selectedAccounts: nextAccounts };
          changed = true;
        }
      }

      if (modelIds.length > 0) {
        const nextModels = nextSchedule.selectedModels.filter((id) => modelIds.includes(id));
        if (nextModels.length === 0) {
          nextModels.push(modelIds[0]);
        }
        if (nextModels.join('|') !== nextSchedule.selectedModels.join('|')) {
          nextSchedule = { ...nextSchedule, selectedModels: nextModels };
          changed = true;
        }
      }

      if (nextSchedule !== task.schedule) {
        return { ...task, schedule: nextSchedule };
      }
      return task;
    });

    if (changed) {
      setTasks(nextTasks);
    }
  }, [tasks, accountEmails, filteredModels]);

  useEffect(() => {
    if (filteredModels.length === 0) {
      setTestSelectedModels([]);
      return;
    }
    setTestSelectedModels((prev) => {
      const next = prev.filter((id) => filteredModels.some((model) => model.id === id));
      if (next.length === 0) {
        return [filteredModels[0].id];
      }
      return next;
    });
  }, [filteredModels]);

  useEffect(() => {
    if (accountEmails.length === 0) {
      setTestSelectedAccounts([]);
      return;
    }
    setTestSelectedAccounts((prev) => {
      const next = prev.filter((email) => accountEmails.includes(email));
      if (next.length === 0) {
        return [activeAccountEmail || accountEmails[0]];
      }
      return next;
    });
  }, [accountEmails, activeAccountEmail]);

  function appendHistoryRecords(records: WakeupHistoryRecord[]) {
    if (records.length === 0) return;
    setHistoryRecords((prev) => {
      const next = [...records, ...prev];
      next.sort((a, b) => b.timestamp - a.timestamp);
      return next.slice(0, MAX_HISTORY_ITEMS);
    });
  }

  const clearHistoryRecords = () => {
    setHistoryRecords([]);
  };

  const getHistoryModelLabel = (modelId: string) =>
    modelById.get(modelId)?.displayName || getReadableModelLabel(modelId) || modelId;

  const resolveAccounts = (emails: string[]) =>
    emails
      .map((email) => accountByEmail.get(email.toLowerCase()))
      .filter((account): account is (typeof accounts)[number] => Boolean(account));

  const runImmediateTest = async () => {
    if (testing) return;
    const models = testSelectedModels;
    if (models.length === 0) {
      setNotice({ text: t('wakeup.notice.testMissingModel'), tone: 'warning' });
      return;
    }
    const selectedAccounts = resolveAccounts(testSelectedAccounts);
    if (selectedAccounts.length === 0) {
      setNotice({ text: t('wakeup.notice.testMissingAccount'), tone: 'warning' });
      return;
    }

    setTesting(true);
    const trimmedPrompt = testCustomPrompt && testCustomPrompt.trim()
      ? testCustomPrompt.trim()
      : undefined;
    const promptText = trimmedPrompt || DEFAULT_PROMPT;
    const fallbackTokens =
      tasksRef.current.find((task) => task.enabled)?.schedule.maxOutputTokens ?? 0;
    const resolvedMaxTokens = normalizeMaxOutputTokens(testMaxOutputTokens, fallbackTokens);
    const actions: {
      promise: Promise<WakeupInvokeResult>;
      accountEmail: string;
      modelId: string;
      startedAt: number;
    }[] = [];
    selectedAccounts.forEach((account) => {
      models.forEach((model) => {
        actions.push({
          accountEmail: account.email,
          modelId: model,
          startedAt: Date.now(),
          promise: invoke<WakeupInvokeResult>('trigger_wakeup', {
            accountId: account.id,
            model,
            prompt: trimmedPrompt,
            maxOutputTokens: resolvedMaxTokens,
          }),
        });
      });
    });

    const results = await Promise.allSettled(actions.map((action) => action.promise));
    const failed = results.filter((res) => res.status === 'rejected');
    const timestamp = Date.now();
    const historyItems = results.map((result, index) => {
      const action = actions[index];
      let duration = Date.now() - action.startedAt;
      let message: string | undefined;
      if (result.status === 'fulfilled') {
        const value = result.value;
        if (typeof value.durationMs === 'number') {
          duration = value.durationMs;
        }
        message = formatWakeupMessage(action.modelId, value, duration, t);
      } else {
        message = formatErrorMessage(result.reason);
      }
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : `${timestamp}-${index}`,
        timestamp,
        triggerType: 'manual' as HistoryTriggerType,
        triggerSource: 'manual' as HistoryTriggerSource,
        taskName: t('wakeup.runTest'),
        accountEmail: action.accountEmail,
        modelId: action.modelId,
        prompt: promptText,
        success: result.status === 'fulfilled',
        message,
        duration,
      };
    });
    appendHistoryRecords(historyItems);
    setTesting(false);
    setShowTestModal(false);

    if (failed.length > 0) {
      setNotice({ text: t('wakeup.notice.testFailed', { count: failed.length }), tone: 'error' });
    } else {
      setNotice({ text: t('wakeup.notice.testCompleted'), tone: 'success' });
    }
  };

  const describeTask = (task: WakeupTask) => {
    const schedule = task.schedule;
    if (schedule.wakeOnReset) {
      return t('wakeup.format.quotaReset');
    }
    if (schedule.crontab) {
      return t('wakeup.format.crontab', { expr: schedule.crontab });
    }
    if (schedule.repeatMode === 'daily') {
      const times = schedule.dailyTimes.slice(0, 3).join(', ');
      const suffix = schedule.dailyTimes.length > 3 ? '...' : '';
      return t('wakeup.format.daily', { times, suffix });
    }
    if (schedule.repeatMode === 'weekly') {
      const dayLabels = schedule.weeklyDays.map((day) => {
        const key = WEEKDAY_KEYS[day] || WEEKDAY_KEYS[0];
        return t(`wakeup.weekdays.${key}`);
      });
      const days = dayLabels.join(', ');
      const times = schedule.weeklyTimes.slice(0, 3).join(', ');
      const suffix = schedule.weeklyTimes.length > 3 ? '...' : '';
      return t('wakeup.format.weekly', { days, times, suffix });
    }
    return t('wakeup.format.interval', {
      hours: schedule.intervalHours || 4,
      start: schedule.intervalStartTime,
      end: schedule.intervalEndTime,
    });
  };

  const getNextRunLabel = (task: WakeupTask) => {
    const mode = getTriggerMode(task);
    if (mode === 'quota_reset') return t('wakeup.format.none');
    if (mode === 'crontab') {
      const nextRuns = calculateCrontabNextRuns(task.schedule.crontab || '', 1);
      if (!task.schedule.crontab) return t('wakeup.format.none');
      if (nextRuns.length === 0) return t('wakeup.format.invalidCrontab');
      return formatRunTime(nextRuns[0], locale, t);
    }
    const nextRuns = calculateNextRuns(task.schedule, 1);
    if (!nextRuns.length) return t('wakeup.format.none');
    return formatRunTime(nextRuns[0], locale, t);
  };

  const openCreateModal = () => {
    setEditingTaskId(null);
    setFormName(t('wakeup.newTaskName'));
    setFormEnabled(true);
    setFormTriggerMode('scheduled');
    setFormRepeatMode('daily');
    setFormDailyTimes(['08:00']);
    setFormWeeklyDays([1, 2, 3, 4, 5]);
    setFormWeeklyTimes(['08:00']);
    setFormIntervalHours(4);
    setFormIntervalStart('07:00');
    setFormIntervalEnd('22:00');
    setFormSelectedModels(filteredModels.length ? [filteredModels[0].id] : []);
    setFormSelectedAccounts(accountEmails.length ? [accountEmails[0]] : []);
    setFormCustomPrompt('');
    setFormMaxOutputTokens(0);
    setFormCrontab('');
    setFormCrontabError('');
    setFormTimeWindowEnabled(false);
    setFormTimeWindowStart('09:00');
    setFormTimeWindowEnd('18:00');
    setFormFallbackTimes(['07:00']);
    setCustomDailyTime('');
    setCustomWeeklyTime('');
    setCustomFallbackTime('');
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (task: WakeupTask) => {
    const schedule = normalizeSchedule({ ...DEFAULT_SCHEDULE, ...task.schedule });
    const triggerMode = getTriggerMode(task);

    setEditingTaskId(task.id);
    setFormName(task.name);
    setFormEnabled(task.enabled);
    setFormTriggerMode(triggerMode);
    setFormRepeatMode(schedule.repeatMode);
    setFormDailyTimes([...schedule.dailyTimes]);
    setFormWeeklyDays([...schedule.weeklyDays]);
    setFormWeeklyTimes([...schedule.weeklyTimes]);
    setFormIntervalHours(schedule.intervalHours || 4);
    setFormIntervalStart(schedule.intervalStartTime || '07:00');
    setFormIntervalEnd(schedule.intervalEndTime || '22:00');
    setFormSelectedModels(
      schedule.selectedModels.length ? schedule.selectedModels.filter((id) => modelById.has(id)) : []
    );
    setFormSelectedAccounts(
      schedule.selectedAccounts.length ? schedule.selectedAccounts.filter((email) => accountEmails.includes(email)) : []
    );
    setFormCustomPrompt(schedule.customPrompt || '');
    setFormMaxOutputTokens(schedule.maxOutputTokens ?? 0);
    setFormCrontab(schedule.crontab || '');
    setFormCrontabError('');
    setFormTimeWindowEnabled(Boolean(schedule.timeWindowEnabled));
    setFormTimeWindowStart(schedule.timeWindowStart || '09:00');
    setFormTimeWindowEnd(schedule.timeWindowEnd || '18:00');
    setFormFallbackTimes(schedule.fallbackTimes?.length ? [...schedule.fallbackTimes] : ['07:00']);
    setCustomDailyTime('');
    setCustomWeeklyTime('');
    setCustomFallbackTime('');
    setFormError('');
    setShowModal(true);
  };

  const toggleListValue = (
    list: string[],
    value: string,
    options?: { allowEmpty?: boolean }
  ) => {
    if (list.includes(value)) {
      const next = list.filter((item) => item !== value);
      if (next.length === 0 && !options?.allowEmpty) return list;
      return next;
    }
    return [...list, value];
  };

  const toggleTimeSelection = (time: string, mode: 'daily' | 'weekly' | 'fallback') => {
    if (mode === 'daily') {
      setFormDailyTimes((prev) => toggleListValue(prev, time).sort());
      return;
    }
    if (mode === 'weekly') {
      setFormWeeklyTimes((prev) => toggleListValue(prev, time).sort());
      return;
    }
    setFormFallbackTimes((prev) => toggleListValue(prev, time).sort());
  };

  const addCustomTime = (value: string, mode: 'daily' | 'weekly' | 'fallback') => {
    const normalized = normalizeTimeInput(value);
    if (!normalized) return;
    if (mode === 'daily') {
      setFormDailyTimes((prev) => Array.from(new Set([...prev, normalized])).sort());
    } else if (mode === 'weekly') {
      setFormWeeklyTimes((prev) => Array.from(new Set([...prev, normalized])).sort());
    } else {
      setFormFallbackTimes((prev) => Array.from(new Set([...prev, normalized])).sort());
    }
  };

  const toggleDaySelection = (day: number) => {
    setFormWeeklyDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== day);
      }
      return [...prev, day];
    });
  };

  const applyQuickDays = (preset: 'workdays' | 'weekend' | 'all') => {
    if (preset === 'workdays') setFormWeeklyDays([1, 2, 3, 4, 5]);
    if (preset === 'weekend') setFormWeeklyDays([0, 6]);
    if (preset === 'all') setFormWeeklyDays([0, 1, 2, 3, 4, 5, 6]);
  };

  const normalizeMaxOutputTokens = (value?: number, fallback: number = 0) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0) {
      return Math.floor(fallback);
    }
    return 0;
  };

  /**
   * 确保配额刷新间隔满足最小要求
   * 用于配额重置模式，确保数据足够实时
   */
  const ensureMinRefreshInterval = async (minMinutes: number) => {
    try {
      const config = await invoke<any>('get_general_config');
      
      // 如果刷新间隔大于最小值（或禁用），自动调整
      if (config.auto_refresh_minutes < 0 || config.auto_refresh_minutes > minMinutes) {
        const oldValue = config.auto_refresh_minutes;
        
        // 更新配置
        await invoke('save_general_config', {
          language: config.language,
          theme: config.theme,
          autoRefreshMinutes: minMinutes,
          codexAutoRefreshMinutes: config.codex_auto_refresh_minutes ?? 10,
          closeBehavior: config.close_behavior || 'ask',
          opencodeAppPath: config.opencode_app_path ?? '',
          antigravityAppPath: config.antigravity_app_path ?? '',
          codexAppPath: config.codex_app_path ?? '',
          vscodeAppPath: config.vscode_app_path ?? '',
          opencodeSyncOnSwitch: config.opencode_sync_on_switch ?? true,
        });
        
        // 触发配置更新事件（让 useAutoRefresh 重新设置定时器）
        window.dispatchEvent(new Event('config-updated'));
        
        // 通知用户
        const oldText = oldValue < 0 ? t('wakeup.refreshInterval.disabled') : `${oldValue} ${t('wakeup.refreshInterval.minutes')}`;
        const newText = `${minMinutes} ${t('wakeup.refreshInterval.minutes')}`;
        
        setNotice({
          text: t('wakeup.notice.refreshIntervalAdjusted', { old: oldText, new: newText }),
          tone: 'success',
        });
      }
    } catch (error) {
      console.error('[WakeupTasks] 调整刷新间隔失败:', error);
    }
  };

  const handleSaveTask = async () => {
    const name = formName.trim();
    if (!name) {
      setFormError(t('wakeup.notice.nameRequired'));
      return;
    }
    if (formSelectedAccounts.length === 0) {
      setFormError(t('wakeup.notice.accountRequired'));
      return;
    }
    if (formSelectedModels.length === 0) {
      setFormError(t('wakeup.notice.modelRequired'));
      return;
    }
    if (formTriggerMode === 'crontab' && !formCrontab.trim()) {
      setFormCrontabError(t('wakeup.notice.crontabRequired'));
      return;
    }

    const schedule = normalizeSchedule({
      ...DEFAULT_SCHEDULE,
      repeatMode: formRepeatMode,
      dailyTimes: formDailyTimes,
      weeklyDays: formWeeklyDays,
      weeklyTimes: formWeeklyTimes,
      intervalHours: formIntervalHours,
      intervalStartTime: formIntervalStart,
      intervalEndTime: formIntervalEnd,
      selectedModels: formSelectedModels,
      selectedAccounts: formSelectedAccounts,
      crontab: formTriggerMode === 'crontab' ? formCrontab.trim() : undefined,
      wakeOnReset: formTriggerMode === 'quota_reset',
      customPrompt: formCustomPrompt.trim() || undefined,
      maxOutputTokens: normalizeMaxOutputTokens(formMaxOutputTokens, 0),
      timeWindowEnabled: formTriggerMode === 'quota_reset' ? formTimeWindowEnabled : false,
      timeWindowStart:
        formTriggerMode === 'quota_reset' && formTimeWindowEnabled
          ? formTimeWindowStart
          : undefined,
      timeWindowEnd:
        formTriggerMode === 'quota_reset' && formTimeWindowEnabled
          ? formTimeWindowEnd
          : undefined,
      fallbackTimes:
        formTriggerMode === 'quota_reset' && formTimeWindowEnabled
          ? formFallbackTimes
          : undefined,
    });

    const now = Date.now();
    const baseTask: WakeupTask = {
      id: editingTaskId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      name,
      enabled: formEnabled,
      createdAt: editingTaskId
        ? tasksRef.current.find((task) => task.id === editingTaskId)?.createdAt || now
        : now,
      lastRunAt: editingTaskId
        ? tasksRef.current.find((task) => task.id === editingTaskId)?.lastRunAt
        : undefined,
      schedule,
    };

    setTasks((prev) => {
      const exists = prev.some((task) => task.id === baseTask.id);
      if (exists) {
        return prev.map((task) => (task.id === baseTask.id ? baseTask : task));
      }
      return [baseTask, ...prev];
    });

    // 如果启用了配额重置模式，确保刷新间隔满足最小要求
    if (formEnabled && formTriggerMode === 'quota_reset') {
      await ensureMinRefreshInterval(2);
    }

    setShowModal(false);
    setNotice({ text: t('wakeup.notice.taskSaved', { name }), tone: 'success' });
  };

  const openTestModal = () => {
    setShowTestModal(true);
  };

  const openHistoryModal = () => {
    setShowHistoryModal(true);
  };

  const handleDeleteTask = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const confirmed = await confirmDialog(t('wakeup.dialogs.deleteConfirm', { name: task.name }));
    if (!confirmed) return;
    setTasks((prev) => prev.filter((item) => item.id !== taskId));
  };

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, enabled: !task.enabled } : task
      )
    );
  };

  const handleToggleWakeup = (event?: React.MouseEvent) => {
    event?.preventDefault();
    if (!wakeupEnabled) {
      setShowWakeupConfirm(true);
      return;
    }
    setWakeupEnabled(false);
    setNotice({ text: t('wakeup.notice.featureOff') });
  };

  const confirmEnableWakeup = () => {
    setShowWakeupConfirm(false);
    if (wakeupEnabled) return;
    setWakeupEnabled(true);
    setNotice({ text: t('wakeup.notice.featureOn') });
  };

  const previewSchedule = useMemo(() => {
    if (formTriggerMode !== 'scheduled') return [];
    const config = normalizeSchedule({
      ...DEFAULT_SCHEDULE,
      repeatMode: formRepeatMode,
      dailyTimes: formDailyTimes,
      weeklyDays: formWeeklyDays,
      weeklyTimes: formWeeklyTimes,
      intervalHours: formIntervalHours,
      intervalStartTime: formIntervalStart,
      intervalEndTime: formIntervalEnd,
    });
    return calculateNextRuns(config, 5);
  }, [
    formTriggerMode,
    formRepeatMode,
    formDailyTimes,
    formWeeklyDays,
    formWeeklyTimes,
    formIntervalHours,
    formIntervalStart,
    formIntervalEnd,
  ]);

  const previewCrontab = useMemo(() => {
    if (formTriggerMode !== 'crontab') return [];
    if (!formCrontab.trim()) return [];
    return calculateCrontabNextRuns(formCrontab, 5);
  }, [formTriggerMode, formCrontab]);

  const triggerSourceLabel = (source: HistoryTriggerSource) => {
    switch (source) {
      case 'scheduled':
        return t('wakeup.triggerSource.scheduled');
      case 'crontab':
        return t('wakeup.triggerSource.crontab');
      case 'quota_reset':
        return t('wakeup.triggerSource.quotaReset');
      case 'manual':
        return t('wakeup.triggerSource.manual');
      default:
        return t('wakeup.triggerSource.unknown');
    }
  };

  return (
    <main className="main-content wakeup-page">
      <OverviewTabsHeader
        active="wakeup"
        onNavigate={onNavigate}
        subtitle={t('wakeup.subtitle')}
      />
      <div className="toolbar">
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={16} /> {t('wakeup.newTask')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={openTestModal}
          >
            {t('wakeup.runTest')}
          </button>
          <button className="btn btn-secondary" onClick={openHistoryModal}>
            {historyRecords.length > 0
              ? t('wakeup.historyCount', { count: historyRecords.length })
              : t('wakeup.history')}
          </button>
          <div className="wakeup-global-toggle">
            <span className="toggle-label">{t('wakeup.globalToggle')}</span>
            <label className="wakeup-switch" onClick={handleToggleWakeup}>
              <input type="checkbox" checked={wakeupEnabled} readOnly />
              <span className="wakeup-slider" />
            </label>
          </div>
          {accounts.length === 0 && (
            <button className="btn btn-secondary" onClick={() => onNavigate?.('overview')}>
              {t('wakeup.gotoAddAccount')}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`action-message${notice.tone ? ` ${notice.tone}` : ''}`}>
          <span className="action-message-text">{notice.text}</span>
          <button className="action-message-close" onClick={() => setNotice(null)} aria-label={t('common.close')}>
            <X size={14} />
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <Power size={40} />
          </div>
          <h3>{t('wakeup.emptyTitle')}</h3>
          <p>{t('wakeup.emptyDesc')}</p>
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={18} /> {t('wakeup.newTask')}
          </button>
        </div>
      ) : (
        <div className="wakeup-task-grid">
          {tasks.map((task) => {
            const modelLabels = task.schedule.selectedModels.map(
              (id) => modelById.get(id)?.displayName || getReadableModelLabel(id)
            );
            const accountLabels = task.schedule.selectedAccounts;
            return (
              <div
                key={task.id}
                className={`wakeup-task-card ${task.enabled ? '' : 'is-disabled'}`}
              >
                <div className="wakeup-task-header">
                  <div className="wakeup-task-title">
                    <span>{task.name}</span>
                    {task.enabled ? (
                      <span className="pill pill-success">{t('wakeup.statusEnabled')}</span>
                    ) : (
                      <span className="pill pill-secondary">{t('wakeup.statusDisabled')}</span>
                    )}
                  </div>
                  <div className="wakeup-task-actions">
                    <button
                      className="btn btn-secondary icon-only"
                      onClick={() => openEditModal(task)}
                      title={t('wakeup.edit')}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn btn-secondary icon-only"
                      onClick={() => handleToggleTask(task.id)}
                      title={task.enabled ? t('wakeup.statusDisabled') : t('wakeup.statusEnabled')}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      className="btn btn-danger icon-only"
                      onClick={() => handleDeleteTask(task.id)}
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="wakeup-task-meta">
                  <span>{describeTask(task)}</span>
                </div>
                <div className="wakeup-task-meta">
                  <span>{t('wakeup.taskCard.accountsCount', { count: task.schedule.selectedAccounts.length })}</span>
                  <span>{t('wakeup.taskCard.modelsCount', { count: task.schedule.selectedModels.length })}</span>
                </div>
                <div className="wakeup-task-meta">
                  <span>
                    {t('wakeup.taskCard.accountsLabel', {
                      preview: formatSelectionPreview(accountLabels, 2, t),
                    })}
                  </span>
                  <span>
                    {t('wakeup.taskCard.modelsLabel', {
                      preview: formatSelectionPreview(modelLabels, 2, t),
                    })}
                  </span>
                </div>
                <div className="wakeup-task-meta">
                  <span>
                    {t('wakeup.taskCard.lastRun', { time: formatDateTime(task.lastRunAt, locale, t) })}
                  </span>
                  <span>{t('wakeup.taskCard.nextRun', { time: getNextRunLabel(task) })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showWakeupConfirm && (
        <div className="modal-overlay" onClick={() => setShowWakeupConfirm(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('wakeup.dialogs.enableTitle')}</h2>
              <button
                className="modal-close"
                onClick={() => setShowWakeupConfirm(false)}
                aria-label={t('common.close', '关闭')}
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('wakeup.dialogs.enableDesc')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowWakeupConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={confirmEnableWakeup}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTestModal && (
        <div className="modal-overlay" onClick={() => setShowTestModal(false)}>
          <div
            className="modal wakeup-modal wakeup-test-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{t('wakeup.dialogs.testTitle')}</h2>
              <button
                className="modal-close"
                onClick={() => setShowTestModal(false)}
                aria-label={t('common.close', '关闭')}
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <div className="wakeup-form-group">
                <label>{t('wakeup.test.modelsLabel')}</label>
                <div className="wakeup-chip-list">
                  {modelsLoading && <span className="wakeup-hint">{t('common.loading')}</span>}
                  {!modelsLoading && filteredModels.length === 0 && (
                    <span className="wakeup-hint">{t('wakeup.form.modelsEmpty')}</span>
                  )}
                  {!modelsLoading &&
                    filteredModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`wakeup-chip ${testSelectedModels.includes(model.id) ? 'selected' : ''}`}
                        onClick={() =>
                          setTestSelectedModels((prev) => toggleListValue(prev, model.id, { allowEmpty: true }))
                        }
                      >
                        {model.displayName}
                      </button>
                    ))}
                </div>
              </div>
              <div className="wakeup-form-group">
                <label>{t('wakeup.test.accountsLabel')}</label>
                <p className="wakeup-hint">{t('wakeup.test.accountsHint')}</p>
                <div className="wakeup-chip-list">
                  {accountEmails.length === 0 && <span className="wakeup-hint">{t('wakeup.form.accountsEmpty')}</span>}
                  {accountEmails.map((email) => (
                    <button
                      key={email}
                      type="button"
                      className={`wakeup-chip ${testSelectedAccounts.includes(email) ? 'selected' : ''}`}
                      onClick={() =>
                        setTestSelectedAccounts((prev) => toggleListValue(prev, email, { allowEmpty: true }))
                      }
                    >
                      {email}
                    </button>
                  ))}
                </div>
              </div>
              <div className="wakeup-form-group">
                <label>{t('wakeup.form.customPrompt')}</label>
                <input
                  className="wakeup-input"
                  value={testCustomPrompt}
                  onChange={(event) => setTestCustomPrompt(event.target.value)}
                  placeholder={t('wakeup.form.promptPlaceholder', { word: DEFAULT_PROMPT })}
                  maxLength={100}
                />
                <p className="wakeup-hint">{t('wakeup.form.promptHint', { word: DEFAULT_PROMPT })}</p>
              </div>
              <div className="wakeup-form-group">
                <label>{t('wakeup.form.maxTokens')}</label>
                <input
                  className="wakeup-input wakeup-input-small"
                  type="number"
                  min={0}
                  value={testMaxOutputTokens}
                  onChange={(event) => setTestMaxOutputTokens(Number(event.target.value))}
                />
                <p className="wakeup-hint">{t('wakeup.form.maxTokensHint')}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowTestModal(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={runImmediateTest}
                disabled={testing || filteredModels.length === 0 || accountEmails.length === 0}
              >
                {testing ? t('wakeup.test.testing') : t('wakeup.test.start')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div
            className="modal wakeup-modal wakeup-history-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{t('wakeup.dialogs.historyTitle')}</h2>
              <button
                className="modal-close"
                onClick={() => setShowHistoryModal(false)}
                aria-label={t('common.close', '关闭')}
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              {historyRecords.length === 0 ? (
                <p className="wakeup-hint">{t('wakeup.historyEmpty')}</p>
              ) : (
                <ul className="wakeup-history-list">
                  {historyRecords.map((record) => (
                    <li
                      key={record.id}
                      className={`wakeup-history-item ${record.success ? 'is-success' : 'is-failed'}`}
                    >
                      <div className="wakeup-history-main">
                        <span className="wakeup-history-status">
                          {record.success ? t('common.success') : t('common.failed')}
                        </span>
                        <span className="wakeup-history-time">
                          {formatDateTime(record.timestamp, locale, t)}
                        </span>
                        <span className={`wakeup-history-badge ${record.triggerType}`}>
                          {triggerSourceLabel(record.triggerSource)}
                        </span>
                        {record.taskName && (
                          <span className="wakeup-history-task">{record.taskName}</span>
                        )}
                      </div>
                      <div className="wakeup-history-meta">
                        <span>{getHistoryModelLabel(record.modelId)}</span>
                        <span>{record.accountEmail}</span>
                        {record.duration ? <span>{record.duration}ms</span> : null}
                      </div>
                      {record.prompt && (
                        <div className="wakeup-history-prompt">
                          {t('wakeup.historyPromptLabel', { prompt: record.prompt })}
                        </div>
                      )}
                      {record.message && (
                        <div className="wakeup-history-message">{record.message}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowHistoryModal(false)}>
                {t('common.close')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={clearHistoryRecords}
                disabled={historyRecords.length === 0}
              >
                {t('wakeup.historyClear')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg wakeup-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTaskId ? t('wakeup.dialogs.taskTitleEdit') : t('wakeup.dialogs.taskTitleNew')}</h2>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
                aria-label={t('common.close', '关闭')}
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <div className="wakeup-form-group">
                <label>{t('wakeup.form.taskName')}</label>
                <input
                  className="wakeup-input"
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                />
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.taskStatus')}</label>
                <div className="wakeup-toggle-group">
                  <button
                    className={`btn btn-secondary ${formEnabled ? 'is-active' : ''}`}
                    onClick={() => setFormEnabled(true)}
                  >
                    {t('common.enable')}
                  </button>
                  <button
                    className={`btn btn-secondary ${!formEnabled ? 'is-active' : ''}`}
                    onClick={() => setFormEnabled(false)}
                  >
                    {t('common.disable')}
                  </button>
                </div>
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.triggerMode')}</label>
                <p className="wakeup-hint">
                  {t('wakeup.form.triggerModeHint')}
                </p>
                <div className="wakeup-segmented">
                  <button
                    type="button"
                    className={`wakeup-segment-btn ${formTriggerMode === 'scheduled' ? 'active' : ''}`}
                    onClick={() => setFormTriggerMode('scheduled')}
                  >
                    {t('wakeup.form.modeScheduled')}
                  </button>
                  <button
                    type="button"
                    className={`wakeup-segment-btn ${formTriggerMode === 'crontab' ? 'active' : ''}`}
                    onClick={() => setFormTriggerMode('crontab')}
                  >
                    {t('wakeup.form.modeCrontab')}
                  </button>
                  <button
                    type="button"
                    className={`wakeup-segment-btn ${formTriggerMode === 'quota_reset' ? 'active' : ''}`}
                    onClick={() => setFormTriggerMode('quota_reset')}
                  >
                    {t('wakeup.form.modeQuotaReset')}
                  </button>
                </div>
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.modelSelect')}</label>
                <p className="wakeup-hint">{t('wakeup.form.modelHint')}</p>
                <div className="wakeup-chip-list">
                  {modelsLoading && <span className="wakeup-hint">{t('common.loading')}</span>}
                  {!modelsLoading && filteredModels.length === 0 && (
                    <span className="wakeup-hint">{t('wakeup.form.modelsEmpty')}</span>
                  )}
                  {!modelsLoading &&
                    filteredModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`wakeup-chip ${formSelectedModels.includes(model.id) ? 'selected' : ''}`}
                        onClick={() =>
                          setFormSelectedModels((prev) => toggleListValue(prev, model.id, { allowEmpty: true }))
                        }
                      >
                        {model.displayName}
                      </button>
                    ))}
                </div>
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.accountSelect')}</label>
                <p className="wakeup-hint">{t('wakeup.form.accountHint')}</p>
                <div className="wakeup-chip-list">
                  {accountEmails.length === 0 && <span className="wakeup-hint">{t('wakeup.form.accountsEmpty')}</span>}
                  {accountEmails.map((email) => (
                    <button
                      key={email}
                      type="button"
                      className={`wakeup-chip ${formSelectedAccounts.includes(email) ? 'selected' : ''}`}
                      onClick={() =>
                        setFormSelectedAccounts((prev) => toggleListValue(prev, email, { allowEmpty: true }))
                      }
                    >
                      {email}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.customPrompt')}</label>
                <input
                  className="wakeup-input"
                  value={formCustomPrompt}
                  onChange={(event) => setFormCustomPrompt(event.target.value)}
                  placeholder={t('wakeup.form.promptPlaceholder', { word: DEFAULT_PROMPT })}
                  maxLength={100}
                />
                <p className="wakeup-hint">{t('wakeup.form.promptHint', { word: DEFAULT_PROMPT })}</p>
              </div>

              <div className="wakeup-form-group">
                <label>{t('wakeup.form.maxTokens')}</label>
                <input
                  className="wakeup-input wakeup-input-small"
                  type="number"
                  min={0}
                  value={formMaxOutputTokens}
                  onChange={(event) => setFormMaxOutputTokens(Number(event.target.value))}
                />
                <p className="wakeup-hint">{t('wakeup.form.maxTokensHint')}</p>
              </div>

              {formTriggerMode === 'scheduled' && (
                <div className="wakeup-mode-panel">
                  <div className="wakeup-form-group">
                    <label>{t('wakeup.form.repeatMode')}</label>
                    <select
                      className="wakeup-input"
                      value={formRepeatMode}
                      onChange={(event) => setFormRepeatMode(event.target.value as RepeatMode)}
                    >
                      <option value="daily">{t('wakeup.form.repeatDaily')}</option>
                      <option value="weekly">{t('wakeup.form.repeatWeekly')}</option>
                      <option value="interval">{t('wakeup.form.repeatInterval')}</option>
                    </select>
                  </div>

                  {formRepeatMode === 'daily' && (
                    <div className="wakeup-form-group">
                      <label>{t('wakeup.form.selectTime')}</label>
                      <div className="wakeup-chip-grid">
                        {BASE_TIME_OPTIONS.map((time) => (
                          <button
                            key={time}
                            type="button"
                            className={`wakeup-chip ${formDailyTimes.includes(time) ? 'selected' : ''}`}
                            onClick={() => toggleTimeSelection(time, 'daily')}
                          >
                            {time}
                          </button>
                        ))}
                        {formDailyTimes
                          .filter((time) => !BASE_TIME_OPTIONS.includes(time))
                          .map((time) => (
                            <button
                              key={time}
                              type="button"
                              className={`wakeup-chip selected`}
                              onClick={() => toggleTimeSelection(time, 'daily')}
                            >
                              {time}
                            </button>
                          ))}
                      </div>
                      <div className="wakeup-custom-row">
                        <span>{t('wakeup.form.customTime')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={customDailyTime}
                          onChange={(event) => setCustomDailyTime(event.target.value)}
                        />
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            addCustomTime(customDailyTime, 'daily');
                            setCustomDailyTime('');
                          }}
                        >
                          {t('common.add')}
                        </button>
                      </div>
                    </div>
                  )}

                  {formRepeatMode === 'weekly' && (
                    <div className="wakeup-form-group">
                      <label>{t('wakeup.form.selectWeekday')}</label>
                      <div className="wakeup-chip-grid">
                        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                          <button
                            key={day}
                            type="button"
                            className={`wakeup-chip ${formWeeklyDays.includes(day) ? 'selected' : ''}`}
                            onClick={() => toggleDaySelection(day)}
                          >
                            {t(`wakeup.weekdays.${WEEKDAY_KEYS[day]}`)}
                          </button>
                        ))}
                      </div>
                      <div className="wakeup-quick-actions">
                        <button className="btn btn-secondary" onClick={() => applyQuickDays('workdays')}>
                          {t('wakeup.form.quickWorkdays')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => applyQuickDays('weekend')}>
                          {t('wakeup.form.quickWeekend')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => applyQuickDays('all')}>
                          {t('wakeup.form.quickAll')}
                        </button>
                      </div>
                      <label>{t('wakeup.form.selectTime')}</label>
                      <div className="wakeup-chip-grid">
                        {BASE_TIME_OPTIONS.map((time) => (
                          <button
                            key={time}
                            type="button"
                            className={`wakeup-chip ${formWeeklyTimes.includes(time) ? 'selected' : ''}`}
                            onClick={() => toggleTimeSelection(time, 'weekly')}
                          >
                            {time}
                          </button>
                        ))}
                        {formWeeklyTimes
                          .filter((time) => !BASE_TIME_OPTIONS.includes(time))
                          .map((time) => (
                            <button
                              key={time}
                              type="button"
                              className="wakeup-chip selected"
                              onClick={() => toggleTimeSelection(time, 'weekly')}
                            >
                              {time}
                            </button>
                          ))}
                      </div>
                      <div className="wakeup-custom-row">
                        <span>{t('wakeup.form.customTime')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={customWeeklyTime}
                          onChange={(event) => setCustomWeeklyTime(event.target.value)}
                        />
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            addCustomTime(customWeeklyTime, 'weekly');
                            setCustomWeeklyTime('');
                          }}
                        >
                          {t('common.add')}
                        </button>
                      </div>
                    </div>
                  )}

                  {formRepeatMode === 'interval' && (
                    <div className="wakeup-form-group">
                      <label>{t('wakeup.form.intervalSetting')}</label>
                      <div className="wakeup-inline-row">
                        <span>{t('wakeup.form.intervalEvery')}</span>
                        <input
                          className="wakeup-input wakeup-input-small"
                          type="number"
                          min={1}
                          max={12}
                          value={formIntervalHours}
                          onChange={(event) => setFormIntervalHours(Number(event.target.value))}
                        />
                        <span>{t('wakeup.form.intervalHours')}</span>
                      </div>
                      <div className="wakeup-inline-row">
                        <span>{t('wakeup.form.intervalStart')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={formIntervalStart}
                          onChange={(event) => setFormIntervalStart(event.target.value)}
                        />
                        <span>{t('wakeup.form.intervalEnd')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={formIntervalEnd}
                          onChange={(event) => setFormIntervalEnd(event.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="wakeup-form-group">
                    <label>{t('wakeup.form.nextRuns')}</label>
                    <ul className="wakeup-preview-list">
                      {previewSchedule.length === 0 && <li>{t('wakeup.form.nextRunsEmpty')}</li>}
                      {previewSchedule.map((date, idx) => (
                        <li key={`${date.toISOString()}-${idx}`}>
                          {idx + 1}. {formatRunTime(date, locale, t)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {formTriggerMode === 'crontab' && (
                <div className="wakeup-mode-panel">
                  <div className="wakeup-form-group">
                    <label>{t('wakeup.form.crontab')}</label>
                    <div className="wakeup-cron-row">
                      <input
                        className="wakeup-input"
                        value={formCrontab}
                        onChange={(event) => {
                          setFormCrontab(event.target.value);
                          setFormCrontabError('');
                        }}
                        placeholder={t('wakeup.form.crontabPlaceholder')}
                      />
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          if (!formCrontab.trim()) {
                            setFormCrontabError(t('wakeup.notice.crontabRequired'));
                          } else {
                            setFormCrontabError(t('wakeup.form.crontabValidateHint'));
                          }
                        }}
                      >
                        {t('wakeup.form.crontabValidate')}
                      </button>
                    </div>
                    {formCrontabError && <p className="wakeup-hint">{formCrontabError}</p>}
                  </div>
                  <div className="wakeup-form-group">
                    <label>{t('wakeup.form.nextRuns')}</label>
                    <ul className="wakeup-preview-list">
                      {previewCrontab.length === 0 && <li>{t('wakeup.form.crontabPreviewEmpty')}</li>}
                      {previewCrontab.map((date, idx) => (
                        <li key={`${date.toISOString()}-${idx}`}>
                          {idx + 1}. {formatRunTime(date, locale, t)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {formTriggerMode === 'quota_reset' && (
                <div className="wakeup-mode-panel">
                  <div className="wakeup-form-group">
                    <div className="wakeup-form-row">
                      <label>{t('wakeup.form.timeWindowEnabled')}</label>
                      <label className="wakeup-switch">
                        <input
                          type="checkbox"
                          checked={formTimeWindowEnabled}
                          onChange={(event) => setFormTimeWindowEnabled(event.target.checked)}
                        />
                        <span className="wakeup-slider" />
                      </label>
                    </div>
                    <p className="wakeup-hint">
                      {t('wakeup.form.timeWindowHint')}
                    </p>
                  </div>

                  {formTimeWindowEnabled && (
                    <div className="wakeup-form-group">
                      <label>{t('wakeup.form.timeWindow')}</label>
                      <div className="wakeup-inline-row">
                        <span>{t('wakeup.form.timeWindowFrom')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={formTimeWindowStart}
                          onChange={(event) => setFormTimeWindowStart(event.target.value)}
                        />
                        <span>{t('wakeup.form.timeWindowTo')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={formTimeWindowEnd}
                          onChange={(event) => setFormTimeWindowEnd(event.target.value)}
                        />
                      </div>
                      <label>{t('wakeup.form.fallbackTimes')}</label>
                      <div className="wakeup-chip-grid">
                        {['06:00', '07:00', '08:00'].map((time) => (
                          <button
                            key={time}
                            type="button"
                            className={`wakeup-chip ${formFallbackTimes.includes(time) ? 'selected' : ''}`}
                            onClick={() => toggleTimeSelection(time, 'fallback')}
                          >
                            {time}
                          </button>
                        ))}
                        {formFallbackTimes
                          .filter((time) => !['06:00', '07:00', '08:00'].includes(time))
                          .map((time) => (
                            <button
                              key={time}
                              type="button"
                              className="wakeup-chip selected"
                              onClick={() => toggleTimeSelection(time, 'fallback')}
                            >
                              {time}
                            </button>
                          ))}
                      </div>
                      <div className="wakeup-custom-row">
                        <span>{t('wakeup.form.customTime')}</span>
                        <input
                          className="wakeup-input wakeup-input-time"
                          type="time"
                          value={customFallbackTime}
                          onChange={(event) => setCustomFallbackTime(event.target.value)}
                        />
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            addCustomTime(customFallbackTime, 'fallback');
                            setCustomFallbackTime('');
                          }}
                        >
                          {t('common.add')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {formError && (
                <div className="form-error-message" style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: 6, fontSize: 13 }}>
                  {formError}
                </div>
              )}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  {t('common.cancel')}
                </button>
                <button className="btn btn-primary" onClick={handleSaveTask}>
                  {t('wakeup.form.saveTask')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

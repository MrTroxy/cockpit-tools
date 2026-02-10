import { create } from 'zustand';
import { InstanceDefaults, InstanceInitMode, InstanceProfile } from '../types/instance';

export type InstanceStoreState = {
  instances: InstanceProfile[];
  defaults: InstanceDefaults | null;
  loading: boolean;
  error: string | null;
  fetchInstances: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  fetchDefaults: () => Promise<void>;
  createInstance: (payload: {
    name: string;
    userDataDir: string;
    extraArgs?: string;
    bindAccountId?: string | null;
    copySourceInstanceId: string;
    initMode?: InstanceInitMode;
  }) => Promise<InstanceProfile>;
  updateInstance: (payload: {
    instanceId: string;
    name?: string;
    extraArgs?: string;
    bindAccountId?: string | null;
    followLocalAccount?: boolean;
  }) => Promise<InstanceProfile>;
  deleteInstance: (instanceId: string) => Promise<void>;
  startInstance: (instanceId: string) => Promise<InstanceProfile>;
  stopInstance: (instanceId: string) => Promise<InstanceProfile>;
  forceStopInstance: (instanceId: string) => Promise<InstanceProfile>;
  closeAllInstances: () => Promise<void>;
  openInstanceWindow: (instanceId: string) => Promise<void>;
};

type InstanceService = {
  getInstanceDefaults: () => Promise<InstanceDefaults>;
  listInstances: () => Promise<InstanceProfile[]>;
  createInstance: (payload: {
    name: string;
    userDataDir: string;
    extraArgs?: string;
    bindAccountId?: string | null;
    copySourceInstanceId: string;
    initMode?: InstanceInitMode;
  }) => Promise<InstanceProfile>;
  updateInstance: (payload: {
    instanceId: string;
    name?: string;
    extraArgs?: string;
    bindAccountId?: string | null;
    followLocalAccount?: boolean;
  }) => Promise<InstanceProfile>;
  deleteInstance: (instanceId: string) => Promise<void>;
  startInstance: (instanceId: string) => Promise<InstanceProfile>;
  stopInstance: (instanceId: string) => Promise<InstanceProfile>;
  forceStopInstance: (instanceId: string) => Promise<InstanceProfile>;
  closeAllInstances: () => Promise<void>;
  openInstanceWindow: (instanceId: string) => Promise<void>;
};

export function createInstanceStore(
  service: InstanceService,
  cacheKey: string,
  legacyCacheKeys: string[] = []
) {
  const parseCachedInstances = (raw: string | null) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as InstanceProfile[]) : [];
    } catch {
      return [];
    }
  };

  const loadCachedInstances = () => {
    try {
      const current = parseCachedInstances(localStorage.getItem(cacheKey));
      if (current !== null) return current;

      for (const legacyKey of legacyCacheKeys) {
        const legacyRaw = localStorage.getItem(legacyKey);
        const legacyParsed = parseCachedInstances(legacyRaw);
        if (legacyParsed !== null) {
          localStorage.setItem(cacheKey, legacyRaw!);
          localStorage.removeItem(legacyKey);
          return legacyParsed;
        }
      }
      return [];
    } catch {
      return [];
    }
  };

  const persistInstancesCache = (instances: InstanceProfile[]) => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(instances));
      for (const legacyKey of legacyCacheKeys) {
        if (legacyKey !== cacheKey) {
          localStorage.removeItem(legacyKey);
        }
      }
    } catch {
      // ignore cache write failures
    }
  };

  return create<InstanceStoreState>((set, get) => ({
    instances: loadCachedInstances(),
    defaults: null,
    loading: false,
    error: null,

    fetchInstances: async () => {
      set({ loading: true, error: null });
      try {
        const instances = await service.listInstances();
        set({ instances, loading: false });
        persistInstancesCache(instances);
      } catch (e) {
        set({ error: String(e), loading: false });
      }
    },

    refreshInstances: async () => {
      set({ error: null });
      try {
        const instances = await service.listInstances();
        set({ instances });
        persistInstancesCache(instances);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    fetchDefaults: async () => {
      try {
        const defaults = await service.getInstanceDefaults();
        set({ defaults });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    createInstance: async (payload) => {
      const instance = await service.createInstance(payload);
      await get().fetchInstances();
      return instance;
    },

    updateInstance: async (payload) => {
      const instance = await service.updateInstance(payload);
      await get().fetchInstances();
      return instance;
    },

    deleteInstance: async (instanceId) => {
      await service.deleteInstance(instanceId);
      await get().fetchInstances();
    },

    startInstance: async (instanceId) => {
      const instance = await service.startInstance(instanceId);
      await get().fetchInstances();
      return instance;
    },

    stopInstance: async (instanceId) => {
      const instance = await service.stopInstance(instanceId);
      await get().fetchInstances();
      return instance;
    },

    forceStopInstance: async (instanceId) => {
      const instance = await service.forceStopInstance(instanceId);
      await get().fetchInstances();
      return instance;
    },

    closeAllInstances: async () => {
      await service.closeAllInstances();
      await get().fetchInstances();
    },

    openInstanceWindow: async (instanceId) => {
      await service.openInstanceWindow(instanceId);
    },
  }));
}

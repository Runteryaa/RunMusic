import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DownloadTask, DownloadStorageTarget } from '../types/download';

interface DownloadStoreState {
  tasks: DownloadTask[];
  defaultStorageTarget: DownloadStorageTarget;

  // Actions
  addTask: (task: DownloadTask) => void;
  updateTask: (id: string, partial: Partial<DownloadTask>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  setDefaultStorageTarget: (target: DownloadStorageTarget) => void;
}

export const useDownloadStore = create<DownloadStoreState>()(
  persist(
    (set) => ({
      tasks: [],
      defaultStorageTarget: 'private',

      addTask: (task) =>
        set((state) => ({
          tasks: [task, ...state.tasks.filter((t) => t.id !== task.id)],
        })),

      updateTask: (id, partial) =>
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...partial } : t)),
        })),

      removeTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        })),

      clearCompleted: () =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.status !== 'completed'),
        })),

      setDefaultStorageTarget: (target) =>
        set({ defaultStorageTarget: target }),
    }),
    {
      name: 'runmusic-downloads-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Yalnızca görev meta verilerini ve ayarı kaydet, geçici indirme durumlarını bitmiş/hatalı say
        tasks: state.tasks.map((t) =>
          t.status === 'downloading' || t.status === 'queued'
            ? { ...t, status: 'failed' as const, error: 'App closed during download' }
            : t
        ),
        defaultStorageTarget: state.defaultStorageTarget,
      }),
    }
  )
);

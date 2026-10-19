import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExtensionManifest, InstalledExtension } from '../types/extension';

interface ExtensionStoreState {
  extensions: InstalledExtension[];
  activeExtensionId: string | null;
  isInstallModalOpen: boolean;
  isDownloadsModalOpen: boolean;

  // Actions
  installExtension: (manifestUrl: string) => Promise<InstalledExtension>;
  updateExtension: (id: string) => Promise<InstalledExtension | null>;
  uninstallExtension: (id: string) => void;
  toggleExtension: (id: string, isEnabled?: boolean) => void;
  setActiveExtensionId: (id: string | null) => void;

  setExtensionSetting: (id: string, key: string, value: any) => void;
  setExtensionStorage: (id: string, key: string, value: any) => void;
  removeExtensionStorage: (id: string, key: string) => void;

  openInstallModal: () => void;
  closeInstallModal: () => void;
  openDownloadsModal: () => void;
  closeDownloadsModal: () => void;
}

export const useExtensionStore = create<ExtensionStoreState>()(
  persist(
    (set, get) => ({
      extensions: [],
      activeExtensionId: null,
      isInstallModalOpen: false,
      isDownloadsModalOpen: false,

      installExtension: async (rawUrl: string) => {
        let manifestUrl = rawUrl.trim();
        if (!manifestUrl.startsWith('http://') && !manifestUrl.startsWith('https://')) {
          manifestUrl = 'https://' + manifestUrl;
        }

        // Eğer doğrudan bir klasör veya domain girilmişse ve sonu .json değilse
        let fetchUrl = manifestUrl;
        if (!manifestUrl.endsWith('.json') && !manifestUrl.includes('manifest')) {
          fetchUrl = manifestUrl.replace(/\/$/, '') + '/manifest.json';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        let manifest: ExtensionManifest;
        try {
          const res = await fetch(fetchUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) {
            throw new Error(`HTTP error: ${res.status}`);
          }
          manifest = await res.json();
        } catch (fetchErr: any) {
          // İkinci deneme: Eğer manifest.json ile denediysek ve 404 aldıysa ham URL'yi dene
          if (fetchUrl !== manifestUrl) {
            const fallbackRes = await fetch(manifestUrl, {
              headers: { Accept: 'application/json' },
            });
            if (fallbackRes.ok) {
              manifest = await fallbackRes.json();
            } else {
              throw new Error(`Manifest yüklenemedi: ${fetchErr?.message || 'Bilinmeyen hata'}`);
            }
          } else {
            throw new Error(`Manifest yüklenemedi: ${fetchErr?.message || 'Bilinmeyen hata'}`);
          }
        } finally {
          clearTimeout(timeoutId);
        }

        if (!manifest || typeof manifest !== 'object') {
          throw new Error('Geçersiz manifest formatı: JSON bir nesne olmalıdır.');
        }

        if (!manifest.id || typeof manifest.id !== 'string') {
          throw new Error('Geçersiz manifest: "id" alanı zorunludur.');
        }

        if (!manifest.name || typeof manifest.name !== 'string') {
          throw new Error('Geçersiz manifest: "name" alanı zorunludur.');
        }

        if (!manifest.entryUrl || typeof manifest.entryUrl !== 'string') {
          throw new Error('Geçersiz manifest: "entryUrl" alanı zorunludur.');
        }

        // Giriş URL'sini göreceli ise mutlak hale getir
        try {
          const resolvedEntry = new URL(manifest.entryUrl, fetchUrl).toString();
          manifest.entryUrl = resolvedEntry;
        } catch {
          // URL çözümleme hatası olursa orijinalini koru
        }

        const now = Date.now();
        const existing = get().extensions.find((e) => e.manifest.id === manifest.id);

        const newExt: InstalledExtension = {
          manifest,
          manifestUrl: fetchUrl,
          installedAt: existing ? existing.installedAt : now,
          updatedAt: now,
          isEnabled: existing ? existing.isEnabled : true,
          settings: existing ? existing.settings : {},
          storage: existing ? existing.storage : {},
        };

        set((state) => {
          const filtered = state.extensions.filter((e) => e.manifest.id !== manifest.id);
          return {
            extensions: [...filtered, newExt],
            activeExtensionId: state.activeExtensionId || manifest.id,
            isInstallModalOpen: false,
          };
        });

        return newExt;
      },

      updateExtension: async (id: string) => {
        const ext = get().extensions.find((e) => e.manifest.id === id);
        if (!ext) return null;

        try {
          const res = await fetch(ext.manifestUrl, { headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const manifest: ExtensionManifest = await res.json();

          if (manifest.id !== id) {
            throw new Error('Güncellenen manifest ID eşleşmiyor.');
          }

          const now = Date.now();
          const updated: InstalledExtension = {
            ...ext,
            manifest: { ...manifest },
            updatedAt: now,
          };

          set((state) => ({
            extensions: state.extensions.map((e) => (e.manifest.id === id ? updated : e)),
          }));

          return updated;
        } catch (err) {
          console.warn('[useExtensionStore] Güncelleme hatası:', err);
          return null;
        }
      },

      uninstallExtension: (id: string) => {
        set((state) => {
          const remaining = state.extensions.filter((e) => e.manifest.id !== id);
          let nextActiveId = state.activeExtensionId;
          if (state.activeExtensionId === id) {
            const nextAvailable = remaining.find((e) => e.isEnabled);
            nextActiveId = nextAvailable ? nextAvailable.manifest.id : null;
          }
          return {
            extensions: remaining,
            activeExtensionId: nextActiveId,
          };
        });
      },

      toggleExtension: (id: string, isEnabled?: boolean) => {
        set((state) => {
          const updated = state.extensions.map((e) => {
            if (e.manifest.id === id) {
              const nextState = isEnabled !== undefined ? isEnabled : !e.isEnabled;
              return { ...e, isEnabled: nextState };
            }
            return e;
          });

          let nextActiveId = state.activeExtensionId;
          if (state.activeExtensionId === id) {
            const current = updated.find((e) => e.manifest.id === id);
            if (current && !current.isEnabled) {
              const nextEnabled = updated.find((e) => e.isEnabled);
              nextActiveId = nextEnabled ? nextEnabled.manifest.id : null;
            }
          } else if (!state.activeExtensionId) {
            const firstEnabled = updated.find((e) => e.isEnabled);
            nextActiveId = firstEnabled ? firstEnabled.manifest.id : null;
          }

          return {
            extensions: updated,
            activeExtensionId: nextActiveId,
          };
        });
      },

      setActiveExtensionId: (id) => set({ activeExtensionId: id }),

      setExtensionSetting: (id, key, value) => {
        set((state) => ({
          extensions: state.extensions.map((e) =>
            e.manifest.id === id
              ? { ...e, settings: { ...e.settings, [key]: value } }
              : e
          ),
        }));
      },

      setExtensionStorage: (id, key, value) => {
        set((state) => ({
          extensions: state.extensions.map((e) =>
            e.manifest.id === id
              ? { ...e, storage: { ...e.storage, [key]: value } }
              : e
          ),
        }));
      },

      removeExtensionStorage: (id, key) => {
        set((state) => ({
          extensions: state.extensions.map((e) => {
            if (e.manifest.id === id) {
              const newStorage = { ...e.storage };
              delete newStorage[key];
              return { ...e, storage: newStorage };
            }
            return e;
          }),
        }));
      },

      openInstallModal: () => set({ isInstallModalOpen: true }),
      closeInstallModal: () => set({ isInstallModalOpen: false }),
      openDownloadsModal: () => set({ isDownloadsModalOpen: true }),
      closeDownloadsModal: () => set({ isDownloadsModalOpen: false }),
    }),
    {
      name: 'runmusic-extensions-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        extensions: state.extensions,
        activeExtensionId: state.activeExtensionId,
      }),
    }
  )
);

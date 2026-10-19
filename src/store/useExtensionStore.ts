import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExtensionManifest, InstalledExtension } from '../types/extension';

export interface ExtensionUpdateResult {
  extension: InstalledExtension;
  hasUpdate: boolean;
  oldVersion: string;
  newVersion: string;
}

export function compareVersions(vA?: string, vB?: string): number {
  if (!vA && !vB) return 0;
  if (!vA) return -1;
  if (!vB) return 1;

  const cleanA = String(vA).replace(/^v/i, '').trim();
  const cleanB = String(vB).replace(/^v/i, '').trim();

  const partsA = cleanA.split('.').map((p) => parseInt(p, 10));
  const partsB = cleanB.split('.').map((p) => parseInt(p, 10));

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = isNaN(partsA[i]) ? 0 : partsA[i];
    const numB = isNaN(partsB[i]) ? 0 : partsB[i];
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return cleanA.localeCompare(cleanB, undefined, { numeric: true, sensitivity: 'base' });
}

export function addCacheBuster(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('_t', String(Date.now()));
    return parsed.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_t=${Date.now()}`;
  }
}

interface ExtensionStoreState {
  extensions: InstalledExtension[];
  activeExtensionId: string | null;
  isInstallModalOpen: boolean;
  isDownloadsModalOpen: boolean;

  // Actions
  installExtension: (manifestUrl: string) => Promise<InstalledExtension>;
  updateExtension: (id: string, force?: boolean) => Promise<ExtensionUpdateResult | null>;
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
          const res = await fetch(addCacheBuster(fetchUrl), {
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            },
          });
          if (!res.ok) {
            throw new Error(`HTTP error: ${res.status}`);
          }
          manifest = await res.json();
        } catch (fetchErr: any) {
          // İkinci deneme: Eğer manifest.json ile denediysek ve 404 aldıysa ham URL'yi dene
          if (fetchUrl !== manifestUrl) {
            const fallbackRes = await fetch(addCacheBuster(manifestUrl), {
              headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
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

        const rawPage = manifest.page || manifest.entryUrl;
        if (!rawPage || typeof rawPage !== 'string') {
          throw new Error('Geçersiz manifest: "page" alanı zorunludur.');
        }

        // Web sayfası URL'sini göreceli ise mutlak hale getir
        let resolvedPage = rawPage;
        try {
          resolvedPage = new URL(rawPage, fetchUrl).toString();
        } catch {
          // URL çözümleme hatası olursa orijinalini koru
        }
        manifest.page = resolvedPage;
        manifest.entryUrl = resolvedPage;

        // İkon URL'sini göreceli ise mutlak hale getir
        if (manifest.icon && typeof manifest.icon === 'string') {
          try {
            manifest.icon = new URL(manifest.icon, fetchUrl).toString();
          } catch {
            // koru
          }
        }

        // Manifest URL'sini garantiye al
        if (!manifest.url) {
          manifest.url = fetchUrl;
        }

        // Yazar bilgisi obje ise ismini al
        if (typeof manifest.author === 'object' && manifest.author !== null && 'name' in manifest.author) {
          manifest.author = (manifest.author as any).name;
        }

        const now = Date.now();
        const existing = get().extensions.find(
          (e) =>
            e.manifest.id === manifest.id ||
            (e.manifestUrl && (e.manifestUrl === fetchUrl || e.manifestUrl === manifest.url)) ||
            (e.manifest.id === 'youtube-extension' && manifest.id === 'youtube') ||
            (e.manifest.id === 'youtube' && manifest.id === 'youtube-extension')
        );

        const newExt: InstalledExtension = {
          manifest,
          manifestUrl: manifest.url || fetchUrl,
          installedAt: existing ? existing.installedAt : now,
          updatedAt: now,
          isEnabled: existing ? existing.isEnabled : true,
          settings: existing ? existing.settings : {},
          storage: existing ? existing.storage : {},
        };

        set((state) => {
          const filtered = state.extensions.filter(
            (e) => e.manifest.id !== manifest.id && (!existing || e.manifest.id !== existing.manifest.id)
          );
          return {
            extensions: [...filtered, newExt],
            activeExtensionId: state.activeExtensionId || manifest.id,
            isInstallModalOpen: false,
          };
        });

        return newExt;
      },

      updateExtension: async (id: string, force = false): Promise<ExtensionUpdateResult | null> => {
        let ext = get().extensions.find((e) => e.manifest.id === id);
        if (!ext) {
          if (id === 'youtube') {
            ext = get().extensions.find((e) => e.manifest.id === 'youtube-extension');
          } else if (id === 'youtube-extension') {
            ext = get().extensions.find((e) => e.manifest.id === 'youtube');
          }
        }
        if (!ext) return null;

        const updateUrl = ext.manifest.url || ext.manifestUrl;
        if (!updateUrl) return null;

        try {
          const res = await fetch(addCacheBuster(updateUrl), {
            headers: {
              Accept: 'application/json',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const manifest: ExtensionManifest = await res.json();

          if (!manifest || typeof manifest !== 'object') {
            throw new Error('Geçersiz manifest verisi alındı.');
          }

          const isMatchingId =
            manifest.id === ext.manifest.id ||
            manifest.id === id ||
            (ext.manifest.id === 'youtube-extension' && manifest.id === 'youtube') ||
            (ext.manifest.id === 'youtube' && manifest.id === 'youtube-extension') ||
            Boolean(ext.manifestUrl && ext.manifestUrl.includes('youtube'));

          if (!isMatchingId) {
            throw new Error(`Güncellenen manifest ID (${manifest.id}) mevcut ID (${ext.manifest.id}) ile eşleşmiyor.`);
          }

          const rawPage = manifest.page || manifest.entryUrl;
          if (rawPage && typeof rawPage === 'string') {
            try {
              const resolved = new URL(rawPage, updateUrl).toString();
              manifest.page = resolved;
              manifest.entryUrl = resolved;
            } catch {
              manifest.page = rawPage;
              manifest.entryUrl = rawPage;
            }
          }

          if (manifest.icon && typeof manifest.icon === 'string') {
            try {
              manifest.icon = new URL(manifest.icon, updateUrl).toString();
            } catch {}
          }

          if (!manifest.url) {
            manifest.url = updateUrl;
          }

          if (typeof manifest.author === 'object' && manifest.author !== null && 'name' in manifest.author) {
            manifest.author = (manifest.author as any).name;
          }

          const oldVersion = ext.manifest.version || '1.0.0';
          const newVersion = manifest.version || '1.0.0';
          const versionDiff = compareVersions(newVersion, oldVersion);
          const hasNewVersion = versionDiff > 0 || (manifest.version !== ext.manifest.version);

          if (!hasNewVersion && !force) {
            return {
              extension: ext,
              hasUpdate: false,
              oldVersion,
              newVersion,
            };
          }

          const now = Date.now();
          const updated: InstalledExtension = {
            ...ext,
            manifest: { ...manifest },
            manifestUrl: manifest.url || updateUrl,
            updatedAt: now,
          };

          set((state) => ({
            extensions: state.extensions
              .filter((e) => e.manifest.id !== manifest.id && e.manifest.id !== ext.manifest.id && e.manifest.id !== id)
              .concat(updated),
            activeExtensionId:
              state.activeExtensionId === ext.manifest.id || state.activeExtensionId === id
                ? manifest.id
                : state.activeExtensionId,
          }));

          return {
            extension: updated,
            hasUpdate: true,
            oldVersion,
            newVersion,
          };
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

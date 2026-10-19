import { Linking } from 'react-native';
import TrackPlayer, { Track } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { startDownload, cancelDownload } from './downloadManager';
import { skipToPreviousTrack } from './queueController';
import { setupTrackPlayerIfNeeded } from './playerBootstrap';
import type { InstalledExtension, ExtensionBridgeRequest } from '../types/extension';

/**
 * WebView içine enjekte edilecek JavaScript istemci SDK kodu.
 * Web uygulamasının window.RunMusic üzerinden native tarafla haberleşmesini sağlar.
 */
export function generateInjectedJavaScript(extensionId: string, currentTheme?: any): string {
  const activeTheme = currentTheme || useThemeStore.getState().theme;
  const initialThemePayload = {
    primary: activeTheme?.primary || '#3b82f6',
    background: '#121212',
    cardBackground: '#1e1e1e',
    text: '#ffffff',
    isDark: true,
  };

  return `
    (function() {
      if (window.__RUNMUSIC_INITIALIZED__) return;
      window.__RUNMUSIC_INITIALIZED__ = true;

      const _callbacks = new Map();
      const _eventListeners = new Map();
      let _reqCounter = 0;

      function _sendRequest(scope, action, payload) {
        return new Promise((resolve, reject) => {
          const id = 'rm_req_' + (++_reqCounter) + '_' + Date.now();
          _callbacks.set(id, { resolve, reject });
          
          const msg = JSON.stringify({
            id,
            scope,
            action,
            payload
          });

          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(msg);
          } else {
            _callbacks.delete(id);
            reject(new Error('ReactNativeWebView köprüsü bulunamadı.'));
          }

          // 15 saniye zaman aşımı
          setTimeout(() => {
            if (_callbacks.has(id)) {
              _callbacks.get(id).reject(new Error('İstek zaman aşımına uğradı.'));
              _callbacks.delete(id);
            }
          }, 15000);
        });
      }

      function _applyThemeVars(theme) {
        try {
          if (document && document.documentElement && theme && theme.primary) {
            document.documentElement.style.setProperty('--primary', theme.primary);
            document.documentElement.style.setProperty('--accent-color', theme.primary);
            document.documentElement.style.setProperty('--runmusic-primary', theme.primary);
          }
        } catch(e) {}
      }

      window.RunMusic = {
        extensionId: ${JSON.stringify(extensionId)},
        _currentTheme: ${JSON.stringify(initialThemePayload)},

        // ===================================
        // 1. OYNATICI (PLAYER)
        // ===================================
        player: {
          play: function(track) {
            return _sendRequest('player', 'play', track);
          },
          addToQueue: function(tracks) {
            return _sendRequest('player', 'addToQueue', Array.isArray(tracks) ? tracks : [tracks]);
          },
          pause: function() {
            return _sendRequest('player', 'pause');
          },
          resume: function() {
            return _sendRequest('player', 'resume');
          },
          skipNext: function() {
            return _sendRequest('player', 'skipNext');
          },
          skipPrevious: function() {
            return _sendRequest('player', 'skipPrevious');
          },
          seekTo: function(position) {
            return _sendRequest('player', 'seekTo', { position });
          }
        },

        // ===================================
        // 2. İNDİRME YÖNETİCİSİ (DOWNLOADER)
        // ===================================
        downloader: {
          download: function(options) {
            return _sendRequest('downloader', 'download', options);
          },
          cancel: function(downloadId) {
            return _sendRequest('downloader', 'cancel', { downloadId });
          },
          getTasks: function() {
            return _sendRequest('downloader', 'getTasks');
          }
        },

        // ===================================
        // 3. İZOLE DEPOLAMA (STORAGE)
        // ===================================
        storage: {
          getItem: function(key) {
            return _sendRequest('storage', 'getItem', { key });
          },
          setItem: function(key, value) {
            return _sendRequest('storage', 'setItem', { key, value });
          },
          removeItem: function(key) {
            return _sendRequest('storage', 'removeItem', { key });
          }
        },

        // ===================================
        // 4. TEMA VE SİSTEM (THEME & SYSTEM)
        // ===================================
        theme: {
          getTheme: function() {
            if (window.RunMusic && window.RunMusic._currentTheme) {
              return Promise.resolve(window.RunMusic._currentTheme);
            }
            return _sendRequest('theme', 'getTheme');
          },
          onThemeChange: function(callback) {
            if (typeof callback !== 'function') return function(){};
            if (!_eventListeners.has('themeChange')) {
              _eventListeners.set('themeChange', new Set());
            }
            _eventListeners.get('themeChange').add(callback);
            if (window.RunMusic._currentTheme) {
              try { callback(window.RunMusic._currentTheme); } catch(e){}
            }
            return function() {
              if (_eventListeners.has('themeChange')) {
                _eventListeners.get('themeChange').delete(callback);
              }
            };
          }
        },

        // ===================================
        // 5. ARAYÜZ YARDIMCILARI (UI)
        // ===================================
        ui: {
          showToast: function(message) {
            return _sendRequest('ui', 'showToast', { message });
          },
          openExternalUrl: function(url) {
            return _sendRequest('ui', 'openExternalUrl', { url });
          }
        },

        // İç köprü yanıt ve olay işleyicileri
        _handleResponse: function(responseId, success, data, error) {
          if (_callbacks.has(responseId)) {
            const { resolve, reject } = _callbacks.get(responseId);
            _callbacks.delete(responseId);
            if (success) {
              resolve(data);
            } else {
              reject(new Error(error || 'Köprü isteği başarısız oldu.'));
            }
          }
        },

        _handleEvent: function(eventName, data) {
          if (eventName === 'themeChange') {
            window.RunMusic._currentTheme = data;
            _applyThemeVars(data);
          }
          if (_eventListeners.has(eventName)) {
            _eventListeners.get(eventName).forEach(cb => {
              try { cb(data); } catch(e) { console.error(e); }
            });
          }
          try {
            window.dispatchEvent(new CustomEvent('RunMusic_' + eventName, { detail: data }));
            if (eventName === 'themeChange') {
              window.dispatchEvent(new CustomEvent('RunMusicThemeChange', { detail: data }));
            }
          } catch(e) {}
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          _applyThemeVars(window.RunMusic._currentTheme);
        });
      } else {
        _applyThemeVars(window.RunMusic._currentTheme);
      }

      // Hazır olunduğunu bildir
      window.dispatchEvent(new CustomEvent('RunMusicReady', { detail: { extensionId: ${JSON.stringify(extensionId)} } }));
    })();
    true;
  `;
}

/**
 * WebView'den gelen postMessage isteklerini işler ve cevabı geri post eder.
 */
export async function handleBridgeMessage(
  rawMessage: string,
  extension: InstalledExtension,
  sendResponse: (responseJson: string) => void
): Promise<void> {
  let req: ExtensionBridgeRequest;
  try {
    req = JSON.parse(rawMessage);
  } catch {
    return;
  }

  const { id, scope, action, payload } = req;

  const reply = (success: boolean, data?: any, error?: string) => {
    const js = `window.RunMusic && window.RunMusic._handleResponse(${JSON.stringify(id)}, ${success}, ${JSON.stringify(data ?? null)}, ${JSON.stringify(error || null)}); true;`;
    sendResponse(js);
  };

  try {
    switch (scope) {
      case 'player': {
        if (action === 'play') {
          const trackItem = payload;
          if (!trackItem || !trackItem.streamUrl) {
            reply(false, null, 'streamUrl zorunludur.');
            return;
          }

          await setupTrackPlayerIfNeeded();

          const trackId = trackItem.id || 'ext_' + extension.manifest.id + '_' + Date.now();
          const nativeTrack: Track = {
            id: trackId,
            url: trackItem.streamUrl,
            title: trackItem.title || 'Unknown Title',
            artist: trackItem.artist || extension.manifest.name,
            artwork: trackItem.artwork || extension.manifest.icon,
            duration: trackItem.duration || 0,
            ...(trackItem.downloadUrl ? { downloadUrl: trackItem.downloadUrl } : {}),
          } as any;

          // Kuyruğu ayarla ve çal (reset yerine setQueue kullanılarak notification servisi korunur)
          await TrackPlayer.setQueue([nativeTrack]);
          await TrackPlayer.play();

          // Store meta verilerini eşitle
          if (nativeTrack.artwork) {
            useStore.getState().setArtwork(trackId, nativeTrack.artwork as string);
          }
          useStore.getState().setTrackMetadata(trackId, {
            title: nativeTrack.title,
            artist: nativeTrack.artist,
            artwork: typeof nativeTrack.artwork === 'string' ? nativeTrack.artwork : undefined,
          });
          useStore.setState({
            contextIds: [trackId],
            upNextIds: [],
          });

          reply(true, { success: true, trackId });
        } else if (action === 'addToQueue') {
          const rawTracks = Array.isArray(payload) ? payload : [payload];
          const tracksToAdd: Track[] = rawTracks
            .filter((t: any) => t && t.streamUrl)
            .map((t: any, idx: number) => ({
              id: t.id || 'ext_' + extension.manifest.id + '_' + Date.now() + '_' + idx,
              url: t.streamUrl,
              title: t.title || 'Unknown Title',
              artist: t.artist || extension.manifest.name,
              artwork: t.artwork || extension.manifest.icon,
              duration: t.duration || 0,
              ...(t.downloadUrl ? { downloadUrl: t.downloadUrl } : {}),
            } as any));

          if (tracksToAdd.length > 0) {
            await setupTrackPlayerIfNeeded();
            const currentQueue = await TrackPlayer.getQueue();
            if (currentQueue.length === 0) {
              await TrackPlayer.setQueue(tracksToAdd);
              await TrackPlayer.play();
              useStore.setState({
                contextIds: tracksToAdd.map((t) => t.id),
                upNextIds: [],
              });
            } else {
              await TrackPlayer.add(tracksToAdd);
              useStore.getState().setUpNextIds([
                ...useStore.getState().upNextIds,
                ...tracksToAdd.map((t) => t.id),
              ]);
            }

            for (const t of tracksToAdd) {
              if (t.artwork) {
                useStore.getState().setArtwork(t.id, t.artwork as string);
              }
              useStore.getState().setTrackMetadata(t.id, {
                title: t.title,
                artist: t.artist,
                artwork: typeof t.artwork === 'string' ? t.artwork : undefined,
              });
            }
            reply(true, { addedCount: tracksToAdd.length });
          } else {
            reply(false, null, 'Eklenecek geçerli parça bulunamadı.');
          }
        } else if (action === 'pause') {
          await TrackPlayer.pause();
          reply(true);
        } else if (action === 'resume') {
          await TrackPlayer.play();
          reply(true);
        } else if (action === 'skipNext') {
          await TrackPlayer.skipToNext();
          reply(true);
        } else if (action === 'skipPrevious') {
          await skipToPreviousTrack();
          reply(true);
        } else if (action === 'seekTo') {
          const pos = typeof payload?.position === 'number' ? payload.position : 0;
          await TrackPlayer.seekTo(pos);
          reply(true);
        } else {
          reply(false, null, `Bilinmeyen oynatıcı eylemi: ${action}`);
        }
        break;
      }

      case 'downloader': {
        if (action === 'download') {
          if (!payload?.downloadUrl) {
            reply(false, null, 'downloadUrl zorunludur.');
            return;
          }
          const res = await startDownload({
            title: payload.title || 'Unknown Title',
            artist: payload.artist || extension.manifest.name,
            artwork: payload.artwork,
            downloadUrl: payload.downloadUrl,
            suggestedFileName: payload.suggestedFileName || payload.fileName,
            storageTarget: payload.storageTarget,
            sourceExtensionId: extension.manifest.id,
          });
          reply(true, res);
        } else if (action === 'cancel') {
          if (payload?.downloadId) {
            await cancelDownload(payload.downloadId);
            reply(true);
          } else {
            reply(false, null, 'downloadId zorunludur.');
          }
        } else if (action === 'getTasks') {
          const tasks = useDownloadStore.getState().tasks;
          reply(true, tasks);
        } else {
          reply(false, null, `Bilinmeyen indirici eylemi: ${action}`);
        }
        break;
      }

      case 'storage': {
        const store = useExtensionStore.getState();
        if (action === 'getItem') {
          const val = extension.storage ? extension.storage[payload?.key] : undefined;
          reply(true, val ?? null);
        } else if (action === 'setItem') {
          if (payload?.key) {
            store.setExtensionStorage(extension.manifest.id, payload.key, payload.value);
            reply(true);
          } else {
            reply(false, null, 'key zorunludur.');
          }
        } else if (action === 'removeItem') {
          if (payload?.key) {
            store.removeExtensionStorage(extension.manifest.id, payload.key);
            reply(true);
          } else {
            reply(false, null, 'key zorunludur.');
          }
        } else {
          reply(false, null, `Bilinmeyen depolama eylemi: ${action}`);
        }
        break;
      }

      case 'theme': {
        if (action === 'getTheme') {
          const currentTheme = useThemeStore.getState().theme;
          reply(true, {
            primary: currentTheme.primary,
            background: '#121212',
            cardBackground: '#1e1e1e',
            text: '#ffffff',
            isDark: true,
          });
        } else {
          reply(false, null, `Bilinmeyen tema eylemi: ${action}`);
        }
        break;
      }

      case 'ui': {
        if (action === 'openExternalUrl') {
          if (payload?.url) {
            await Linking.openURL(payload.url);
            reply(true);
          } else {
            reply(false, null, 'url zorunludur.');
          }
        } else if (action === 'showToast') {
          // Toast mesajı
          reply(true);
        } else {
          reply(false, null, `Bilinmeyen ui eylemi: ${action}`);
        }
        break;
      }

      default:
        reply(false, null, `Desteklenmeyen kapsam: ${scope}`);
        break;
    }
  } catch (err: any) {
    console.warn('[extensionBridge] İstek işleme hatası:', err);
    reply(false, null, err?.message || 'Köprü hatası');
  }
}

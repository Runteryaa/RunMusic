import { Tabs, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import * as SystemUI from 'expo-system-ui';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TrackPlayer, { State, useActiveTrack } from 'react-native-track-player';

import playbackService from '../service';

import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { restoreQueueIfNeeded, syncAppKilledPlaybackBehavior, attachGlobalPlayerEventListeners } from '../services/playerBootstrap';
import { refreshReplayGainForActiveTrack } from '../services/audioEffectsService';
import { ExpandingPlayer } from '../components/ExpandingPlayer';
import { getArtworkAsync } from '../../modules/audio-artwork/src';
import { useWidgetUpdater } from '../hooks/useWidgetUpdater';
import { initSleepTimerService } from '../store/useSleepTimerStore';
import { useTranslation, t } from '../services/i18n';
import { initAdService } from '../services/adService';
import * as Font from 'expo-font';
import { getCachedLibrary } from '../services/libraryStorage';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import { PairChallengeModal } from '../components/PairChallengeModal';
import { PairVerifyModal } from '../components/PairVerifyModal';
import { DeviceSelectorModal } from '../components/DeviceSelectorModal';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { AppAlertModal } from '../components/AppAlertModal';
import { installGlobalAlert } from '../services/customAlert';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

SplashScreen.preventAutoHideAsync().catch(() => {});
// Splash kapandığı anda pencerenin arka planı da aynı renk olsun; aksi halde
// Android'de kısa bir siyah kare görünebiliyor.
SystemUI.setBackgroundColorAsync('#121212').catch(() => {});

// Register background service & install custom in-app alert handler
TrackPlayer.registerPlaybackService(() => playbackService);
installGlobalAlert();

/**
 * Zustand persist hidrasyonunu kısa bir süre bekler. Ayar/tema/kuyruk
 * tercihleri ilk karede doğru olsun diye yapılır; yine de bir aksilikte
 * açılışı süresiz kilitlememek için üst sınır vardır.
 */
function waitForStoreHydration(timeoutMs: number): Promise<void> {
  if (useStore.getState().isHydrated || useStore.persist.hasHydrated?.()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };

    timer = setTimeout(finish, timeoutMs);
    try {
      unsubscribe = useStore.persist.onFinishHydration(finish);
    } catch {
      finish();
    }
  });
}

function MainAppLayout({ onFirstLayout }: { onFirstLayout: () => void }) {
  useWidgetUpdater();
  const { t } = useTranslation();
  const isDeviceSelectorOpen = usePlayerUIStore((s) => s.isDeviceSelectorOpen);
  const closeDeviceSelector = usePlayerUIStore((s) => s.closeDeviceSelector);
  
  const activeTrack = useActiveTrack();
  const theme = useThemeStore((s) => s.theme);
  const updateThemeFromArtwork = useThemeStore((s) => s.updateThemeFromArtwork);
  const dynamicColorFromArtwork = useStore((s) => s.preferences.dynamicColorFromArtwork);
  const presetThemeColor = useStore((s) => s.preferences.presetThemeColor);
  const keepPlayingWhenAppKilled = useStore((s) => s.preferences.keepPlayingWhenAppKilled);
  const setArtwork = useStore((s) => s.setArtwork);
  const activeTrackId = activeTrack?.id;
  const storeArtwork = useStore((s) =>
    activeTrackId ? s.metadataMap[activeTrackId]?.artwork || s.artworkMap[activeTrackId] : undefined
  );

  const artworkUri =
    storeArtwork || (typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : undefined);

  // Uygulama kapatılınca çalma davranışını native servise senkronize et
  useEffect(() => {
    syncAppKilledPlaybackBehavior(keepPlayingWhenAppKilled);
  }, [keepPlayingWhenAppKilled]);

  // Kök uygulama kapatıldığında (unmount) kullanıcı tercihi kapalıysa müziği tamamen durdur
  useEffect(() => {
    return () => {
      const keepPlaying = useStore.getState().preferences?.keepPlayingWhenAppKilled ?? true;
      if (!keepPlaying) {
        TrackPlayer.stop().catch(() => {});
        TrackPlayer.reset().catch(() => {});
      }
    };
  }, []);

  const isRemoteServiceEnabled = useRemoteConnectStore((s) => s.isServiceEnabled);
  useEffect(() => {
    if (isRemoteServiceEnabled) {
      remoteSyncManager.startHostService().catch((err) => {
        console.warn('Failed to start remote host service:', err);
      });
    } else {
      remoteSyncManager.stopHostService();
      if (useRemoteConnectStore.getState().mode === 'client') {
        remoteSyncManager.disconnectClient();
      }
    }
  }, [isRemoteServiceEnabled]);

  const isRemoteMode = useRemoteConnectStore((s) => s.mode === 'client');
  const remoteArtworkUri = useRemoteConnectStore((s) => s.remoteState.artworkUri);
  const effectiveArtworkUri = isRemoteMode ? remoteArtworkUri : artworkUri;

  // Aktif şarkının kapak görseli henüz önbellekte yoksa anında çek ve temayı tetikle
  useEffect(() => {
    if (isRemoteMode || activeTrackId?.startsWith('remote_')) return;
    if (!artworkUri && activeTrack?.url && activeTrackId) {
      let isMounted = true;
      getArtworkAsync(activeTrack.url, activeTrackId).then((resolved) => {
        if (isMounted && resolved) {
          setArtwork(activeTrackId, resolved);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [artworkUri, activeTrack?.url, activeTrackId, setArtwork, isRemoteMode]);

  useEffect(() => {
    // Tercih de bağımlılık: kullanıcı "kapaktan renk türet"i açıp kapatınca
    // veya sabit tema rengini değiştirince tema hemen güncellenir.
    if (dynamicColorFromArtwork && effectiveArtworkUri) {
      updateThemeFromArtwork(effectiveArtworkUri);
    } else if (!dynamicColorFromArtwork) {
      updateThemeFromArtwork(null);
    }
  }, [effectiveArtworkUri, activeTrackId, updateThemeFromArtwork, dynamicColorFromArtwork, presetThemeColor]);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: '#121212' }}
      onLayout={onFirstLayout}>
      <View style={{ flex: 1, backgroundColor: '#121212' }}>
        <Tabs
          screenOptions={{
            headerShown: true,
            headerStyle: {
              backgroundColor: '#121212',
              elevation: 0,
              shadowOpacity: 0,
            },
            headerTitleStyle: {
              color: '#ffffff',
              fontWeight: '700',
            },
            tabBarStyle: {
              backgroundColor: '#121212',
              borderTopColor: '#27272a',
              borderTopWidth: 1,
              height: 56,
            },
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: '#71717a',
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: t('tabs.library'),
              headerShown: false,
              tabBarIcon: ({ color }) => <Ionicons name="musical-notes" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="extensions"
            options={{
              title: t('tabs.extensions'),
              headerShown: false,
              tabBarIcon: ({ color }) => <Ionicons name="extension-puzzle-outline" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: t('tabs.settings'),
              tabBarIcon: ({ color }) => <Ionicons name="settings-outline" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="statistics"
            options={{
              href: null,
              headerShown: false,
            }}
          />
          <Tabs.Screen
            name="audio-effects"
            options={{
              href: null,
              headerShown: false,
            }}
          />
        </Tabs>

        {/* Genişleyen ve Dönüşen Müzik Çalar (MiniPlayer <---> FullscreenPlayer) */}
        <ExpandingPlayer />

        {/* Wi-Fi Remote Connect Modals & Global Themed In-App Alert */}
        <PairChallengeModal />
        <PairVerifyModal />
        <DeviceSelectorModal
          visible={isDeviceSelectorOpen}
          onClose={closeDeviceSelector}
        />
        <AppAlertModal />
      </View>
    </GestureHandlerRootView>
  );
}

let lastHandledDeepLinkUrl: string | null = null;
let lastHandledDeepLinkTime = 0;

export async function handleAppDeepLink(url: string | null): Promise<void> {
  if (!url) return;
  try {
    const parsed = Linking.parse(url);
    const host = (parsed.hostname || '').toLowerCase();
    const path = (parsed.path || '').toLowerCase();

    // Check if this is an extension install deep link
    const isExtensionLink =
      host === 'extension' ||
      host === 'extensions' ||
      host === 'install-extension' ||
      host === 'install' ||
      path.includes('extension') ||
      path.includes('install');

    const manifestUrl =
      (parsed.queryParams?.url as string) ||
      (parsed.queryParams?.manifest as string) ||
      (parsed.queryParams?.install as string) ||
      (parsed.queryParams?.extension_url as string);

    if (isExtensionLink && manifestUrl) {
      const cleanUrl = decodeURIComponent(manifestUrl).trim();
      const now = Date.now();
      if (cleanUrl === lastHandledDeepLinkUrl && now - lastHandledDeepLinkTime < 3000) {
        return;
      }
      lastHandledDeepLinkUrl = cleanUrl;
      lastHandledDeepLinkTime = now;

      // Extensions sekmesine geçiş yap
      try {
        router.push('/extensions');
      } catch {
        // ignore navigation if not ready
      }

      // Eklentiyi otomatik yükle
      try {
        const ext = await useExtensionStore.getState().installExtension(cleanUrl);
        Alert.alert(
          t('extensions.install_success'),
          t('extensions.install_success_msg', { name: ext.manifest.name })
        );
      } catch (err: any) {
        Alert.alert(
          t('extensions.install_error'),
          err?.message || t('extensions.manifest_load_error')
        );
      }
      return;
    }

    // Widget başlatma / çalma URL kontrolü
    await handleWidgetLaunchUrl(url);
  } catch (err) {
    console.warn('[handleAppDeepLink] error:', err);
  }
}

async function handleWidgetLaunchUrl(url: string | null) {
  if (!url) return;
  try {
    const parsed = Linking.parse(url);
    const action =
      (parsed.queryParams?.action as string) || (parsed.queryParams?.widget_action as string);
    const autoPlay =
      parsed.queryParams?.autoPlay === 'true' || parsed.queryParams?.auto_play === 'true';
    const isBackground =
      parsed.queryParams?.background === 'true' || parsed.queryParams?.open_background === 'true';

    if (action || autoPlay) {
      await restoreQueueIfNeeded();

      if (action === 'play_pause' || autoPlay) {
        const state = await TrackPlayer.getPlaybackState();
        if (state.state === State.Playing && !autoPlay) {
          await TrackPlayer.pause();
        } else {
          await TrackPlayer.play();
        }
      } else if (action === 'next') {
        await TrackPlayer.skipToNext();
        await TrackPlayer.play();
      } else if (action === 'prev') {
        await TrackPlayer.skipToPrevious();
        await TrackPlayer.play();
      }

      if (isBackground && MusicWidgetModule?.moveAppToBack) {
        setTimeout(() => {
          try {
            MusicWidgetModule.moveAppToBack();
          } catch {
            // ignore
          }
        }, 150);
      }
    }
  } catch (err) {
    console.warn('[handleWidgetLaunchUrl] error:', err);
  }
}

export default function TabLayout() {
  const [isAppReady, setIsAppReady] = useState(false);
  const splashHiddenRef = useRef(false);

  /**
   * Splash'i ancak gerçek arayüzün ilk karesi çizildikten sonra kaldır.
   * Böylece splash ile içerik arasında siyah bir boşluk oluşmaz.
   */
  const hideSplashAfterFirstLayout = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    // İki kare bekle: ilk karede liste layout'u tamamlanır, ikinci karede
    // gerçekten ekrana çizilmiş olur. Splash ancak ondan sonra kapanır.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    });
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', (event) => {
      handleAppDeepLink(event.url);
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Güvenlik ağı: beklenmedik bir hata arayüzün kurulmasını engellese bile
    // uygulama sonsuza kadar splash ekranında kalmasın.
    const failsafeTimer = setTimeout(() => {
      if (!isMounted) return;
      setIsAppReady(true);
      hideSplashAfterFirstLayout();
    }, 10000);

    async function setup() {
      // Splash kapandığında kütüphane ekranı boş kalmasın: kalıcı ayarların
      // yanında önbellekteki kütüphaneyi de ilk kareden önce yükle. Tarama
      // (rescan) yine arka planda çalışır; kullanıcı eski listeyi anında görür.
      await waitForStoreHydration(500);

      if (!isMounted) return;

      try {
        if (useStore.getState().library.length === 0) {
          let cacheTimeout: ReturnType<typeof setTimeout> | undefined;
          const cached = await Promise.race([
            getCachedLibrary(),
            new Promise<null>((resolve) => {
              cacheTimeout = setTimeout(() => resolve(null), 3000);
            }),
          ]);
          if (cacheTimeout) clearTimeout(cacheTimeout);
          if (isMounted && cached && cached.length > 0) {
            useStore.getState().setLibrary(cached);
          }
        }
      } catch (cacheErr) {
        console.warn('Library cache pre-hydrate notice:', cacheErr);
      }

      if (!isMounted) return;
      setIsAppReady(true);

      // State güncellemesinin render edilip ilk kareyi çizmesine izin ver.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isMounted) return;

      // Kritik olmayan başlangıç işleri; hiçbiri splash'i bloklamaz.
      Font.loadAsync(Ionicons.font).catch((fontErr) => {
        console.warn('Font load notice:', fontErr);
      });
      initSleepTimerService();
      initAdService().catch((adErr) => console.warn('Ad service init notice:', adErr));
      attachGlobalPlayerEventListeners();

      // Kuyruğu arka planda geri yükle; arayüz hazır olduğu için splash beklemez.
      restoreQueueIfNeeded()
        .then(() => {
          // Kuyruk geri yüklendikten sonra aktif parçanın ReplayGain'ini uygula.
          void refreshReplayGainForActiveTrack();
        })
        .catch((restoreErr) => {
          console.warn('Queue restore notice:', restoreErr);
        });

      // Widget veya deep link ile arka planda başlatıldıysa. Widget eylemleri
      // kuyruk geri yüklemesini kendi içinde bekler.
      Linking.getInitialURL()
        .then((initialUrl) => {
          if (initialUrl) return handleAppDeepLink(initialUrl);
        })
        .catch((linkErr) => {
          console.warn('Initial URL handle notice:', linkErr);
        });
    }

    setup().catch((e) => {
      console.warn('Startup setup error', e);
      if (isMounted) {
        setIsAppReady(true);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(failsafeTimer);
    };
  }, [hideSplashAfterFirstLayout]);

  if (!isAppReady) {
    return <View style={{ flex: 1, backgroundColor: '#121212' }} />;
  }

  return <MainAppLayout onFirstLayout={hideSplashAfterFirstLayout} />;
}

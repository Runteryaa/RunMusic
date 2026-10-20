import { Tabs, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { View, Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TrackPlayer, { State, useActiveTrack } from 'react-native-track-player';

import playbackService from '../service';

import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { restoreQueueIfNeeded, syncAppKilledPlaybackBehavior, attachGlobalPlayerEventListeners } from '../services/playerBootstrap';
import { ExpandingPlayer } from '../components/ExpandingPlayer';
import { getArtworkAsync } from '../../modules/audio-artwork/src';
import { useWidgetUpdater } from '../hooks/useWidgetUpdater';
import { initSleepTimerService } from '../store/useSleepTimerStore';
import { initStatsDB } from '../services/statsDatabase';
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

// Register background service & install custom in-app alert handler
TrackPlayer.registerPlaybackService(() => playbackService);
installGlobalAlert();

function MainAppLayout() {
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
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
  const [isPlayerReady, setIsPlayerReady] = useState(false);

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
    let didFinish = false;

    const finalizeStartup = () => {
      if (didFinish) return;
      didFinish = true;
      if (isMounted) {
        setIsPlayerReady(true);
      }
      SplashScreen.hideAsync().catch(() => {});
    };

    // Failsafe: 2.5 saniye içinde ne olursa olsun splash ekranını kaldır ve arayüzü aç
    const failsafeTimer = setTimeout(() => {
      finalizeStartup();
    }, 2500);

    async function setup() {
      try {
        try {
          await Font.loadAsync(Ionicons.font);
        } catch (fontErr) {
          console.warn('Font load notice:', fontErr);
        }

        try {
          const cached = await getCachedLibrary();
          if (cached && cached.length > 0 && useStore.getState().library.length === 0) {
            useStore.getState().setLibrary(cached);
          }
        } catch (cacheErr) {
          console.warn('Library cache pre-hydrate notice:', cacheErr);
        }

        try {
          await initStatsDB();
          initSleepTimerService();
          initAdService().catch((adErr) => console.warn('Ad service init notice:', adErr));
        } catch (dbErr) {
          console.warn('Stats DB init error:', dbErr);
        }

        // Açılışta tam kuyruğu, çalma konumunu ve durumunu geri yükle
        attachGlobalPlayerEventListeners();
        await restoreQueueIfNeeded();

        // Widget veya deep link ile arka planda başlatıldıysa
        try {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            await handleAppDeepLink(initialUrl);
          }
        } catch (linkErr) {
          console.warn('Initial URL handle notice:', linkErr);
        }
      } catch (e) {
        console.warn('Startup setup error', e);
      } finally {
        clearTimeout(failsafeTimer);
        finalizeStartup();
      }
    }

    setup();

    return () => {
      isMounted = false;
      clearTimeout(failsafeTimer);
    };
  }, []);

  if (!isPlayerReady) {
    return <View style={{ flex: 1, backgroundColor: '#121212' }} />;
  }

  return <MainAppLayout />;
}

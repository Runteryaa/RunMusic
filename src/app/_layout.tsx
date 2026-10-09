import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TrackPlayer, { Capability, useActiveTrack } from 'react-native-track-player';

import playbackService from '../service';

import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { getLastPlayback } from '../services/playbackStorage';
import { MiniPlayer } from '../components/MiniPlayer';
import { FullscreenPlayerModal } from '../components/FullscreenPlayerModal';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Register background service
TrackPlayer.registerPlaybackService(() => playbackService);

function MainAppLayout() {
  const activeTrack = useActiveTrack();
  const theme = useThemeStore((s) => s.theme);
  const updateThemeFromArtwork = useThemeStore((s) => s.updateThemeFromArtwork);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);

  const artworkUri =
    (activeTrack?.id ? metadataMap[activeTrack.id]?.artwork || artworkMap[activeTrack.id] : undefined) ||
    (typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : undefined);

  useEffect(() => {
    updateThemeFromArtwork(artworkUri);
  }, [artworkUri, updateThemeFromArtwork]);

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
              title: 'Kütüphane',
              tabBarIcon: ({ color }) => <Ionicons name="musical-notes" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Ayarlar',
              tabBarIcon: ({ color }) => <Ionicons name="settings-outline" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="library"
            options={{
              href: null,
            }}
          />
          <Tabs.Screen
            name="explore"
            options={{
              href: null,
            }}
          />
        </Tabs>

        {/* Kalıcı Alt Mini Çalar (Tab Bar üzerinde yüzer) */}
        <View
          style={{ position: 'absolute', bottom: 56, left: 0, right: 0 }}
          pointerEvents="box-none">
          <MiniPlayer />
        </View>

        {/* Tam Ekran Çalar (Mini Çalara dokunulunca açılan Modal) */}
        <FullscreenPlayerModal />
      </View>
    </GestureHandlerRootView>
  );
}

export default function TabLayout() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);

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
          if (Updates.isEnabled) {
            Updates.setUpdateRequestHeadersOverride?.({ 'expo-channel-name': 'production' });
          }
        } catch {
          // Ignore
        }

        try {
          await TrackPlayer.setupPlayer();
        } catch (setupErr) {
          // Zaten başlatılmışsa devam et
          console.warn('TrackPlayer setupPlayer notice:', setupErr);
        }

        try {
          await TrackPlayer.updateOptions({
            capabilities: [
              Capability.Play,
              Capability.Pause,
              Capability.SkipToNext,
              Capability.SkipToPrevious,
              Capability.Stop,
            ],
            compactCapabilities: [Capability.Play, Capability.Pause],
          });
          const savedRepeatMode = useStore.getState().repeatMode;
          if (savedRepeatMode != null) {
            await TrackPlayer.setRepeatMode(savedRepeatMode);
          }
        } catch (optionsErr) {
          console.warn('TrackPlayer options notice:', optionsErr);
        }

        // Uygulama açılışında en son dinlenen şarkıyı bağımsız depolamadan yükle (hızlı ve hafif)
        try {
          const lastPlayback = await Promise.race([
            getLastPlayback(),
            new Promise<null>((res) => setTimeout(() => res(null), 1000)),
          ]);
          if (lastPlayback && lastPlayback.track) {
            await TrackPlayer.add([lastPlayback.track]);
            if (lastPlayback.position && lastPlayback.position > 0) {
              await TrackPlayer.seekTo(lastPlayback.position);
            }
          }
        } catch (restoreErr) {
          console.warn('Failed to restore last playback state', restoreErr);
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

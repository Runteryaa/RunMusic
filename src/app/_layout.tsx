import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import TrackPlayer, { Capability } from 'react-native-track-player';

import playbackService from '../service';

import { useStore } from '../store/useStore';
import { getLastPlayback } from '../services/playbackStorage';
import { MiniPlayer } from '../components/MiniPlayer';
import { FullscreenPlayerModal } from '../components/FullscreenPlayerModal';

SplashScreen.preventAutoHideAsync();

// Register background service
TrackPlayer.registerPlaybackService(() => playbackService);

export default function TabLayout() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  useEffect(() => {
    async function setup() {
      try {
        try {
          if (Updates.isEnabled) {
            Updates.setUpdateRequestHeadersOverride?.({ 'expo-channel-name': 'production' });
          }
        } catch {
          // Ignore if header override is not allowed or supported
        }

        await TrackPlayer.setupPlayer();
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

        // Uygulama açılışında en son dinlenen şarkıyı bağımsız depolamadan yükle (hızlı ve hafif)
        const lastPlayback = await getLastPlayback();
        if (lastPlayback && lastPlayback.track) {
          try {
            await TrackPlayer.add([lastPlayback.track]);
            if (lastPlayback.position && lastPlayback.position > 0) {
              await TrackPlayer.seekTo(lastPlayback.position);
            }
          } catch (restoreErr) {
            console.warn('Failed to restore last playback state', restoreErr);
          }
        }

        setIsPlayerReady(true);
      } catch (e) {
        console.warn('TrackPlayer setup failed', e);
        setIsPlayerReady(true);
      } finally {
        SplashScreen.hideAsync();
      }
    }
    
    setup();
  }, []);

  if (!isPlayerReady) {
    return null;
  }

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
            tabBarActiveTintColor: '#3b82f6',
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

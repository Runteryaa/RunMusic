import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import TrackPlayer, { Capability } from 'react-native-track-player';

import playbackService from '../service';

import { useStore } from '../store/useStore';

SplashScreen.preventAutoHideAsync();

// Register background service
TrackPlayer.registerPlaybackService(() => playbackService);

export default function TabLayout() {
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  useEffect(() => {
    async function setup() {
      try {
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

        // Uygulama açılışında en son dinlenen şarkıyı ve sırayı yükle (kullanıcı direkt devam edebilsin)
        const lastPlayback = useStore.getState().lastPlaybackState;
        if (lastPlayback) {
          try {
            if (lastPlayback.queue && lastPlayback.queue.length > 0) {
              await TrackPlayer.add(lastPlayback.queue);
              const targetIdx =
                lastPlayback.trackIndex ??
                (lastPlayback.trackId
                  ? lastPlayback.queue.findIndex(
                      (t) => t.id === lastPlayback.trackId || t.url === lastPlayback.trackId
                    )
                  : 0);
              if (targetIdx >= 0 && targetIdx < lastPlayback.queue.length) {
                await TrackPlayer.skip(targetIdx);
              }
              if (lastPlayback.position && lastPlayback.position > 0) {
                await TrackPlayer.seekTo(lastPlayback.position);
              }
            } else if (lastPlayback.track) {
              await TrackPlayer.add([lastPlayback.track]);
              if (lastPlayback.position && lastPlayback.position > 0) {
                await TrackPlayer.seekTo(lastPlayback.position);
              }
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
        },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#71717a',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Player',
          tabBarIcon: ({ color }) => <Ionicons name="musical-notes" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <Ionicons name="library" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null, // Hide explore tab
        }}
      />
    </Tabs>
  );
}

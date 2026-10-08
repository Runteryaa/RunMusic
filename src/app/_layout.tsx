import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import TrackPlayer, { Capability } from 'react-native-track-player';

SplashScreen.preventAutoHideAsync();

// Register background service
TrackPlayer.registerPlaybackService(() => require('../service'));

export default function TabLayout() {
  const colorScheme = useColorScheme();
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
        setIsPlayerReady(true);
      } catch (e) {
        console.warn('TrackPlayer setup failed', e);
        // Sometimes setup fails if it was already setup during fast refresh
        setIsPlayerReady(true);
      } finally {
        SplashScreen.hideAsync();
      }
    }
    
    setup();
  }, []);

  if (!isPlayerReady) {
    return null; // keep splash screen until player is ready
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Tabs
        screenOptions={{
          headerShown: true,
          tabBarActiveTintColor: colorScheme === 'dark' ? '#fff' : '#000',
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
    </ThemeProvider>
  );
}

import { useState, useMemo, useEffect, useCallback, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import TrackPlayer from 'react-native-track-player';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useStore, DEFAULT_PREFERENCES } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { saveCachedLibrary } from '../services/libraryStorage';
import { cleanDisplayTitle, type LyricsSourcePreference } from '../services/lyricsService';
import { getSortOptionLabel, type SortOption } from '../services/librarySort';
import { PRESET_THEME_COLORS } from '../constants/theme';
import { getPersistedSizeKB } from '../services/persistStorage';
import { clearUpNextQueue } from '../services/queueController';
import { syncAppKilledPlaybackBehavior } from '../services/playerBootstrap';
import { useTranslation, type AppLanguage } from '../services/i18n';
import { AdBanner } from '../components/AdBanner';
import { showRewardedAd } from '../services/adService';
import { useRemoteConnectStore, DEFAULT_DEVICE_NAME } from '../store/useRemoteConnectStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';

const GITHUB_URL = 'https://github.com/Runteryaa/RunMusic';

const SORT_OPTIONS: SortOption[] = [
  'name_asc',
  'name_desc',
  'duration_asc',
  'duration_desc',
  'date_desc',
  'date_asc',
];

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useThemeStore((s) => s.theme);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const preferences = useStore((s) => s.preferences);
  const updatePreferences = useStore((s) => s.updatePreferences);
  const unlockTheme = useStore((s) => s.unlockTheme);
  const unlockDynamicColor = useStore((s) => s.unlockDynamicColor);
  const resetPreferences = useStore((s) => s.resetPreferences);
  const hiddenTrackIds = useStore((s) => s.hiddenTrackIds);
  const unplayableTrackIds = useStore((s) => s.unplayableTrackIds);
  const allAssets = useStore((s) => s.allAssets);
  const unhideTrack = useStore((s) => s.unhideTrack);
  const unhideAllTracks = useStore((s) => s.unhideAllTracks);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const lyricsCache = useStore((s) => s.lyricsCache);
  const clearLyricsCache = useStore((s) => s.clearLyricsCache);
  const clearArtworkCache = useStore((s) => s.clearArtworkCache);
  const upNextCount = useStore((s) => s.upNextIds.length);

  const { t, resolvedLanguage } = useTranslation();

  const [isHiddenExpanded, setIsHiddenExpanded] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isLoadingThemeAd, setIsLoadingThemeAd] = useState(false);
  const [storageKB, setStorageKB] = useState<number | null>(null);
  const openDeviceSelector = usePlayerUIStore((s) => s.openDeviceSelector);

  const isRemoteEnabled = useRemoteConnectStore((s) => s.isServiceEnabled);
  const setRemoteEnabled = useRemoteConnectStore((s) => s.setServiceEnabled);
  const customDeviceName = useRemoteConnectStore((s) => s.customDeviceName);
  const setCustomDeviceName = useRemoteConnectStore((s) => s.setCustomDeviceName);
  const trustedDevices = useRemoteConnectStore((s) => s.trustedDevices);
  const removeTrustedDevice = useRemoteConnectStore((s) => s.removeTrustedDevice);
  const remoteMode = useRemoteConnectStore((s) => s.mode);
  const connectionStatus = useRemoteConnectStore((s) => s.connectionStatus);
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const customRelayUrl = useRemoteConnectStore((s) => s.customRelayUrl);
  const setCustomRelayUrl = useRemoteConnectStore((s) => s.setCustomRelayUrl);

  const languageOptions = useMemo(
    () => [
      { value: 'system', label: t('settings.lang_system') },
      { value: 'en', label: 'English' },
      { value: 'tr', label: 'Türkçe' },
    ],
    [t]
  );

  const lyricsSources = useMemo(
    () => [
      { value: 'lrclib_first' as const, label: t('settings.source_lrclib_first') },
      { value: 'genius_first' as const, label: t('settings.source_genius_first') },
      { value: 'lrclib_only' as const, label: t('settings.source_lrclib_only') },
    ],
    [t]
  );

  const sortOptions = useMemo(
    () =>
      SORT_OPTIONS.map((o) => ({
        value: o,
        label: getSortOptionLabel(o, resolvedLanguage),
      })),
    [resolvedLanguage]
  );

  const hiddenTrackItems = useMemo(() => {
    return hiddenTrackIds.map((id) => {
      const asset = allAssets.find((a) => a.id === id);
      const meta = metadataMap[id];
      let artist = meta?.artist?.trim() || '';
      let rawTitle = meta?.title?.trim() || '';
      if (!rawTitle && asset) {
        rawTitle = asset.filename;
      }
      let title = rawTitle
        ? cleanDisplayTitle(rawTitle, artist || undefined)
        : t('settings.track_fallback', { id });
      const isUnplayable = unplayableTrackIds.includes(id);
      return { id, asset, title, artist, duration: asset?.duration, isUnplayable };
    });
  }, [allAssets, hiddenTrackIds, metadataMap, unplayableTrackIds, t]);

  const cachedLyricsCount = useMemo(() => {
    // Alternatif anahtarlar kanonik kayda işaretçidir ({ ref }). Gerçek kayıtlı
    // parça sayısını göstermek için yalnızca tam içerikli kayıtları say.
    let count = 0;
    for (const entry of Object.values(lyricsCache ?? {})) {
      if (!(entry && typeof entry === 'object' && 'ref' in entry)) count++;
    }
    return count;
  }, [lyricsCache]);

  const artworkCount = useMemo(() => Object.keys(artworkMap ?? {}).length, [artworkMap]);

  const refreshStorageUsage = useCallback(async () => {
    setStorageKB(await getPersistedSizeKB());
  }, []);

  useEffect(() => {
    refreshStorageUsage();
  }, [refreshStorageUsage]);

  const handleClearLyricsCache = () => {
    Alert.alert(
      t('settings.alerts.clear_lyrics_title'),
      t('settings.alerts.clear_lyrics_msg'),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.alerts.clear'),
          style: 'destructive',
          onPress: () => {
            clearLyricsCache();
            refreshStorageUsage();
          },
        },
      ]
    );
  };

  const handleClearArtworkCache = () => {
    Alert.alert(
      t('settings.alerts.clear_artwork_title'),
      t('settings.alerts.clear_artwork_msg'),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.alerts.clear'),
          style: 'destructive',
          onPress: async () => {
            try {
              const base = FileSystem.cacheDirectory;
              if (base) {
                await FileSystem.deleteAsync(`${base}artworks`, { idempotent: true });
              }
            } catch (e) {
              console.warn('Artwork cache delete failed:', e);
            }
            clearArtworkCache();
            refreshStorageUsage();
          },
        },
      ]
    );
  };

  const handleClearUpNext = () => {
    Alert.alert(
      t('settings.alerts.clear_up_next_title'),
      t('settings.alerts.clear_up_next_msg'),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.alerts.clear'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearUpNextQueue();
            } catch (e) {
              console.warn('Clear up-next failed:', e);
            }
          },
        },
      ]
    );
  };

  const handleResetSettings = () => {
    Alert.alert(
      t('settings.alerts.reset_settings_title'),
      t('settings.alerts.reset_settings_msg'),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.alerts.reset'),
          style: 'destructive',
          onPress: () => {
            resetPreferences();
            syncAppKilledPlaybackBehavior(DEFAULT_PREFERENCES.keepPlayingWhenAppKilled);
            useThemeStore.getState().applyPresetTheme(DEFAULT_PREFERENCES.presetThemeColor);
            updateSettings({
              minLengthSec: null,
              maxLengthSec: null,
              minSizeMB: null,
              maxSizeMB: null,
            });
          },
        },
      ]
    );
  };

  const handleDeleteHiddenTrack = (item: { id: string; asset?: MediaLibrary.Asset; title: string }) => {
    Alert.alert(
      t('library.delete_confirm_title'),
      t('library.delete_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await MediaLibrary.deleteAssetsAsync([item.id]);
              if (success) {
                unhideTrack(item.id);
                const currentAssets = useStore.getState().allAssets;
                const updatedAssets = currentAssets.filter((a) => a.id !== item.id);
                useStore.getState().setAllAssets(updatedAssets);
                saveCachedLibrary(useStore.getState().library).catch(() => {});

                try {
                  const currentActive = await TrackPlayer.getActiveTrack();
                  if (currentActive && (currentActive.id === item.id || (item.asset?.uri && currentActive.url === item.asset.uri))) {
                    try {
                      await TrackPlayer.skipToNext();
                    } catch {
                      await TrackPlayer.pause();
                    }
                  }
                  const queue = await TrackPlayer.getQueue();
                  const trackIdx = queue.findIndex((t) => t.id === item.id || (item.asset?.uri && t.url === item.asset.uri));
                  if (trackIdx !== -1) {
                    await TrackPlayer.remove(trackIdx);
                  }
                } catch (e) {
                  console.warn('TrackPlayer update on delete failed', e);
                }

                Alert.alert(t('common.success'), t('library.delete_success'));
              } else {
                Alert.alert(t('common.error'), t('library.delete_error_permission'));
              }
            } catch (e) {
              console.error('Failed to delete asset', e);
              Alert.alert(t('common.error'), t('library.delete_error_generic'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllHiddenTracks = () => {
    if (hiddenTrackItems.length === 0) return;
    Alert.alert(
      t('settings.delete_all_hidden_confirm_title'),
      t('settings.delete_all_hidden_confirm_msg', { count: hiddenTrackItems.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const idsToDelete = hiddenTrackItems.map((item) => item.id);
              const success = await MediaLibrary.deleteAssetsAsync(idsToDelete);
              if (success) {
                unhideAllTracks();
                const currentAssets = useStore.getState().allAssets;
                const idSet = new Set(idsToDelete);
                const updatedAssets = currentAssets.filter((a) => !idSet.has(a.id));
                useStore.getState().setAllAssets(updatedAssets);
                saveCachedLibrary(useStore.getState().library).catch(() => {});

                try {
                  const currentActive = await TrackPlayer.getActiveTrack();
                  if (currentActive && idSet.has(currentActive.id)) {
                    try {
                      await TrackPlayer.skipToNext();
                    } catch {
                      await TrackPlayer.pause();
                    }
                  }
                  const queue = await TrackPlayer.getQueue();
                  for (let i = queue.length - 1; i >= 0; i--) {
                    if (idSet.has(queue[i].id)) {
                      await TrackPlayer.remove(i);
                    }
                  }
                } catch (e) {
                  console.warn('TrackPlayer update on delete all failed', e);
                }

                Alert.alert(t('common.success'), t('settings.delete_all_hidden_success'));
              } else {
                Alert.alert(t('common.error'), t('library.delete_error_permission'));
              }
            } catch (e) {
              console.error('Failed to delete all assets', e);
              Alert.alert(t('common.error'), t('library.delete_error_generic'));
            }
          },
        },
      ]
    );
  };

  const handleCheckUpdate = async () => {
    if (!Updates.isEnabled) {
      Alert.alert(
        t('settings.alerts.update_config_title'),
        t('settings.alerts.update_config_msg')
      );
      return;
    }

    setIsCheckingUpdate(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        Alert.alert(
          t('settings.alerts.update_found_title'),
          t('settings.alerts.update_found_msg')
        );
        const fetchResult = await Updates.fetchUpdateAsync();
        if (fetchResult.isNew) {
          Alert.alert(
            t('settings.alerts.update_ready_title'),
            t('settings.alerts.update_ready_msg'),
            [
              { text: t('settings.alerts.later'), style: 'cancel' },
              {
                text: t('settings.alerts.restart'),
                onPress: async () => {
                  await Updates.reloadAsync();
                },
              },
            ]
          );
        }
      } else {
        Alert.alert(
          t('settings.alerts.up_to_date_title'),
          t('settings.alerts.up_to_date_msg')
        );
      }
    } catch (e: any) {
      console.warn('Update check failed:', e);
      const msg = e?.message || '';
      if (msg.includes('failed to check for update') || msg.includes('channel-name')) {
        Alert.alert(
          t('settings.alerts.update_config_title'),
          t('settings.alerts.update_config_msg')
        );
      } else {
        Alert.alert(t('settings.alerts.update_check_title'), e?.message || t('settings.alerts.update_check_failed'));
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleThemePress = (item: (typeof PRESET_THEME_COLORS)[number]) => {
    const isDefault = item.color.toLowerCase() === '#3b82f6';
    const isUnlocked =
      isDefault ||
      preferences.isDevModeActive ||
      (preferences.unlockedThemes ?? []).some(
        (c) => c.toLowerCase() === item.color.toLowerCase()
      );

    if (isUnlocked) {
      updatePreferences({ presetThemeColor: item.color });
      useThemeStore.getState().applyPresetTheme(item.color);
      return;
    }

    const themeName = t(`themes.${item.id}`) || item.label;
    Alert.alert(
      t('settings.unlock_theme_title'),
      t('settings.unlock_theme_msg', { themeName }),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.unlock_theme_btn'),
          onPress: async () => {
            setIsLoadingThemeAd(true);
            try {
              const shown = await showRewardedAd({
                onRewarded: () => {
                  unlockTheme(item.color);
                  updatePreferences({ presetThemeColor: item.color });
                  useThemeStore.getState().applyPresetTheme(item.color);
                  setTimeout(() => {
                    Alert.alert(
                      '🎉 ' + t('settings.unlock_theme_title'),
                      t('settings.theme_unlocked_success', { themeName })
                    );
                  }, 400);
                },
                onError: () => {
                  setIsLoadingThemeAd(false);
                  Alert.alert(
                    t('settings.unlock_theme_title'),
                    t('settings.theme_ad_failed')
                  );
                },
                onClosed: () => {
                  setIsLoadingThemeAd(false);
                },
              });
              if (!shown) {
                setIsLoadingThemeAd(false);
              }
            } catch {
              setIsLoadingThemeAd(false);
            }
          },
        },
      ]
    );
  };

  const handleUnlockDynamicColor = () => {
    Alert.alert(
      t('settings.unlock_dynamic_theme_title'),
      t('settings.unlock_dynamic_theme_msg'),
      [
        { text: t('settings.alerts.cancel'), style: 'cancel' },
        {
          text: t('settings.unlock_theme_btn'),
          onPress: async () => {
            setIsLoadingThemeAd(true);
            try {
              const shown = await showRewardedAd({
                onRewarded: () => {
                  unlockDynamicColor();
                  const currentArtwork = useThemeStore.getState().currentArtworkUri;
                  if (currentArtwork) {
                    useThemeStore.getState().updateThemeFromArtwork(currentArtwork);
                  }
                  setTimeout(() => {
                    Alert.alert(
                      '🎉 ' + t('settings.unlock_dynamic_theme_title'),
                      t('settings.dynamic_theme_unlocked_success')
                    );
                  }, 400);
                },
                onError: () => {
                  setIsLoadingThemeAd(false);
                  Alert.alert(
                    t('settings.unlock_dynamic_theme_title'),
                    t('settings.theme_ad_failed')
                  );
                },
                onClosed: () => {
                  setIsLoadingThemeAd(false);
                },
              });
              if (!shown) {
                setIsLoadingThemeAd(false);
              }
            } catch {
              setIsLoadingThemeAd(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* ── İSTATİSTİKLER VE GEÇMİŞ (EN BAŞTA BUTON) ────────────────────────── */}
      <TouchableOpacity
        style={[styles.statButtonCard, { borderColor: theme.border || '#27272a' }]}
        activeOpacity={0.7}
        onPress={() => router.push('/statistics')}>
        <View style={[styles.statButtonIcon, { backgroundColor: `${theme.primary}20` }]}>
          <Ionicons name="stats-chart" size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statButtonTitle}>{t('settings.stats_title')}</Text>
          <Text style={styles.statButtonSubtitle}>{t('settings.stats_subtitle')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#a1a1aa" style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {/* Ad Banner - Ayarlar Başı */}
      <AdBanner style={{ marginBottom: 12 }} />

      {/* ── DİL (LANGUAGE) ─────────────────────────────────────────────────── */}
      <Section
        icon="globe-outline"
        title={t('settings.language_section')}
        subtitle={
          preferences.appLanguage === 'system'
            ? `${t('settings.lang_system')} (${resolvedLanguage === 'tr' ? 'Türkçe' : 'English'})`
            : preferences.appLanguage === 'tr'
            ? 'Türkçe'
            : 'English'
        }
        theme={theme}>
        <ChipsRow
          theme={theme}
          label={t('settings.language_label')}
          hint={t('settings.language_hint')}
          value={preferences.appLanguage || 'system'}
          options={languageOptions}
          onChange={(value) => updatePreferences({ appLanguage: value as AppLanguage })}
        />
      </Section>

      {/* ── RUNMUSIC CONNECTO (Wİ-Fİ KUMANDASI) ───────────────────────── */}
      <Section
        icon="radio-outline"
        title={t('settings.connecto_section')}
        subtitle={
          remoteMode === 'client' && connectionStatus === 'connected'
            ? t('settings.connecto_connected', { name: connectedDeviceName || '' })
            : isRemoteEnabled
            ? t('settings.connecto_server_active')
            : t('settings.connecto_off')
        }
        theme={theme}>
        <ToggleRow
          theme={theme}
          label={t('settings.connecto_label')}
          hint={t('settings.connecto_hint')}
          value={isRemoteEnabled}
          onChange={(v) => {
            setRemoteEnabled(v);
          }}
        />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.connecto_device_name')}</Text>
            <Text style={styles.rowHint}>{t('settings.connecto_device_name_hint')}</Text>
          </View>
          <TextInput
            style={[styles.smallInput, { width: 140, textAlign: 'left', paddingHorizontal: 10 }]}
            value={customDeviceName}
            onChangeText={setCustomDeviceName}
            onBlur={() => {
              const trimmed = customDeviceName.trim();
              if (!trimmed) {
                setCustomDeviceName(DEFAULT_DEVICE_NAME);
              } else if (trimmed !== customDeviceName) {
                setCustomDeviceName(trimmed);
              }
            }}
            placeholder={DEFAULT_DEVICE_NAME}
            placeholderTextColor="#71717a"
            maxLength={30}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.connecto_relay')}</Text>
            <Text style={styles.rowHint}>
              {t('settings.connecto_relay_hint')}
            </Text>
          </View>
          <TextInput
            style={[styles.smallInput, { width: 170, textAlign: 'left', paddingHorizontal: 10 }]}
            value={customRelayUrl || ''}
            onChangeText={(val) => setCustomRelayUrl(val.trim() || null)}
            placeholder="connectorelay.onrender.com"
            placeholderTextColor="#71717a"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <ActionRow
          theme={theme}
          icon="chevron-forward"
          label={
            remoteMode === 'client' && connectionStatus === 'connected'
              ? t('settings.connecto_connected', { name: connectedDeviceName || '' })
              : t('settings.connecto_connect_device')
          }
          hint={t('settings.connecto_connect_device_hint')}
          onPress={openDeviceSelector}
        />

        {trustedDevices.length > 0 && (
          <View style={{ marginTop: 8, paddingBottom: 6 }}>
            <Text style={[styles.rowLabel, { fontSize: 13, color: '#a1a1aa', marginBottom: 6 }]}>
              {t('settings.connecto_trusted_devices', { count: trustedDevices.length })}
            </Text>
            {trustedDevices.map((dev) => (
              <View
                key={dev.deviceId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: '#27272a44',
                }}>
                <View>
                  <Text style={{ fontSize: 14, color: '#FFFFFF', fontWeight: '500' }}>
                    {dev.deviceName}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#71717a' }}>
                    {t('settings.connecto_last_connected', {
                      date: new Date(dev.lastConnected).toLocaleDateString(),
                    })}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeTrustedDevice(dev.deviceId)}
                  hitSlop={8}
                  style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </Section>

      {/* ── ÇALMA ─────────────────────────────────────────────────────────── */}
      <Section icon="musical-notes-outline" title={t('settings.playback_section')} theme={theme}>
        <ChipsRow
          theme={theme}
          label={t('settings.default_sort')}
          hint={t('settings.default_sort_hint')}
          value={preferences.defaultSortOption}
          options={sortOptions}
          onChange={(value) => updatePreferences({ defaultSortOption: value as SortOption })}
        />
        <ToggleRow
          theme={theme}
          label={t('settings.restore_queue')}
          hint={t('settings.restore_queue_hint')}
          value={preferences.restoreQueueOnLaunch}
          onChange={(v) => updatePreferences({ restoreQueueOnLaunch: v })}
        />
        <ToggleRow
          theme={theme}
          label={t('settings.clear_queue_on_select')}
          hint={t('settings.clear_queue_on_select_hint')}
          value={preferences.clearQueueOnTrackSelect}
          onChange={(v) => updatePreferences({ clearQueueOnTrackSelect: v })}
        />
        <NumberRow
          theme={theme}
          label={t('settings.queue_buffer_target')}
          hint={t('settings.queue_buffer_target_hint')}
          placeholder="20"
          value={preferences.queueBufferTarget ?? 20}
          onChange={(v) => {
            const target = v !== null ? Math.max(5, Math.min(200, v)) : 20;
            const currentThreshold = preferences.queueReplenishThreshold ?? 10;
            const threshold = Math.min(currentThreshold, Math.max(1, target - 1));
            updatePreferences({
              queueBufferTarget: target,
              queueReplenishThreshold: threshold,
            });
          }}
        />
        <NumberRow
          theme={theme}
          label={t('settings.queue_replenish_threshold')}
          hint={t('settings.queue_replenish_threshold_hint')}
          placeholder="10"
          value={preferences.queueReplenishThreshold ?? 10}
          onChange={(v) => {
            const currentTarget = preferences.queueBufferTarget ?? 20;
            const threshold = v !== null ? Math.max(1, Math.min(currentTarget - 1, v)) : 10;
            updatePreferences({ queueReplenishThreshold: threshold });
          }}
        />
        <ToggleRow
          theme={theme}
          label={t('settings.keep_playing')}
          hint={t('settings.keep_playing_hint')}
          value={preferences.keepPlayingWhenAppKilled}
          onChange={(v) => {
            updatePreferences({ keepPlayingWhenAppKilled: v });
            syncAppKilledPlaybackBehavior(v);
          }}
        />
      </Section>

      {/* ── ŞARKI SÖZLERİ ─────────────────────────────────────────────────── */}
      <Section
        icon="mic-outline"
        title={t('settings.lyrics_section')}
        subtitle={cachedLyricsCount > 0 ? `${cachedLyricsCount} ${t('settings.cached_lyrics_count')}` : undefined}
        theme={theme}>
        <ToggleRow
          theme={theme}
          label={t('settings.auto_fetch_lyrics')}
          hint={t('settings.auto_fetch_lyrics_hint')}
          value={preferences.autoFetchLyrics}
          onChange={(v) => updatePreferences({ autoFetchLyrics: v })}
        />
        <ToggleRow
          theme={theme}
          label={t('settings.open_with_lyrics')}
          value={preferences.openPlayerWithLyrics}
          onChange={(v) => updatePreferences({ openPlayerWithLyrics: v })}
        />
        <ChipsRow
          theme={theme}
          label={t('settings.preferred_source')}
          hint={t('settings.preferred_source_hint')}
          value={preferences.lyricsSourcePreference}
          options={lyricsSources}
          onChange={(value) =>
            updatePreferences({ lyricsSourcePreference: value as LyricsSourcePreference })
          }
        />
        <ActionRow
          theme={theme}
          label={t('settings.clear_lyrics')}
          value={`${cachedLyricsCount} ${t('settings.records')}`}
          icon="trash-outline"
          destructive
          disabled={cachedLyricsCount === 0}
          onPress={handleClearLyricsCache}
        />
      </Section>

      {/* ── GÖRÜNÜM ───────────────────────────────────────────────────────── */}
      <Section icon="color-palette-outline" title={t('settings.appearance_section')} theme={theme}>
        {preferences.isDynamicColorUnlocked || preferences.isDevModeActive ? (
          <ToggleRow
            theme={theme}
            label={t('settings.dynamic_color')}
            hint={t('settings.dynamic_color_hint')}
            value={preferences.dynamicColorFromArtwork}
            onChange={(v) => {
              updatePreferences({ dynamicColorFromArtwork: v });
              if (!v) {
                const preset = preferences.presetThemeColor || '#3b82f6';
                useThemeStore.getState().applyPresetTheme(preset);
              }
            }}
          />
        ) : (
          <View style={styles.dynamicColorLockedCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.dynamic_color')}</Text>
              <Text style={styles.rowHint}>{t('settings.dynamic_color_hint')}</Text>
            </View>
            <TouchableOpacity
              style={styles.unlockDynamicBtn}
              activeOpacity={0.7}
              onPress={handleUnlockDynamicColor}>
              <Ionicons name="sparkles" size={15} color="#f59e0b" />
              <Text style={styles.unlockDynamicBtnText}>
                {t('settings.unlock_dynamic_theme_btn')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!preferences.dynamicColorFromArtwork && (
          <View style={styles.paletteSection}>
            <Text style={styles.paletteTitle}>{t('settings.preset_color_title')}</Text>
            <Text style={styles.paletteHint}>
              {t('settings.preset_color_hint')}
            </Text>
            <View style={styles.paletteGrid}>
              {PRESET_THEME_COLORS.map((item) => {
                const isSelected = (preferences.presetThemeColor || '#3b82f6') === item.color;
                const isDefault = item.color.toLowerCase() === '#3b82f6';
                const isUnlocked =
                  isDefault ||
                  preferences.isDevModeActive ||
                  (preferences.unlockedThemes ?? []).some(
                    (c) => c.toLowerCase() === item.color.toLowerCase()
                  );

                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.7}
                    onPress={() => handleThemePress(item)}
                    style={[
                      styles.paletteItem,
                      isSelected && {
                        borderColor: item.color,
                        backgroundColor: `${item.color}22`,
                      },
                      !isUnlocked && styles.paletteItemLocked,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(`themes.${item.id}`) || item.label} ${!isUnlocked ? `(${t('settings.theme_locked')})` : ''}`}
                    accessibilityState={{ selected: isSelected }}>
                    <View style={[styles.paletteColorCircle, { backgroundColor: item.color }]}>
                      {isSelected ? (
                        <Ionicons name="checkmark" size={16} color="#ffffff" />
                      ) : !isUnlocked ? (
                        <Ionicons name="lock-closed" size={12} color="#ffffff" />
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.paletteColorName,
                        isSelected && { color: '#ffffff', fontWeight: '700' },
                      ]}>
                      {t(`themes.${item.id}`) || item.label}
                    </Text>
                    {!isUnlocked ? (
                      <View style={styles.paletteLockBadge}>
                        <Ionicons name="play" size={8} color="#f59e0b" />
                        <Text style={styles.paletteLockBadgeText}>AD</Text>
                      </View>
                    ) : isDefault ? (
                      <Text style={styles.paletteFreeText}>{t('settings.theme_free')}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <ToggleRow
          theme={theme}
          label={t('settings.reduce_motion')}
          hint={t('settings.reduce_motion_hint')}
          value={preferences.reduceMotion}
          onChange={(v) => updatePreferences({ reduceMotion: v })}
        />
      </Section>

      {/* ── KİTAPLIK FİLTRELERİ ───────────────────────────────────────────── */}
      <Section
        icon="funnel-outline"
        title={t('settings.filters_section')}
        subtitle={t('settings.filters_subtitle')}
        theme={theme}>
        <NumberRow
          theme={theme}
          label={t('settings.min_duration')}
          hint={t('settings.min_duration_hint')}
          placeholder={t('settings.unlimited')}
          value={settings.minLengthSec}
          onChange={(v) => updateSettings({ minLengthSec: v })}
        />
        <NumberRow
          theme={theme}
          label={t('settings.max_duration')}
          placeholder={t('settings.unlimited')}
          value={settings.maxLengthSec}
          onChange={(v) => updateSettings({ maxLengthSec: v })}
        />
        <NumberRow
          theme={theme}
          label={t('settings.min_size')}
          placeholder={t('settings.unlimited')}
          value={settings.minSizeMB}
          onChange={(v) => updateSettings({ minSizeMB: v })}
          decimal
        />
        <NumberRow
          theme={theme}
          label={t('settings.max_size')}
          placeholder={t('settings.unlimited')}
          value={settings.maxSizeMB}
          onChange={(v) => updateSettings({ maxSizeMB: v })}
          decimal
        />
        <Text style={styles.noteText}>
          {t('settings.filters_note')}
        </Text>
      </Section>

      {/* ── GİZLENEN ŞARKILAR ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeader}
          activeOpacity={0.7}
          onPress={() => setIsHiddenExpanded(!isHiddenExpanded)}>
          <View style={styles.sectionIcon}>
            <Ionicons name="eye-off-outline" size={18} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{t('settings.hidden_tracks_title')}</Text>
          </View>
          <View style={[styles.countBadge, { backgroundColor: theme.surface }]}>
            <Text style={[styles.countBadgeText, { color: theme.textAccent }]}>
              {hiddenTrackIds.length}
            </Text>
          </View>
          <Ionicons
            name={isHiddenExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#a1a1aa"
            style={{ marginLeft: 8 }}
          />
        </TouchableOpacity>

        {isHiddenExpanded ? (
          <View style={styles.sectionBody}>
            {hiddenTrackItems.length > 0 ? (
              <>
                <View style={styles.actionsRow}>
                  <Text style={styles.smallMuted}>
                    {hiddenTrackItems.length} {t('settings.hidden_tracks_count')}
                  </Text>
                  <View style={styles.hiddenTrackActions}>
                    <TouchableOpacity style={styles.smallBtn} activeOpacity={0.7} onPress={unhideAllTracks}>
                      <Ionicons name="refresh" size={14} color={theme.primary} />
                      <Text style={[styles.smallBtnText, { color: theme.primary }]}>
                        {t('settings.restore_all')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.deleteBtn]}
                      activeOpacity={0.7}
                      onPress={handleDeleteAllHiddenTracks}>
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                      <Text style={[styles.smallBtnText, { color: '#ef4444' }]}>
                        {t('settings.delete_all_hidden')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {hiddenTrackItems.map((item) => (
                  <View key={item.id} style={styles.hiddenTrackItem}>
                    <TrackArtwork
                      uri={metadataMap[item.id]?.artwork || artworkMap[item.id]}
                      trackId={item.id}
                      trackUri={item.asset?.uri}
                      size={38}
                      borderRadius={8}
                      iconSize={18}
                    />
                    <View style={styles.hiddenTrackInfo}>
                      <View style={styles.hiddenTrackTitleRow}>
                        <Text style={styles.hiddenTrackTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.isUnplayable ? (
                          <View style={styles.unplayableBadge}>
                            <Ionicons name="warning" size={11} color="#f59e0b" style={{ marginRight: 3 }} />
                            <Text style={styles.unplayableBadgeText}>
                              {t('settings.unplayable_badge')}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.hiddenTrackSubtitleRow}>
                        {item.artist ? (
                          <Text style={styles.smallMuted} numberOfLines={1}>
                            {item.artist}
                            {item.duration != null ? ' • ' : ''}
                          </Text>
                        ) : null}
                        {item.duration != null ? (
                          <Text style={styles.smallMuted}>
                            {Math.floor(item.duration / 60)}:
                            {Math.floor(item.duration % 60)
                              .toString()
                              .padStart(2, '0')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.hiddenTrackActions}>
                      <TouchableOpacity
                        style={styles.smallBtn}
                        activeOpacity={0.7}
                        onPress={() => unhideTrack(item.id)}>
                        <Ionicons name="eye-outline" size={15} color={theme.primary} />
                        <Text style={[styles.smallBtnText, { color: theme.primary }]}>
                          {t('settings.restore')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.deleteBtn]}
                        activeOpacity={0.7}
                        onPress={() => handleDeleteHiddenTrack(item)}>
                        <Ionicons name="trash-outline" size={15} color="#ef4444" />
                        <Text style={[styles.smallBtnText, { color: '#ef4444' }]}>
                          {t('common.delete')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#52525b" />
                <Text style={styles.smallMuted}>{t('settings.no_hidden_tracks')}</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* ── VERİ VE BAKIM ─────────────────────────────────────────────────── */}
      <Section icon="server-outline" title={t('settings.data_section')} theme={theme}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.data_size')}</Text>
            <Text style={styles.rowHint}>
              {storageKB == null
                ? t('settings.calculating')
                : storageKB > 1024
                ? `${(storageKB / 1024).toFixed(1)} MB`
                : `${storageKB} KB`}
            </Text>
          </View>
          <TouchableOpacity style={styles.smallBtn} activeOpacity={0.7} onPress={refreshStorageUsage}>
            <Ionicons name="refresh" size={15} color={theme.primary} />
          </TouchableOpacity>
        </View>

        <ActionRow
          theme={theme}
          label={t('settings.clear_artwork')}
          value={`${artworkCount} ${t('settings.artwork_count')}`}
          icon="images-outline"
          onPress={handleClearArtworkCache}
        />
        <ActionRow
          theme={theme}
          label={t('settings.clear_up_next')}
          value={upNextCount > 0 ? `${upNextCount} ${t('settings.tracks_count')}` : t('settings.up_next_empty')}
          icon="list-outline"
          disabled={upNextCount === 0}
          onPress={handleClearUpNext}
        />
        <ActionRow
          theme={theme}
          label={t('settings.reset_settings')}
          hint={t('settings.reset_settings_hint')}
          icon="refresh-outline"
          destructive
          onPress={handleResetSettings}
        />
      </Section>

      {/* ── HAKKINDA ──────────────────────────────────────────────────────── */}
      <Section
        icon="information-circle-outline"
        title={t('settings.about_section')}
        subtitle={`RunMusic v${Constants.expoConfig?.version || '1.0.0'}`}
        theme={theme}>
        <View style={styles.detailsBox}>
          <DetailRow label={t('common.version')} value={`v${Constants.expoConfig?.version || '1.0.0'}`} />
          <DetailRow label={t('common.runtime')} value={Updates.runtimeVersion || '1.0.0'} />
          <DetailRow
            label={resolvedLanguage === 'tr' ? 'Kanal' : 'Channel'}
            value={Updates.channel || (Constants.expoConfig?.updates as { channel?: string } | undefined)?.channel || 'beta'}
          />
          <DetailRow
            label={resolvedLanguage === 'tr' ? 'Reklamlar' : 'Ads'}
            value={
              preferences.isDevModeActive
                ? resolvedLanguage === 'tr'
                  ? 'Dev Modu (Kapalı)'
                  : 'Dev Mode (Disabled)'
                : resolvedLanguage === 'tr'
                ? 'AdMob Test (Aktif)'
                : 'AdMob Test (Active)'
            }
          />
          <DetailRow
            label={t('common.active_bundle')}
            value={
              Updates.updateId
                ? `OTA (${Updates.updateId.slice(0, 8)})`
                : Updates.isEmbeddedLaunch
                ? (resolvedLanguage === 'tr' ? 'Yerel APK' : 'Embedded APK')
                : (resolvedLanguage === 'tr' ? 'Standart' : 'Standard')
            }
          />
          {Updates.createdAt ? (
            <DetailRow
              label={t('common.last_update')}
              value={`${new Date(Updates.createdAt).toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US')} ${new Date(
                Updates.createdAt
              ).toLocaleTimeString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`}
            />
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
          activeOpacity={0.7}
          onPress={handleCheckUpdate}
          disabled={isCheckingUpdate}>
          {isCheckingUpdate ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="cloud-download-outline" size={16} color="#ffffff" />
              <Text style={styles.primaryBtnText}>{t('settings.check_updates')}</Text>
            </>
          )}
        </TouchableOpacity>

        <ActionRow
          theme={theme}
          label={t('settings.source_code')}
          value="Runteryaa/RunMusic"
          icon="logo-github"
          onPress={() => Linking.openURL(GITHUB_URL).catch(() => {})}
        />
      </Section>

      {/* Ad Banner - Sayfa Sonu */}
      <AdBanner style={{ marginTop: 8 }} />
    </ScrollView>

    {isLoadingThemeAd && (
      <View style={styles.adLoadingOverlay}>
        <View style={styles.adLoadingCard}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.adLoadingText}>{t('settings.unlock_theme_loading')}</Text>
        </View>
      </View>
    )}
  </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı bileşenler (modül kapsamında: içeride tanımlanırsa her render'da
// yeniden mount olurlar ve açılır/kapanır durumu sıfırlanır)
// ─────────────────────────────────────────────────────────────────────────────

type Theme = ReturnType<typeof useThemeStore.getState>['theme'];

function Section({
  icon,
  title,
  subtitle,
  theme,
  children,
  defaultOpen = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  theme: Theme;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        activeOpacity={0.7}
        onPress={() => setOpen((v) => !v)}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={18} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#a1a1aa" />
      </TouchableOpacity>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function ToggleRow({
  theme,
  label,
  hint,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#3f3f46', true: theme.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

function ChipsRow({
  theme,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  theme: Theme;
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.columnRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      <View style={styles.chipsWrap}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <TouchableOpacity
              key={option.value}
              activeOpacity={0.7}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                active && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function NumberRow({
  theme,
  label,
  hint,
  placeholder,
  value,
  onChange,
  decimal = false,
}: {
  theme: Theme;
  label: string;
  hint?: string;
  placeholder: string;
  value: number | null;
  onChange: (value: number | null) => void;
  decimal?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <TextInput
        style={styles.smallInput}
        keyboardType={decimal ? 'decimal-pad' : 'numeric'}
        placeholder={placeholder}
        placeholderTextColor="#71717a"
        value={value?.toString() || ''}
        onChangeText={(text) => {
          const trimmed = text.trim();
          if (!trimmed) {
            onChange(null);
            return;
          }
          const parsed = decimal ? parseFloat(trimmed) : parseInt(trimmed, 10);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
    </View>
  );
}

function ActionRow({
  theme,
  label,
  hint,
  value,
  icon,
  onPress,
  destructive = false,
  disabled = false,
}: {
  theme: Theme;
  label: string;
  hint?: string;
  value?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const tint = disabled ? '#52525b' : destructive ? '#ef4444' : theme.primary;
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && !disabled && { color: '#ef4444' }]}>
          {label}
        </Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Ionicons name={icon} size={18} color={tint} style={{ marginLeft: 10 }} />
    </TouchableOpacity>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 14,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 2,
  },
  sectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a55',
  },
  columnRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a55',
  },
  rowText: {
    flex: 1,
    marginRight: 10,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  rowHint: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 3,
    lineHeight: 16,
  },
  rowValue: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '600',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  smallInput: {
    width: 96,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#121212',
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'right',
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  deleteBtn: {
    backgroundColor: '#ef44441a',
    borderWidth: 1,
    borderColor: '#ef444433',
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  smallMuted: {
    fontSize: 12,
    color: '#71717a',
  },
  noteText: {
    fontSize: 12,
    color: '#71717a',
    paddingTop: 12,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  hiddenTrackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a44',
  },
  hiddenTrackActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hiddenTrackInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  hiddenTrackTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  hiddenTrackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flexShrink: 1,
  },
  hiddenTrackSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  unplayableBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    flexShrink: 0,
  },
  unplayableBadgeText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  detailsBox: {
    backgroundColor: '#27272a55',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: '#a1a1aa',
  },
  detailValue: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
    gap: 8,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  statButtonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
  },
  statButtonIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statButtonTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  statButtonSubtitle: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 2,
  },
  paletteSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  paletteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  paletteHint: {
    fontSize: 12,
    color: '#a1a1aa',
    marginBottom: 12,
  },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paletteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#18181b',
    borderWidth: 1.5,
    borderColor: '#27272a',
    gap: 8,
    minWidth: '47%',
    flex: 1,
    maxWidth: '49%',
  },
  paletteColorCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteColorName: {
    fontSize: 12,
    color: '#d4d4d8',
    fontWeight: '500',
    flex: 1,
  },
  paletteItemLocked: {
    opacity: 0.9,
    borderStyle: 'dashed',
  },
  paletteLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  paletteLockBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#f59e0b',
  },
  paletteFreeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#71717a',
  },
  adLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  adLoadingCard: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    maxWidth: 240,
  },
  adLoadingText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  dynamicColorLockedCard: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    gap: 12,
  },
  unlockDynamicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  unlockDynamicBtnText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '700',
  },
});

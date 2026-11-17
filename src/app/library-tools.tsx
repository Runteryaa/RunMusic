import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TouchableOpacity } from '../components/ui/TouchableOpacity';
import { useStore, type TrackMetadata } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { useBackToLibrary } from '../hooks/useBackToLibrary';
import { cleanTrackFields, isPlaceholderArtist } from '../services/displayNames';
import {
  findDuplicateGroups,
  findMissingMetadata,
  formatToolDuration,
  type DuplicateGroup,
  type LibraryToolTrack,
  type MissingMetadataTrack,
} from '../services/libraryTools';
import { searchOnlineArtwork } from '../services/artworkSearchService';
import { saveCachedLibrary } from '../services/libraryStorage';

type Tab = 'duplicates' | 'metadata';

export default function LibraryToolsScreen() {
  const router = useRouter();
  useBackToLibrary();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);

  const library = useStore((state) => state.library);
  const metadataMap = useStore((state) => state.metadataMap);
  const artworkMap = useStore((state) => state.artworkMap);
  const hideTrack = useStore((state) => state.hideTrack);
  const setTrackMetadata = useStore((state) => state.setTrackMetadata);

  const [tab, setTab] = useState<Tab>('duplicates');
  /** Kullanıcının kopya grubunda "tut" dediği parça kimliği. */
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});
  const [hiddenCount, setHiddenCount] = useState(0);
  const [artworkBusyId, setArtworkBusyId] = useState<string | null>(null);

  /**
   * Kitaplıktaki her parçayı araç modeline çevirir. İsimler kütüphanede
   * gösterilenle birebir aynı olsun diye `cleanTrackFields` kullanılır; ham
   * dosya adı yalnızca başlık/etiket yoksa devreye girer.
   */
  const tracks = useMemo<LibraryToolTrack[]>(() => {
    return library.map((asset) => {
      const meta = metadataMap[asset.id] || metadataMap[asset.uri];
      const fields = cleanTrackFields(meta?.title || asset.filename, meta?.artist || '');
      return {
        id: asset.id,
        uri: asset.uri,
        filename: asset.filename,
        duration: meta?.duration ?? asset.duration ?? 0,
        title: fields.title || asset.filename,
        artist: isPlaceholderArtist(fields.artist) ? '' : fields.artist,
        album: meta?.album?.trim() || undefined,
        artwork: meta?.artwork || artworkMap[asset.id] || artworkMap[asset.uri] || undefined,
      };
    });
  }, [library, metadataMap, artworkMap]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(tracks), [tracks]);
  const missingMetadata = useMemo(() => findMissingMetadata(tracks), [tracks]);

  const keepIdFor = (group: DuplicateGroup): string =>
    keepByGroup[group.key] || group.tracks[0]?.id || '';

  /** Seçilen dosya dışındakileri gizler; dosya cihazdan silinmez. */
  const hideDuplicates = (group: DuplicateGroup) => {
    const keepId = keepIdFor(group);
    const toHide = group.tracks.filter((track) => track.id !== keepId);
    if (toHide.length === 0) return;
    toHide.forEach((track) => hideTrack(track.id));
    setHiddenCount((count) => count + toHide.length);
  };

  const hideAllDuplicates = () => {
    let hidden = 0;
    duplicateGroups.forEach((group) => {
      const keepId = keepIdFor(group);
      group.tracks.forEach((track) => {
        if (track.id === keepId) return;
        hideTrack(track.id);
        hidden += 1;
      });
    });
    if (hidden > 0) setHiddenCount((count) => count + hidden);
    // Kitaplık önbelleği bir sonraki açılışta gizlenenleri içermesin.
    const state = useStore.getState();
    saveCachedLibrary(state.library).catch(() => {});
    Alert.alert(t('common.ok'), t('tools.duplicates_hidden', { count: hidden }));
  };

  /** En iyi eşleşen kapağı parçaya uygular. */
  const fixArtwork = useCallback(
    async (track: MissingMetadataTrack) => {
      if (artworkBusyId) return;
      setArtworkBusyId(track.id);
      try {
        const results = await searchOnlineArtwork(track.title, track.artist);
        const best = results[0];
        if (!best?.artworkUrl) {
          Alert.alert(t('common.info'), t('tools.no_artwork_result'));
          return;
        }
        const existing = metadataMap[track.id] || metadataMap[track.uri] || {};
        const next: TrackMetadata = {
          ...existing,
          artwork: best.artworkUrl,
        };
        setTrackMetadata(track.id, next);
        if (track.uri && track.uri !== track.id) {
          setTrackMetadata(track.uri, next);
        }
        Alert.alert(t('common.ok'), t('tools.artwork_applied'));
      } catch (e) {
        console.warn('Artwork repair failed', e);
        Alert.alert(t('common.error'), t('tools.no_artwork_result'));
      } finally {
        setArtworkBusyId(null);
      }
    },
    [artworkBusyId, metadataMap, setTrackMetadata, t]
  );

  const renderDuplicateGroup = (group: DuplicateGroup) => {
    const keepId = keepIdFor(group);
    return (
      <View
        key={group.key}
        style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {group.title}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {group.artist || t('tools.missing_artist')} ·{' '}
          {t('tools.metadata_track_count', { count: group.tracks.length })}
        </Text>
        <Text style={styles.hint}>{t('tools.duplicates_keep_hint')}</Text>

        {group.tracks.map((track) => {
          const selected = keepId === track.id;
          return (
            <TouchableOpacity
              key={track.id}
              style={[
                styles.trackRow,
                { borderColor: selected ? theme.primary : 'rgba(255,255,255,0.08)' },
              ]}
              activeOpacity={0.75}
              onPress={() =>
                setKeepByGroup((current) => ({ ...current, [group.key]: track.id }))
              }>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? theme.primary : '#71717a'}
              />
              <View style={styles.trackText}>
                <Text style={styles.trackName} numberOfLines={1}>
                  {track.filename}
                </Text>
                <Text style={styles.trackMeta}>{formatToolDuration(track.duration)}</Text>
              </View>
              {selected ? <Text style={styles.keepBadge}>{t('tools.duplicates_keep')}</Text> : null}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.border }]}
          activeOpacity={0.75}
          onPress={() => hideDuplicates(group)}>
          <Ionicons name="eye-off-outline" size={15} color={theme.textAccent} />
          <Text style={[styles.actionText, { color: theme.textAccent }]}>
            {t('tools.duplicates_hide_others')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderMissingTrack = (track: MissingMetadataTrack) => (
    <View
      key={track.id}
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {track.title}
      </Text>
      <Text style={styles.cardSubtitle} numberOfLines={1}>
        {track.artist || '—'} · {formatToolDuration(track.duration)}
      </Text>
      <View style={styles.tagRow}>
        {track.missing.includes('artwork') ? (
          <Text style={styles.tag}>{t('tools.missing_artwork')}</Text>
        ) : null}
        {track.missing.includes('artist') ? (
          <Text style={styles.tag}>{t('tools.missing_artist')}</Text>
        ) : null}
        {track.missing.includes('album') ? (
          <Text style={styles.tag}>{t('tools.missing_album')}</Text>
        ) : null}
      </View>
      {track.missing.includes('artwork') ? (
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: theme.border }]}
          activeOpacity={0.75}
          disabled={artworkBusyId === track.id}
          onPress={() => fixArtwork(track)}>
          {artworkBusyId === track.id ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Ionicons name="image-outline" size={15} color={theme.textAccent} />
          )}
          <Text style={[styles.actionText, { color: theme.textAccent }]}>
            {artworkBusyId === track.id
              ? t('tools.searching_artwork')
              : t('tools.fix_artwork')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={12}
          activeOpacity={0.7}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/settings');
          }}>
          <Ionicons name="arrow-back" size={21} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('tools.title')}</Text>
          <Text style={styles.headerSubtitle}>{t('tools.subtitle')}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(['duplicates', 'metadata'] as Tab[]).map((value) => {
          const active = tab === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.tab, active && { backgroundColor: theme.primary }]}
              activeOpacity={0.75}
              onPress={() => setTab(value)}>
              <Text style={[styles.tabText, active && { color: '#ffffff', fontWeight: '700' }]}>
                {value === 'duplicates' ? t('tools.duplicates_tab') : t('tools.metadata_tab')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 24) + 32 },
        ]}
        showsVerticalScrollIndicator={false}>
        {tab === 'duplicates' ? (
          <>
            <Text style={styles.hint}>{t('tools.duplicates_hint')}</Text>
            <Text style={styles.countText}>
              {t('tools.duplicates_found', { count: duplicateGroups.length })}
              {hiddenCount > 0
                ? ` · ${t('tools.duplicates_hidden', { count: hiddenCount })}`
                : ''}
            </Text>
            {duplicateGroups.length === 0 ? (
              <Text style={styles.emptyText}>{t('tools.duplicates_none')}</Text>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
                  activeOpacity={0.8}
                  onPress={hideAllDuplicates}>
                  <Ionicons name="eye-off" size={16} color="#ffffff" />
                  <Text style={styles.primaryBtnText}>{t('tools.duplicates_hide_others')}</Text>
                </TouchableOpacity>
                {duplicateGroups.map(renderDuplicateGroup)}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.hint}>{t('tools.metadata_hint')}</Text>
            <Text style={styles.countText}>
              {t('tools.metadata_track_count', { count: missingMetadata.length })}
            </Text>
            {missingMetadata.length === 0 ? (
              <Text style={styles.emptyText}>{t('tools.metadata_none')}</Text>
            ) : (
              missingMetadata.map(renderMissingTrack)
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  tabText: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  hint: {
    fontSize: 12,
    color: '#a1a1aa',
    lineHeight: 17,
    marginBottom: 6,
  },
  countText: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 2,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 13,
    color: '#71717a',
    paddingVertical: 20,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 3,
    marginBottom: 6,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  trackText: {
    flex: 1,
  },
  trackName: {
    fontSize: 13,
    color: '#e4e4e7',
  },
  trackMeta: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  keepBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a1a1aa',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    marginTop: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    fontSize: 11,
    color: '#a1a1aa',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
});

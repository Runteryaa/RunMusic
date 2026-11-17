import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TouchableOpacity } from '../ui/TouchableOpacity';
import { useStore } from '../../store/useStore';
import { useThemeStore } from '../../store/useThemeStore';
import { useTranslation } from '../../services/i18n';
import { cleanTrackFields, isPlaceholderArtist } from '../../services/displayNames';
import {
  findDuplicateGroups,
  findMissingMetadata,
  formatToolDuration,
  type DuplicateGroup,
  type LibraryToolTrack,
  type MissingMetadataTrack,
} from '../../services/libraryTools';
import { deleteTracksFromDevice } from '../../services/libraryDeletion';
import { saveCachedLibrary } from '../../services/libraryStorage';
import { EditTrackModal, type EditTrackTarget } from '../EditTrackModal';

type Tab = 'duplicates' | 'metadata';

/**
 * Ayarlar ekranına gömülü kitaplık araçları.
 *
 * İki iş yapar: kopya dosyaları bulup **gizleme veya kalıcı silme**, ve
 * kapak/sanatçı/albümü eksik parçaların meta verilerini düzenleme. Düzenleme,
 * kütüphanedeki "Şarkı Bilgilerini Düzenle" ile aynı `EditTrackModal`'ı
 * kullandığı için alanlar ve davranış birebir aynıdır.
 *
 * Bileşen yalnızca bölüm açıldığında monte edilir; tüm kütüphaneyi tarayan
 * memo hesaplamaları bu yüzden Ayarlar açılışını yavaşlatmaz.
 */
export function LibraryToolsSection() {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);

  const library = useStore((state) => state.library);
  const metadataMap = useStore((state) => state.metadataMap);
  const artworkMap = useStore((state) => state.artworkMap);
  const hideTrack = useStore((state) => state.hideTrack);

  const [tab, setTab] = useState<Tab>('duplicates');
  /** Kullanıcının kopya grubunda "tut" dediği parça kimliği. */
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});
  /** Düzenlenmekte olan eksik meta verili parça. */
  const [editingTrack, setEditingTrack] = useState<EditTrackTarget | null>(null);

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
    saveCachedLibrary(useStore.getState().library).catch(() => {});
    Alert.alert(t('common.ok'), t('tools.duplicates_hidden', { count: toHide.length }));
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
    if (hidden === 0) return;
    saveCachedLibrary(useStore.getState().library).catch(() => {});
    Alert.alert(t('common.ok'), t('tools.duplicates_hidden', { count: hidden }));
  };

  /**
   * Seçilen dosya dışındakileri cihazdan **kalıcı olarak** siler.
   * Geri alınamadığı için her zaman ayrı bir onay ister.
   */
  const deleteDuplicates = (group: DuplicateGroup) => {
    const keepId = keepIdFor(group);
    const toDelete = group.tracks.filter((track) => track.id !== keepId);
    if (toDelete.length === 0) return;

    Alert.alert(
      t('tools.delete_confirm_title'),
      t('tools.delete_confirm_msg', { count: toDelete.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteTracksFromDevice(toDelete);
            if (result.failed) {
              Alert.alert(t('common.error'), t('tools.delete_failed'));
              return;
            }
            setKeepByGroup((current) => {
              const next = { ...current };
              delete next[group.key];
              return next;
            });
            Alert.alert(t('common.ok'), t('tools.deleted', { count: result.deleted }));
          },
        },
      ]
    );
  };

  const deleteAllDuplicates = () => {
    const toDelete: LibraryToolTrack[] = [];
    duplicateGroups.forEach((group) => {
      const keepId = keepIdFor(group);
      group.tracks.forEach((track) => {
        if (track.id !== keepId) toDelete.push(track);
      });
    });
    if (toDelete.length === 0) return;

    Alert.alert(
      t('tools.delete_confirm_title'),
      t('tools.delete_confirm_msg', { count: toDelete.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteTracksFromDevice(toDelete);
            if (result.failed) {
              Alert.alert(t('common.error'), t('tools.delete_failed'));
              return;
            }
            setKeepByGroup({});
            Alert.alert(t('common.ok'), t('tools.deleted', { count: result.deleted }));
          },
        },
      ]
    );
  };

  /** Parçanın tüm meta verilerini düzenleme ekranını açar. */
  const openEditor = (track: MissingMetadataTrack) => {
    setEditingTrack({
      id: track.id,
      uri: track.uri,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork ?? null,
      originalArtwork: null,
    });
  };

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

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnFlex, { borderColor: theme.border }]}
            activeOpacity={0.75}
            onPress={() => hideDuplicates(group)}>
            <Ionicons name="eye-off-outline" size={15} color={theme.textAccent} />
            <Text style={[styles.actionText, { color: theme.textAccent }]} numberOfLines={1}>
              {t('tools.duplicates_hide_others')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.actionBtnFlex,
              { borderColor: 'rgba(248, 113, 113, 0.45)' },
            ]}
            activeOpacity={0.75}
            onPress={() => deleteDuplicates(group)}>
            <Ionicons name="trash-outline" size={15} color="#f87171" />
            <Text style={[styles.actionText, { color: '#f87171' }]} numberOfLines={1}>
              {t('tools.delete_others')}
            </Text>
          </TouchableOpacity>
        </View>
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
      <TouchableOpacity
        style={[styles.actionBtn, { borderColor: theme.border }]}
        activeOpacity={0.75}
        onPress={() => openEditor(track)}>
        <Ionicons name="create-outline" size={15} color={theme.textAccent} />
        <Text style={[styles.actionText, { color: theme.textAccent }]}>
          {t('tools.edit_info')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View>
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

      {tab === 'duplicates' ? (
        <>
          <Text style={styles.hint}>{t('tools.duplicates_hint')}</Text>
          <Text style={styles.countText}>
            {t('tools.duplicates_found', { count: duplicateGroups.length })}
          </Text>
          {duplicateGroups.length === 0 ? (
            <Text style={styles.emptyText}>{t('tools.duplicates_none')}</Text>
          ) : (
            <>
              <View style={styles.bulkRow}>
                <TouchableOpacity
                  style={[styles.bulkBtn, { borderColor: theme.border }]}
                  activeOpacity={0.75}
                  onPress={hideAllDuplicates}>
                  <Ionicons name="eye-off" size={15} color={theme.textAccent} />
                  <Text style={[styles.bulkBtnText, { color: theme.textAccent }]}>
                    {t('tools.hide_all')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bulkBtn, { borderColor: 'rgba(248, 113, 113, 0.45)' }]}
                  activeOpacity={0.75}
                  onPress={deleteAllDuplicates}>
                  <Ionicons name="trash" size={15} color="#f87171" />
                  <Text style={[styles.bulkBtnText, { color: '#f87171' }]}>
                    {t('tools.delete_all')}
                  </Text>
                </TouchableOpacity>
              </View>
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

      <EditTrackModal
        visible={editingTrack != null}
        track={editingTrack}
        onClose={() => setEditingTrack(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: 6,
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
    paddingVertical: 16,
  },
  bulkRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  bulkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
  },
  bulkBtnText: {
    fontSize: 12,
    fontWeight: '600',
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
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  actionBtnFlex: {
    flex: 1,
    marginTop: 0,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
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

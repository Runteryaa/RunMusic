import { useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { cleanYouTubeTitle } from '../services/lyricsService';

export default function SettingsScreen() {
  const {
    settings,
    updateSettings,
    hiddenTrackIds,
    allAssets,
    unhideTrack,
    unhideAllTracks,
    artworkMap,
    metadataMap,
    lyricsCache,
    clearLyricsCache,
  } = useStore();

  const [isExpanded, setIsExpanded] = useState(false);

  const hiddenTrackItems = useMemo(() => {
    return hiddenTrackIds.map((id) => {
      const asset = allAssets.find((a) => a.id === id);
      const meta = metadataMap[id];
      let title = meta?.title?.trim() || '';
      if (!title && asset) {
        title = cleanYouTubeTitle(asset.filename);
      } else if (title) {
        title = cleanYouTubeTitle(title);
      } else {
        title = `Şarkı (${id})`;
      }
      return {
        id,
        asset,
        title,
        duration: asset?.duration,
        albumId: asset?.albumId,
      };
    });
  }, [allAssets, hiddenTrackIds, metadataMap]);

  const cachedLyricsCount = useMemo(() => {
    return Object.keys(lyricsCache || {}).length;
  }, [lyricsCache]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Gizlenen Şarkılar Collapsible Accordion */}
      <View style={styles.accordionCard}>
        <TouchableOpacity
          style={styles.accordionHeader}
          activeOpacity={0.7}
          onPress={() => setIsExpanded(!isExpanded)}>
          <View style={styles.accordionHeaderLeft}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="eye-off-outline" size={18} color="#3b82f6" />
            </View>
            <Text style={styles.accordionTitle}>Gizlenen Şarkılar</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{hiddenTrackIds.length}</Text>
            </View>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#a1a1aa"
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.accordionBody}>
            {hiddenTrackItems.length > 0 ? (
              <>
                <View style={styles.accordionActionsRow}>
                  <Text style={styles.hiddenCountSummary}>
                    {hiddenTrackItems.length} şarkı gizlendi
                  </Text>
                  <TouchableOpacity
                    style={styles.restoreAllBtn}
                    activeOpacity={0.7}
                    onPress={unhideAllTracks}>
                    <Ionicons name="refresh" size={14} color="#3b82f6" />
                    <Text style={styles.restoreAllBtnText}>Tümünü Geri Getir</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.hiddenTracksList}>
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
                        <Text style={styles.hiddenTrackTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.duration != null && (
                          <Text style={styles.hiddenTrackDuration}>
                            {Math.floor(item.duration / 60)}:
                            {Math.floor(item.duration % 60)
                              .toString()
                              .padStart(2, '0')}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={styles.unhideBtn}
                        activeOpacity={0.7}
                        onPress={() => unhideTrack(item.id)}>
                        <Ionicons name="eye-outline" size={15} color="#3b82f6" />
                        <Text style={styles.unhideBtnText}>Geri Getir</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.emptyHiddenState}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#52525b" />
                <Text style={styles.emptyHiddenText}>Gizlenen şarkı bulunmuyor.</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Şarkı Sözleri Önbelleği */}
      <View style={styles.lyricsCard}>
        <View style={styles.lyricsCardHeader}>
          <View style={styles.lyricsCardLeft}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="mic-outline" size={18} color="#3b82f6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accordionTitle}>Şarkı Sözleri Önbelleği</Text>
              <Text style={styles.lyricsCardSubtitle}>
                {cachedLyricsCount > 0
                  ? `${cachedLyricsCount} şarkı sözü çevrimdışı için kayıtlı`
                  : 'Henüz önbelleğe alınmış söz yok'}
              </Text>
            </View>
          </View>
          {cachedLyricsCount > 0 && (
            <TouchableOpacity
              style={styles.clearLyricsBtn}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert(
                  'Önbelleği Temizle',
                  'Kayıtlı tüm şarkı sözleri silinecek. Emin misiniz?',
                  [
                    { text: 'İptal', style: 'cancel' },
                    {
                      text: 'Temizle',
                      style: 'destructive',
                      onPress: clearLyricsCache,
                    },
                  ]
                );
              }}>
              <Ionicons name="trash-outline" size={14} color="#ef4444" />
              <Text style={styles.clearLyricsBtnText}>Temizle</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Global Filters Section */}
      <Text style={styles.sectionTitle}>Global Filters</Text>

      <View style={styles.settingRow}>
        <Text style={styles.label}>Min Track Length (seconds)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 30"
          placeholderTextColor="#71717a"
          value={settings.minLengthSec?.toString() || ''}
          onChangeText={(val) => updateSettings({ minLengthSec: val ? parseInt(val, 10) : null })}
        />
      </View>

      <View style={styles.settingRow}>
        <Text style={styles.label}>Max Track Length (seconds)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 600"
          placeholderTextColor="#71717a"
          value={settings.maxLengthSec?.toString() || ''}
          onChangeText={(val) => updateSettings({ maxLengthSec: val ? parseInt(val, 10) : null })}
        />
      </View>

      <View style={styles.settingRow}>
        <Text style={styles.label}>Min File Size (MB)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 1"
          placeholderTextColor="#71717a"
          value={settings.minSizeMB?.toString() || ''}
          onChangeText={(val) => updateSettings({ minSizeMB: val ? parseFloat(val) : null })}
        />
      </View>

      <View style={styles.settingRow}>
        <Text style={styles.label}>Max File Size (MB)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 50"
          placeholderTextColor="#71717a"
          value={settings.maxSizeMB?.toString() || ''}
          onChangeText={(val) => updateSettings({ maxSizeMB: val ? parseFloat(val) : null })}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  accordionCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 26,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  countBadge: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  countBadgeText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
  },
  accordionBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  accordionActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    marginBottom: 8,
  },
  hiddenCountSummary: {
    fontSize: 13,
    color: '#71717a',
    fontWeight: '500',
  },
  restoreAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  restoreAllBtnText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '600',
  },
  hiddenTracksList: {
    gap: 8,
    marginTop: 4,
  },
  hiddenTrackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a44',
  },
  hiddenTrackInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  hiddenTrackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  hiddenTrackDuration: {
    fontSize: 12,
    color: '#71717a',
  },
  unhideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  unhideBtnText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyHiddenState: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyHiddenText: {
    color: '#71717a',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 18,
  },
  settingRow: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    color: '#a1a1aa',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#18181b',
    color: '#ffffff',
    fontSize: 15,
  },
  lyricsCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 26,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  lyricsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lyricsCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  lyricsCardSubtitle: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 2,
  },
  clearLyricsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  clearLyricsBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
});

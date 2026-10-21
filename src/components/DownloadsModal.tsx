import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, { Track } from 'react-native-track-player';
import { useDownloadStore } from '../store/useDownloadStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { useTranslation } from '../services/i18n';
import { setupTrackPlayerIfNeeded } from '../services/playerBootstrap';
import { toPlayableTrack } from '../services/playbackUri';
import {
  cancelDownload,
  addDownloadToLibrary,
  deleteDownloadedFile,
} from '../services/downloadManager';
import type { DownloadTask } from '../types/download';

export const DownloadsModal: React.FC = () => {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const isOpen = useExtensionStore((s) => s.isDownloadsModalOpen);
  const close = useExtensionStore((s) => s.closeDownloadsModal);

  const tasks = useDownloadStore((s) => s.tasks);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);
  const library = useStore((s) => s.library);

  const [addingMap, setAddingMap] = useState<Record<string, boolean>>({});

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handlePlayTrack = async (item: DownloadTask) => {
    if (!item.localFileUri) return;
    try {
      await setupTrackPlayerIfNeeded();
      const track: Track = toPlayableTrack({
        id: item.id,
        url: item.localFileUri,
        title: item.title,
        artist: item.artist,
        artwork: item.artwork,
      });
      await TrackPlayer.setQueue([track]);
      await TrackPlayer.play();
      if (item.artwork) {
        useStore.getState().setArtwork(item.id, item.artwork);
      }
      useStore.getState().setTrackMetadata(item.id, {
        title: item.title,
        artist: item.artist,
        artwork: item.artwork,
      });
      useStore.setState({
        contextIds: [item.id],
        upNextIds: [],
      });
    } catch (err: any) {
      console.warn('[DownloadsModal] Oynatma hatası:', err);
      Alert.alert(t('downloads.play_error_title'), err?.message || t('downloads.play_error_msg'));
    }
  };

  const handleAddToLibrary = async (item: DownloadTask) => {
    if (addingMap[item.id]) return;

    setAddingMap((prev) => ({ ...prev, [item.id]: true }));
    try {
      await addDownloadToLibrary(item.id);
      Alert.alert(t('common.success'), t('downloads.added_to_library_success', { title: item.title }));
    } catch (err: any) {
      Alert.alert(t('downloads.add_to_library_error_title'), err?.message || t('common.error'));
    } finally {
      setAddingMap((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleDeleteTask = (item: DownloadTask) => {
    if (item.status === 'downloading') {
      cancelDownload(item.id);
    } else {
      deleteDownloadedFile(item.id);
    }
  };

  const renderItem = ({ item }: { item: DownloadTask }) => {
    const isDownloading = item.status === 'downloading';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';
    const isInLibrary = Boolean(
      item.mediaLibraryAssetId ||
      item.storageTarget === 'public' ||
      library.some(
        (a) =>
          a.id === item.mediaLibraryAssetId ||
          a.id === `local_${item.id}` ||
          (item.localFileUri && a.uri === item.localFileUri)
      )
    );
    const isAdding = !!addingMap[item.id];

    return (
      <View style={styles.taskCard}>
        {/* Üst Bilgi Satırı */}
        <View style={styles.taskInfoRow}>
          <TouchableOpacity
            style={[styles.taskIconWrap, isCompleted && { backgroundColor: '#10b98120' }]}
            activeOpacity={isCompleted ? 0.7 : 1}
            onPress={() => isCompleted && handlePlayTrack(item)}
          >
            {item.artwork ? (
              <Image source={{ uri: item.artwork }} style={styles.artworkImg} />
            ) : (
              <Ionicons
                name={
                  isCompleted
                    ? 'play'
                    : isFailed
                    ? 'alert-circle'
                    : 'arrow-down-circle'
                }
                size={22}
                color={isCompleted ? '#10b981' : isFailed ? '#ef4444' : theme.primary}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.taskTextWrap}
            activeOpacity={isCompleted ? 0.7 : 1}
            onPress={() => isCompleted && handlePlayTrack(item)}
          >
            <Text style={styles.taskTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.taskArtist} numberOfLines={1}>
              {item.artist}
              {item.totalBytes > 0 || item.downloadedBytes > 0
                ? ` • ${formatBytes(item.totalBytes || item.downloadedBytes)}`
                : ''}
            </Text>

            {isDownloading && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.round(item.progress * 100)}%`, backgroundColor: theme.primary },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>
                  %{Math.round(item.progress * 100)} ({formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)})
                </Text>
              </View>
            )}

            {isFailed && (
              <Text style={styles.errorText} numberOfLines={1}>
                {item.error || t('downloads.error_generic')}
              </Text>
            )}
          </TouchableOpacity>

          {/* Aksiyon Butonları */}
          <View style={styles.topActions}>
            {isCompleted && (
              <TouchableOpacity
                style={styles.actionBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => handlePlayTrack(item)}
              >
                <Ionicons name="play-circle" size={26} color={theme.primary} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.actionBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => handleDeleteTask(item)}
            >
              <Ionicons
                name={isDownloading ? 'close' : 'trash-outline'}
                size={20}
                color="#a1a1aa"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Tamamlanan Parçalar İçin Alt Çubuk (Kütüphaneye Ekle Butonu) */}
        {isCompleted && (
          <View style={styles.cardFooter}>
            <View style={styles.storageBadge}>
              <Ionicons name="shield-checkmark" size={12} color="#71717a" style={{ marginRight: 4 }} />
              <Text style={styles.storageBadgeText}>
                {item.storageTarget === 'public'
                  ? t('downloads.public_storage')
                  : t('downloads.private_storage')}
              </Text>
            </View>

            {isInLibrary ? (
              <View style={styles.inLibraryBadge}>
                <Ionicons name="checkmark-done" size={14} color="#10b981" style={{ marginRight: 4 }} />
                <Text style={styles.inLibraryText}>{t('downloads.in_library')}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addToLibBtn, { borderColor: theme.primary }]}
                activeOpacity={0.7}
                onPress={() => handleAddToLibrary(item)}
                disabled={isAdding}
              >
                {isAdding ? (
                  <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 4 }} />
                ) : (
                  <Ionicons name="add" size={14} color={theme.primary} style={{ marginRight: 3 }} />
                )}
                <Text style={[styles.addToLibText, { color: theme.primary }]}>
                  {isAdding ? t('downloads.adding') : t('downloads.add_to_library')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="download" size={24} color={theme.primary} style={{ marginRight: 10 }} />
            <Text style={styles.headerTitle}>{t('downloads.title')}</Text>
          </View>

          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Liste Başlığı & Temizleme Butonu */}
        {tasks.some((t) => t.status === 'completed') && (
          <View style={styles.subHeader}>
            <Text style={styles.tasksCount}>{t('downloads.tasks_count', { count: tasks.length })}</Text>
            <TouchableOpacity onPress={clearCompleted}>
              <Text style={[styles.clearText, { color: theme.primary }]}>{t('downloads.clear_completed')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Görev Listesi */}
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-download-outline" size={54} color="#3f3f46" />
              <Text style={styles.emptyTitle}>{t('downloads.empty_title')}</Text>
              <Text style={styles.emptySubtitle}>
                {t('downloads.empty_subtitle')}
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  tasksCount: {
    fontSize: 13,
    color: '#71717a',
    fontWeight: '600',
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  taskCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  taskInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  artworkImg: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  taskTextWrap: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  taskArtist: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBarBg: {
    height: 5,
    backgroundColor: '#27272a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 4,
  },
  errorText: {
    fontSize: 11,
    color: '#ef4444',
    marginTop: 4,
  },
  actionBtn: {
    padding: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  storageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  storageBadgeText: {
    fontSize: 11,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  inLibraryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10b98118',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10b98140',
  },
  inLibraryText: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
  },
  addToLibBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  addToLibText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#e4e4e7',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 18,
  },
});

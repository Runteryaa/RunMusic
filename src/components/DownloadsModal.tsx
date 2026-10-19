import React from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadStore } from '../store/useDownloadStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { useThemeStore } from '../store/useThemeStore';
import { cancelDownload } from '../services/downloadManager';
import type { DownloadTask } from '../types/download';

export const DownloadsModal: React.FC = () => {
  const theme = useThemeStore((s) => s.theme);
  const isOpen = useExtensionStore((s) => s.isDownloadsModalOpen);
  const close = useExtensionStore((s) => s.closeDownloadsModal);

  const tasks = useDownloadStore((s) => s.tasks);
  const removeTask = useDownloadStore((s) => s.removeTask);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);
  const defaultTarget = useDownloadStore((s) => s.defaultStorageTarget);
  const setDefaultTarget = useDownloadStore((s) => s.setDefaultStorageTarget);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const renderItem = ({ item }: { item: DownloadTask }) => {
    const isDownloading = item.status === 'downloading';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';

    return (
      <View style={styles.taskCard}>
        <View style={styles.taskInfoRow}>
          <View style={[styles.taskIconWrap, isCompleted && { backgroundColor: '#10b98120' }]}>
            <Ionicons
              name={
                isCompleted
                  ? 'checkmark-circle'
                  : isFailed
                  ? 'alert-circle'
                  : 'arrow-down-circle'
              }
              size={24}
              color={isCompleted ? '#10b981' : isFailed ? '#ef4444' : theme.primary}
            />
          </View>

          <View style={styles.taskTextWrap}>
            <Text style={styles.taskTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.taskArtist} numberOfLines={1}>
              {item.artist} • {item.storageTarget === 'public' ? 'Müzik Klasörü' : 'Özel Depolama'}
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
                {item.error || 'İndirme hatası'}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.actionBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => {
              if (isDownloading) {
                cancelDownload(item.id);
              } else {
                removeTask(item.id);
              }
            }}
          >
            <Ionicons
              name={isDownloading ? 'close' : 'trash-outline'}
              size={20}
              color="#a1a1aa"
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="download" size={24} color={theme.primary} style={{ marginRight: 10 }} />
            <Text style={styles.headerTitle}>İndirme Yöneticisi</Text>
          </View>

          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Target Storage Selector */}
        <View style={styles.storageSelectorBox}>
          <Text style={styles.storageSelectorLabel}>Kayıt Konumu:</Text>
          <View style={styles.storageTabs}>
            <TouchableOpacity
              style={[styles.storageTab, defaultTarget === 'public' && { backgroundColor: theme.primary }]}
              onPress={() => setDefaultTarget('public')}
            >
              <Text style={[styles.storageTabText, defaultTarget === 'public' && styles.storageTabTextActive]}>
                Cihaz Müzik Klasörü
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.storageTab, defaultTarget === 'private' && { backgroundColor: theme.primary }]}
              onPress={() => setDefaultTarget('private')}
            >
              <Text style={[styles.storageTabText, defaultTarget === 'private' && styles.storageTabTextActive]}>
                Özel Depolama
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* List Header Actions */}
        {tasks.some((t) => t.status === 'completed') && (
          <View style={styles.subHeader}>
            <Text style={styles.tasksCount}>{tasks.length} Görev</Text>
            <TouchableOpacity onPress={clearCompleted}>
              <Text style={[styles.clearText, { color: theme.primary }]}>Tamamlananları Temizle</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tasks List */}
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-download-outline" size={54} color="#3f3f46" />
              <Text style={styles.emptyTitle}>Henüz indirme yok</Text>
              <Text style={styles.emptySubtitle}>
                Eklentilerden arattığınız şarkıları indirdiğinizde burada görünecektir.
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
  storageSelectorBox: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f23',
    backgroundColor: '#18181b',
  },
  storageSelectorLabel: {
    fontSize: 12,
    color: '#a1a1aa',
    marginBottom: 8,
    fontWeight: '600',
  },
  storageTabs: {
    flexDirection: 'row',
    backgroundColor: '#09090b',
    borderRadius: 10,
    padding: 3,
  },
  storageTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  storageTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#71717a',
  },
  storageTabTextActive: {
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
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
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
    marginLeft: 8,
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

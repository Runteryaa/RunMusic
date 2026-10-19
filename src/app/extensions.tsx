import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExtensionStore } from '../store/useExtensionStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { ExtensionWebView } from '../components/ExtensionWebView';
import { InstallExtensionModal } from '../components/InstallExtensionModal';
import { DownloadsModal } from '../components/DownloadsModal';

export default function ExtensionsScreen() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);

  const extensions = useExtensionStore((s) => s.extensions);
  const activeExtensionId = useExtensionStore((s) => s.activeExtensionId);
  const setActiveExtensionId = useExtensionStore((s) => s.setActiveExtensionId);
  const openInstallModal = useExtensionStore((s) => s.openInstallModal);
  const openDownloadsModal = useExtensionStore((s) => s.openDownloadsModal);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);
  const updateExtension = useExtensionStore((s) => s.updateExtension);

  const downloadTasks = useDownloadStore((s) => s.tasks);
  const activeDownloadsCount = useMemo(() => {
    return downloadTasks.filter((t) => t.status === 'downloading' || t.status === 'queued').length;
  }, [downloadTasks]);

  const enabledExtensions = useMemo(() => {
    return extensions.filter((e) => e.isEnabled);
  }, [extensions]);

  const activeExtension = useMemo(() => {
    if (!activeExtensionId) return enabledExtensions[0] || null;
    return extensions.find((e) => e.manifest.id === activeExtensionId && e.isEnabled) || enabledExtensions[0] || null;
  }, [extensions, activeExtensionId, enabledExtensions]);

  const handleExtensionOptions = (ext: typeof extensions[0]) => {
    Alert.alert(
      ext.manifest.name,
      `${ext.manifest.description || 'Eklenti'} (v${ext.manifest.version})\n\nManifest: ${ext.manifestUrl}`,
      [
        { text: t('common.cancel') || 'İptal', style: 'cancel' },
        {
          text: 'Güncellemeleri Kontrol Et',
          onPress: async () => {
            const res = await updateExtension(ext.manifest.id);
            if (res) {
              Alert.alert('Güncellendi', `"${res.manifest.name}" başarıyla güncellendi.`);
            } else {
              Alert.alert('Bilgi', 'Eklenti güncellenemedi veya zaten en son sürümde.');
            }
          },
        },
        {
          text: 'Eklentiyi Kaldır',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Eklentiyi Sil',
              `"${ext.manifest.name}" eklentisini kaldırmak istediğinizden emin misiniz?`,
              [
                { text: t('common.cancel') || 'İptal', style: 'cancel' },
                {
                  text: t('common.delete') || 'Sil',
                  style: 'destructive',
                  onPress: () => uninstallExtension(ext.manifest.id),
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>{t('tabs.extensions') || 'Eklentiler'}</Text>
        </View>

        <View style={styles.headerRight}>
          {/* Downloads Manager Button */}
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={openDownloadsModal}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-down-circle-outline" size={24} color="#ffffff" />
            {activeDownloadsCount > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <Text style={styles.badgeText}>{activeDownloadsCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Add Extension Button */}
          <TouchableOpacity
            style={[styles.headerActionBtn, styles.addBtn, { backgroundColor: theme.primary }]}
            onPress={openInstallModal}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="add" size={20} color="#ffffff" />
            <Text style={styles.addBtnText}>Ekle</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Extension Switcher Bar (Tabs) */}
      {enabledExtensions.length > 0 && (
        <View style={styles.switcherBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.switcherScroll}
          >
            {enabledExtensions.map((ext) => {
              const isSelected = activeExtension?.manifest.id === ext.manifest.id;
              return (
                <TouchableOpacity
                  key={ext.manifest.id}
                  style={[
                    styles.extTab,
                    isSelected && [styles.extTabActive, { borderColor: theme.primary }],
                  ]}
                  onPress={() => setActiveExtensionId(ext.manifest.id)}
                  onLongPress={() => handleExtensionOptions(ext)}
                >
                  <Ionicons
                    name="globe-outline"
                    size={16}
                    color={isSelected ? theme.primary : '#a1a1aa'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.extTabText,
                      isSelected && { color: '#ffffff', fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                  >
                    {ext.manifest.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleExtensionOptions(ext)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginLeft: 6 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={13} color="#71717a" />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Main Content Area */}
      <View style={styles.content}>
        {activeExtension ? (
          <ExtensionWebView key={activeExtension.manifest.id} extension={activeExtension} />
        ) : (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconWrap, { backgroundColor: theme.primary + '15' }]}>
              <Ionicons name="extension-puzzle-outline" size={54} color={theme.primary} />
            </View>
            <Text style={styles.emptyTitle}>Henüz bir eklenti eklenmedi</Text>
            <Text style={styles.emptySubtitle}>
              Müzik aramak, dinlemek veya indirmek için topluluk tarafından hazırlanan bir eklenti manifest {"URL'si"} ekleyin.
            </Text>

            <TouchableOpacity
              style={[styles.emptyAddBtn, { backgroundColor: theme.primary }]}
              onPress={openInstallModal}
            >
              <Ionicons name="add-circle-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.emptyAddBtnText}>Eklenti Ekle</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Modals */}
      <InstallExtensionModal />
      <DownloadsModal />
    </SafeAreaView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f23',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerActionBtn: {
    position: 'relative',
    padding: 6,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  switcherBar: {
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    backgroundColor: '#18181b',
  },
  switcherScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  extTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  extTabActive: {
    backgroundColor: '#09090b',
  },
  extTabText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 140,
  },
  content: {
    flex: 1,
    backgroundColor: '#121212',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 28,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyAddBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});

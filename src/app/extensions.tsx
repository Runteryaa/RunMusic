import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
  BackHandler,
  Image,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExtensionStore } from '../store/useExtensionStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { ExtensionWebView } from '../components/ExtensionWebView';
import { DownloadsModal } from '../components/DownloadsModal';
import type { InstalledExtension } from '../types/extension';

export default function ExtensionsScreen() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);

  const extensions = useExtensionStore((s) => s.extensions);
  const installExtension = useExtensionStore((s) => s.installExtension);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);
  const updateExtension = useExtensionStore((s) => s.updateExtension);
  const openDownloadsModal = useExtensionStore((s) => s.openDownloadsModal);

  const downloadTasks = useDownloadStore((s) => s.tasks);
  const activeDownloadsCount = useMemo(() => {
    return downloadTasks.filter((t) => t.status === 'downloading' || t.status === 'queued').length;
  }, [downloadTasks]);

  const [inputUrl, setInputUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [openedExtensionId, setOpenedExtensionId] = useState<string | null>(null);

  const openedExtension = useMemo(() => {
    if (!openedExtensionId) return null;
    return extensions.find((e) => e.manifest.id === openedExtensionId) || null;
  }, [extensions, openedExtensionId]);

  // Donanım geri tuşu: Eğer eklenti sitesi açıksa kapat ve listeye dön
  useEffect(() => {
    const onBackPress = () => {
      if (openedExtensionId) {
        setOpenedExtensionId(null);
        return true;
      }
      return false;
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [openedExtensionId]);

  const handleAddExtension = async () => {
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      Alert.alert(t('common.error') || 'Hata', 'Lütfen geçerli bir eklenti manifest URL\'si girin.');
      return;
    }

    Keyboard.dismiss();
    setIsInstalling(true);
    try {
      const ext = await installExtension(trimmed);
      setInputUrl('');
      Alert.alert(
        'Eklenti Yüklendi',
        `"${ext.manifest.name}" başarıyla kuruldu. Açmak için listeden seçebilirsiniz.`
      );
    } catch (err: any) {
      Alert.alert('Kurulum Başarısız', err?.message || 'Eklenti manifest dosyası yüklenemedi.');
    } finally {
      setIsInstalling(false);
    }
  };

  const handleExtensionOptions = (ext: InstalledExtension) => {
    Alert.alert(
      ext.manifest.name,
      `${ext.manifest.description || 'Web Eklentisi'}\nSürüm: v${ext.manifest.version}\nYazar: ${ext.manifest.author || 'Topluluk'}\n\nManifest: ${ext.manifestUrl}`,
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
              'Eklentiyi Kaldır',
              `"${ext.manifest.name}" eklentisini silmek istediğinizden emin misiniz?`,
              [
                { text: t('common.cancel') || 'İptal', style: 'cancel' },
                {
                  text: t('common.delete') || 'Sil',
                  style: 'destructive',
                  onPress: () => {
                    if (openedExtensionId === ext.manifest.id) {
                      setOpenedExtensionId(null);
                    }
                    uninstallExtension(ext.manifest.id);
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  // Eklenti web sitesi açıksa WebView ekranı ve sağ üstte kapatma 'X' butonu
  if (openedExtension) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Website Top Bar */}
        <View style={styles.webHeader}>
          <View style={styles.webHeaderLeft}>
            <View style={[styles.webHeaderIconWrap, { backgroundColor: theme.primary + '20' }]}>
              {openedExtension.manifest.icon ? (
                <Image
                  source={{ uri: openedExtension.manifest.icon }}
                  style={styles.webHeaderIconImg}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="globe-outline" size={18} color={theme.primary} />
              )}
            </View>
            <View style={styles.webHeaderInfo}>
              <Text style={styles.webHeaderTitle} numberOfLines={1}>
                {openedExtension.manifest.name}
              </Text>
              <Text style={styles.webHeaderSubtitle} numberOfLines={1}>
                {openedExtension.manifest.entryUrl}
              </Text>
            </View>
          </View>

          <View style={styles.webHeaderRight}>
            {/* Downloads Manager Button */}
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={openDownloadsModal}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-down-circle-outline" size={22} color="#ffffff" />
              {activeDownloadsCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                  <Text style={styles.badgeText}>{activeDownloadsCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Sağ üst Kapat 'X' Butonu */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setOpenedExtensionId(null)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* WebView İçeriği */}
        <View style={styles.webContent}>
          <ExtensionWebView key={openedExtension.manifest.id} extension={openedExtension} />
        </View>

        <DownloadsModal />
      </SafeAreaView>
    );
  }

  // Liste Görünümü: Üstte URL inputu + Ekle butonu, altta şarkılar gibi dizilen eklentiler
  const renderExtensionItem = (item: InstalledExtension) => {
    const hasCustomIcon =
      item.manifest.icon &&
      (item.manifest.icon.startsWith('http://') || item.manifest.icon.startsWith('https://'));

    return (
      <View style={styles.trackItem} key={item.manifest.id}>
        <TouchableOpacity
          style={styles.trackMainContent}
          activeOpacity={0.7}
          onPress={() => setOpenedExtensionId(item.manifest.id)}
          onLongPress={() => handleExtensionOptions(item)}
        >
          {/* Sol İkon / Resim */}
          <View style={{ marginRight: 12 }}>
            {hasCustomIcon ? (
              <Image
                source={{ uri: item.manifest.icon }}
                style={styles.trackArtwork}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.trackArtworkPlaceholder, { backgroundColor: theme.primary + '18' }]}>
                <Ionicons name="extension-puzzle-outline" size={22} color={theme.primary} />
              </View>
            )}
          </View>

          {/* Başlık ve Bilgi */}
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {item.manifest.name}
            </Text>
            <Text style={styles.trackDuration} numberOfLines={1}>
              v{item.manifest.version}
              {item.manifest.author ? ` • ${item.manifest.author}` : ''}
              {item.manifest.description ? ` • ${item.manifest.description}` : ''}
            </Text>
          </View>

          {/* Açma Oku */}
          <Ionicons
            name="chevron-forward"
            size={18}
            color="#71717a"
            style={{ marginHorizontal: 4 }}
          />
        </TouchableOpacity>

        {/* Seçenekler / Menü Butonu */}
        <TouchableOpacity
          style={styles.trackMoreBtn}
          onPress={() => handleExtensionOptions(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={16} color="#71717a" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconWrap, { backgroundColor: theme.primary + '15' }]}>
        <Ionicons name="extension-puzzle-outline" size={48} color={theme.primary} />
      </View>
      <Text style={styles.emptyTitle}>Henüz bir eklenti eklenmedi</Text>
      <Text style={styles.emptySubtitle}>
        Yukarıdaki alana bir eklenti manifest {"URL'si"} girip {`"Ekle"`} butonuna basarak kütüphanenize yeni eklentiler ekleyebilirsiniz.
      </Text>
      <TouchableOpacity
        style={[styles.emptyQuickAddBtn, { borderColor: theme.primary }]}
        onPress={() => {
          setInputUrl('https://runteryaa.github.io/RunMusic/manifest.json');
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="sparkles" size={16} color={theme.primary} style={{ marginRight: 6 }} />
        <Text style={[styles.emptyQuickAddBtnText, { color: theme.primary }]}>
          Örnek Eklenti {"URL'sini"} Doldur
        </Text>
      </TouchableOpacity>
    </View>
  );

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
        </View>
      </View>

      {/* URL Input & Add Button at the Top */}
      <View style={styles.inputSection}>
        <View style={styles.inputRow}>
          <View style={styles.inputContainer}>
            <Ionicons name="link-outline" size={18} color="#71717a" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Eklenti URL'si (ör. https://.../manifest.json)"
              placeholderTextColor="#52525b"
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleAddExtension}
              editable={!isInstalling}
            />
            {inputUrl.length > 0 && (
              <TouchableOpacity
                onPress={() => setInputUrl('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.clearBtn}
              >
                <Ionicons name="close-circle" size={18} color="#71717a" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: theme.primary }, isInstalling && { opacity: 0.7 }]}
            onPress={handleAddExtension}
            disabled={isInstalling}
            activeOpacity={0.8}
          >
            {isInstalling ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Ionicons name="add" size={18} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.addBtnText}>Ekle</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Quick Sample Fill */}
        <TouchableOpacity
          style={styles.sampleChip}
          onPress={() => setInputUrl('https://runteryaa.github.io/RunMusic/manifest.json')}
          activeOpacity={0.7}
        >
          <Ionicons name="sparkles-outline" size={13} color={theme.primary} style={{ marginRight: 6 }} />
          <Text style={[styles.sampleChipText, { color: theme.primary }]}>
            Örnek Eklenti {"URL'sini"} Yapıştır (RunMusic Sample)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Extensions List Header */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listHeaderTitle}>Yüklü Eklentiler</Text>
        {extensions.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{extensions.length}</Text>
          </View>
        )}
      </View>

      {/* Extensions List (styled like songs in library) */}
      <FlatList
        data={extensions}
        keyExtractor={(item) => item.manifest.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => renderExtensionItem(item)}
        ListEmptyComponent={renderEmptyState}
      />

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
  // Top Input Section
  inputSection: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1f',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sampleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sampleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // List Header
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  listHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#a1a1aa',
    letterSpacing: 0.2,
  },
  countBadge: {
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  countBadgeText: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 140, // MiniPlayer ve TabBar için nefes payı
  },
  // Track-style Extension Item (library ile birebir uyumlu)
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  trackMainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackArtwork: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  trackArtworkPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  trackDuration: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 3,
  },
  trackMoreBtn: {
    padding: 8,
  },
  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingTop: 40,
    paddingBottom: 60,
  },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  emptyQuickAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  emptyQuickAddBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Fullscreen Website View with Top Bar & Close 'X'
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f23',
    backgroundColor: '#18181b',
  },
  webHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  webHeaderIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  webHeaderIconImg: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  webHeaderInfo: {
    flex: 1,
  },
  webHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  webHeaderSubtitle: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 1,
  },
  webHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  webContent: {
    flex: 1,
    backgroundColor: '#121212',
  },
});

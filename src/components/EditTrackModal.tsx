import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import TrackPlayer, { State } from 'react-native-track-player';
import { useStore, TrackMetadata } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import {
  searchOnlineArtwork,
  OnlineArtworkResult,
} from '../services/artworkSearchService';
import { getArtworkAsync } from '../../modules/audio-artwork/src';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

export interface EditTrackTarget {
  id: string;
  uri?: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string | null;
  originalArtwork?: string | null;
}

interface EditTrackModalProps {
  visible: boolean;
  track: EditTrackTarget | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditTrackModal({
  visible,
  track,
  onClose,
  onSaved,
}: EditTrackModalProps) {
  const theme = useThemeStore((s) => s.theme);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);
  const setTrackMetadata = useStore((s) => s.setTrackMetadata);
  const resetTrackMetadata = useStore((s) => s.resetTrackMetadata);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [artworkUri, setArtworkUri] = useState<string | null>(null);

  // Online artwork search state
  const [isSearchingArtwork, setIsSearchingArtwork] = useState(false);
  const [onlineArtworkList, setOnlineArtworkList] = useState<OnlineArtworkResult[]>([]);
  const [showOnlineResults, setShowOnlineResults] = useState(false);

  const lastOpenedTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible && track) {
      if (lastOpenedTrackIdRef.current !== track.id) {
        lastOpenedTrackIdRef.current = track.id;
        const stored = metadataMap[track.id] || (track.uri ? metadataMap[track.uri] : undefined);
        const storedArt = artworkMap[track.id] || (track.uri ? artworkMap[track.uri] : undefined);

        setTitle(stored?.title ?? track.title ?? '');
        setArtist(stored?.artist ?? track.artist ?? '');
        setAlbum(stored?.album ?? track.album ?? '');
        setArtworkUri(stored?.artwork || storedArt || track.artwork || null);
        setShowOnlineResults(false);
        setOnlineArtworkList([]);
      }
    } else {
      lastOpenedTrackIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, track?.id, track?.uri]);

  if (!visible || !track) {
    return null;
  }

  // 1. Cihaz Galerisinden Seçme
  const handlePickFromGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'İzin Gerekli',
          'Kapak fotoğrafı seçebilmek için galeri erişim izni vermelisiniz.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setArtworkUri(result.assets[0].uri);
        setShowOnlineResults(false);
      }
    } catch (e) {
      console.warn('Image picker error:', e);
      Alert.alert('Hata', 'Fotoğraf seçilirken bir hata oluştu.');
    }
  };

  // 2. İnternetten Otomatik Kapak Bulma
  const handleSearchOnlineArtwork = async () => {
    const qTitle = title.trim() || track.title;
    const qArtist = artist.trim() || track.artist;

    if (!qTitle) {
      Alert.alert('Bilgi', 'Arama yapabilmek için lütfen bir şarkı başlığı girin.');
      return;
    }

    setIsSearchingArtwork(true);
    setShowOnlineResults(true);
    try {
      const results = await searchOnlineArtwork(qTitle, qArtist);
      setOnlineArtworkList(results);
    } catch {
      setOnlineArtworkList([]);
    } finally {
      setIsSearchingArtwork(false);
    }
  };

  // 3. Varsayılan Kapağa Sıfırlama
  const handleResetArtwork = () => {
    setArtworkUri(track.originalArtwork || null);
    setShowOnlineResults(false);
  };

  // 4. Tüm Bilgileri Orijinale Sıfırlama
  const handleFullReset = () => {
    Alert.alert(
      'Bilgileri Sıfırla',
      'Bu şarkı için yapılan tüm özel düzenlemeler silinecek ve orijinal dosya bilgilerine dönülecek. Onaylıyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sıfırla',
          style: 'destructive',
          onPress: async () => {
            let originalArt = track.originalArtwork || null;
            if (!originalArt && track.uri) {
              try {
                originalArt = await getArtworkAsync(track.uri, track.id);
              } catch {
                // Ignore
              }
            }
            resetTrackMetadata(track.id);
            if (track.uri && track.uri !== track.id) {
              resetTrackMetadata(track.uri);
            }
            if (originalArt) {
              useStore.getState().setArtwork(track.id, originalArt);
              if (track.uri && track.uri !== track.id) {
                useStore.getState().setArtwork(track.uri, originalArt);
              }
            }
            await syncLivePlayback(track.id, {
              title: track.title,
              artist: track.artist,
              artwork: originalArt || undefined,
            });
            onSaved?.();
            onClose();
          },
        },
      ]
    );
  };

  // Çalan şarkı ve sistem bildirimlerini canlı güncelle
  const syncLivePlayback = async (
    trackId: string,
    updated: TrackMetadata
  ) => {
    try {
      const activeTrack = await TrackPlayer.getActiveTrack();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();

      const isCurrentActive =
        activeTrack &&
        (activeTrack.id === trackId ||
          activeTrack.url === trackId ||
          (track.uri && (activeTrack.url === track.uri || activeTrack.id === track.uri)));

      if (isCurrentActive && typeof activeIndex === 'number') {
        const newTitle = updated.title || activeTrack.title || 'RunMusic';
        const newArtist = updated.artist || activeTrack.artist || 'Müzik Çalar';
        const newArtwork = updated.artwork || activeTrack.artwork || undefined;

        // TrackPlayer bildirim ve medya oturumunu güncelle
        await TrackPlayer.updateMetadataForTrack(activeIndex, {
          title: newTitle,
          artist: newArtist,
          artwork: newArtwork,
          album: updated.album || undefined,
        });

        // Kapaktan dinamik tema türetimi aktifse temayı yenile
        if (newArtwork && typeof newArtwork === 'string') {
          useThemeStore.getState().updateThemeFromArtwork(newArtwork);
        }

        // Ana ekran widget'ını anında güncelle
        if (MusicWidgetModule && MusicWidgetModule.updateWidget) {
          const isPlaying = (await TrackPlayer.getPlaybackState()).state === State.Playing;
          MusicWidgetModule.updateWidget(
            newTitle,
            newArtist,
            newArtwork || null,
            isPlaying,
            theme.primary || '#212121'
          );
        }
      }
    } catch (e) {
      console.warn('Error syncing live playback metadata:', e);
    }
  };

  // 5. Kaydetme
  const handleSave = async () => {
    const finalTitle = title.trim() || track.title;
    const finalArtist = artist.trim() || track.artist;
    const finalAlbum = album.trim();

    const newMetadata: TrackMetadata = {
      title: finalTitle,
      artist: finalArtist,
      album: finalAlbum || undefined,
      artwork: artworkUri || undefined,
    };

    setTrackMetadata(track.id, newMetadata);
    if (track.uri && track.uri !== track.id) {
      setTrackMetadata(track.uri, newMetadata);
    }
    await syncLivePlayback(track.id, newMetadata);

    onSaved?.();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalBackdrop} />

        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Şarkı Bilgilerini Düzenle</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {/* KAPAK GÖRSELİ BÖLÜMÜ */}
            <View style={styles.artworkSection}>
              <View style={styles.artworkPreviewContainer}>
                {artworkUri ? (
                  <Image
                    source={{ uri: artworkUri }}
                    style={styles.artworkPreview}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.artworkPreview, styles.artworkPlaceholder]}>
                    <Ionicons name="musical-notes" size={48} color="#71717a" />
                  </View>
                )}
              </View>

              {/* Kapak Düğmeleri */}
              <View style={styles.artworkActionButtonsRow}>
                <TouchableOpacity
                  style={[styles.artActionBtn, { backgroundColor: '#27272a' }]}
                  onPress={handlePickFromGallery}>
                  <Ionicons name="images-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.artActionBtnText}>Galeriden</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.artActionBtn, { backgroundColor: theme.primary }]}
                  onPress={handleSearchOnlineArtwork}
                  disabled={isSearchingArtwork}>
                  {isSearchingArtwork ? (
                    <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
                  ) : (
                    <Ionicons name="globe-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.artActionBtnText}>Kapak Bul</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.artActionBtn, { backgroundColor: '#27272a' }]}
                  onPress={handleResetArtwork}>
                  <Ionicons name="refresh-outline" size={16} color="#a1a1aa" style={{ marginRight: 4 }} />
                  <Text style={[styles.artActionBtnText, { color: '#a1a1aa' }]}>Sıfırla</Text>
                </TouchableOpacity>
              </View>

              {/* Çevrimiçi Arama Sonuçları Listesi */}
              {showOnlineResults && (
                <View style={styles.onlineResultsBox}>
                  <Text style={styles.onlineResultsTitle}>
                    {isSearchingArtwork
                      ? 'İnternetten kapaklar aranıyor...'
                      : onlineArtworkList.length > 0
                      ? 'Bir Kapak Seçin:'
                      : 'Eşleşen kapak bulunamadı.'}
                  </Text>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.onlineResultsScroll}>
                    {onlineArtworkList.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.onlineResultItem,
                          artworkUri === item.artworkUrl && {
                            borderColor: theme.primary,
                            borderWidth: 2,
                          },
                        ]}
                        onPress={() => {
                          setArtworkUri(item.artworkUrl);
                          if (item.albumName && !album) {
                            setAlbum(item.albumName);
                          }
                        }}>
                        <Image
                          source={{ uri: item.thumbnailUrl }}
                          style={styles.onlineResultThumb}
                          contentFit="cover"
                        />
                        <Text
                          style={styles.onlineResultArtist}
                          numberOfLines={1}>
                          {item.artistName}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* METİN ALANLARI */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Şarkı Başlığı</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Şarkı adını girin"
                placeholderTextColor="#52525b"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Sanatçı</Text>
              <TextInput
                style={styles.input}
                value={artist}
                onChangeText={setArtist}
                placeholder="Sanatçı adını girin"
                placeholderTextColor="#52525b"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Albüm</Text>
              <TextInput
                style={styles.input}
                value={album}
                onChangeText={setAlbum}
                placeholder="Albüm adını girin (isteğe bağlı)"
                placeholderTextColor="#52525b"
              />
            </View>

            {/* TÜMÜNÜ SIFIRLA SEÇENEĞİ */}
            {metadataMap[track.id] && (
              <TouchableOpacity
                style={styles.fullResetBtn}
                onPress={handleFullReset}>
                <Ionicons name="trash-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />
                <Text style={styles.fullResetText}>Tüm Özel Bilgileri Sıfırla</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* FOOTER ACTIONS */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}>
              <Text style={styles.cancelBtnText}>İptal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: theme.primary }]}
              onPress={handleSave}>
              <Text style={styles.saveBtnText}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  modalCard: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 25,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  scrollBody: {
    maxHeight: 460,
  },
  scrollContent: {
    padding: 20,
  },
  artworkSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  artworkPreviewContainer: {
    width: 130,
    height: 130,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#27272a',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  artworkPreview: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  artworkActionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  artActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  artActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  onlineResultsBox: {
    width: '100%',
    marginTop: 14,
    padding: 12,
    backgroundColor: '#202024',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2e2e33',
  },
  onlineResultsTitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  onlineResultsScroll: {
    gap: 10,
  },
  onlineResultItem: {
    width: 76,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  onlineResultThumb: {
    width: 74,
    height: 74,
    borderRadius: 7,
    backgroundColor: '#27272a',
  },
  onlineResultArtist: {
    color: '#a1a1aa',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  fullResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 6,
  },
  fullResetText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cancelBtnText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

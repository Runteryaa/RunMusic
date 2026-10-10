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
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { cleanYouTubeTitle, type LyricsSourcePreference } from '../services/lyricsService';
import { SORT_OPTION_LABELS, type SortOption } from '../services/librarySort';
import { getPersistedSizeKB } from '../services/persistStorage';
import { clearUpNextQueue } from '../services/queueController';

const GITHUB_URL = 'https://github.com/Runteryaa/RunMusic';

const SORT_OPTIONS: SortOption[] = [
  'name_asc',
  'name_desc',
  'duration_asc',
  'duration_desc',
  'date_desc',
  'date_asc',
];

const LYRICS_SOURCES: { value: LyricsSourcePreference; label: string }[] = [
  { value: 'lrclib_first', label: 'LRCLIB önce' },
  { value: 'genius_first', label: 'Genius önce' },
  { value: 'lrclib_only', label: 'Yalnızca LRCLIB' },
];

import { useRouter } from 'expo-router';

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useThemeStore((s) => s.theme);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const preferences = useStore((s) => s.preferences);
  const updatePreferences = useStore((s) => s.updatePreferences);
  const resetPreferences = useStore((s) => s.resetPreferences);
  const hiddenTrackIds = useStore((s) => s.hiddenTrackIds);
  const allAssets = useStore((s) => s.allAssets);
  const unhideTrack = useStore((s) => s.unhideTrack);
  const unhideAllTracks = useStore((s) => s.unhideAllTracks);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const lyricsCache = useStore((s) => s.lyricsCache);
  const clearLyricsCache = useStore((s) => s.clearLyricsCache);
  const clearArtworkCache = useStore((s) => s.clearArtworkCache);
  const upNextCount = useStore((s) => s.upNextIds.length);

  const [isHiddenExpanded, setIsHiddenExpanded] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [storageKB, setStorageKB] = useState<number | null>(null);

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
      return { id, asset, title, duration: asset?.duration };
    });
  }, [allAssets, hiddenTrackIds, metadataMap]);

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
    Alert.alert('Şarkı Sözlerini Temizle', 'Kayıtlı tüm şarkı sözleri silinecek. Emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Temizle',
        style: 'destructive',
        onPress: () => {
          clearLyricsCache();
          refreshStorageUsage();
        },
      },
    ]);
  };

  const handleClearArtworkCache = () => {
    Alert.alert(
      'Kapak Önbelleğini Temizle',
      'Çıkarılmış kapak görselleri silinecek. Gerektiğinde dosyalardan yeniden oluşturulur.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
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
    Alert.alert('Sırada Listesini Temizle', 'Öne aldığınız tüm şarkılar kuyruktan çıkarılacak.', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Temizle',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearUpNextQueue();
          } catch (e) {
            console.warn('Clear up-next failed:', e);
          }
        },
      },
    ]);
  };

  const handleResetSettings = () => {
    Alert.alert(
      'Ayarları Sıfırla',
      'Tercihler ve kitaplık filtreleri varsayılana dönecek. Gizlenen şarkılar ve kayıtlı sözler korunur.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sıfırla',
          style: 'destructive',
          onPress: () => {
            resetPreferences();
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

  const handleCheckUpdate = async () => {
    if (!Updates.isEnabled) {
      Alert.alert(
        'OTA Bilgisi',
        'Bu APK sürümünde dinamik OTA kanalı henüz aktif değil. Lütfen en güncel APK sürümünü GitHub Releases üzerinden yükleyin.'
      );
      return;
    }

    setIsCheckingUpdate(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        Alert.alert(
          'Yeni Güncelleme Bulundu',
          'Yeni bir güncelleme bulundu ve arka planda indiriliyor...'
        );
        const fetchResult = await Updates.fetchUpdateAsync();
        if (fetchResult.isNew) {
          Alert.alert(
            'Güncelleme Hazır',
            'Güncelleme başarıyla indirildi. Yeni sürümü uygulamak için şimdi yeniden başlatılsın mı?',
            [
              { text: 'Daha Sonra', style: 'cancel' },
              {
                text: 'Yeniden Başlat',
                onPress: async () => {
                  await Updates.reloadAsync();
                },
              },
            ]
          );
        }
      } else {
        Alert.alert(
          'Uygulama Güncel',
          'Şu anda en son sürüme sahipsiniz. Yeni bir OTA güncellemesi bulunmuyor.'
        );
      }
    } catch (e: any) {
      console.warn('Update check failed:', e);
      const msg = e?.message || '';
      if (msg.includes('failed to check for update') || msg.includes('channel-name')) {
        Alert.alert(
          'Güncelleme Yapılandırması',
          'Mevcut APK sürümünde güncelleme kanalı tanımlı değil. Kanal desteği eklenmiş yeni APK sürümünü GitHub Releases üzerinden indirip kurmanız gerekmektedir.'
        );
      } else {
        Alert.alert('Güncelleme Denetimi', e?.message || 'Güncelleme sunucusuna bağlanılamadı.');
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* ── ÇALMA ─────────────────────────────────────────────────────────── */}
      <Section icon="musical-notes-outline" title="Çalma" theme={theme}>
        <ChipsRow
          theme={theme}
          label="Varsayılan sıralama"
          hint="Kitaplık her açıldığında bu sırayla listelenir."
          value={preferences.defaultSortOption}
          options={SORT_OPTIONS.map((o) => ({ value: o, label: SORT_OPTION_LABELS[o] }))}
          onChange={(value) => updatePreferences({ defaultSortOption: value as SortOption })}
        />
        <ToggleRow
          theme={theme}
          label="Açılışta son kuyruğu geri yükle"
          hint="Kapalıysa yalnızca son çalan parça yüklenir."
          value={preferences.restoreQueueOnLaunch}
          onChange={(v) => updatePreferences({ restoreQueueOnLaunch: v })}
        />
        <ToggleRow
          theme={theme}
          label="Uygulama kapatılınca çalmaya devam et"
          hint="Son kullanılanlardan kaydırıp kapatınca müzik durmasın."
          value={preferences.keepPlayingWhenAppKilled}
          onChange={(v) => updatePreferences({ keepPlayingWhenAppKilled: v })}
        />
      </Section>

      {/* ── İSTATİSTİKLER ─────────────────────────────────────────────────── */}
      <Section
        icon="stats-chart-outline"
        title="İstatistikler ve Geçmiş"
        subtitle="Dinleme verileriniz ve en çok dinlenenler"
        theme={theme}>
        <ActionRow
          theme={theme}
          label="Detayları Görüntüle"
          icon="chevron-forward-outline"
          onPress={() => router.push('/statistics')}
        />
      </Section>

      {/* ── ŞARKI SÖZLERİ ─────────────────────────────────────────────────── */}
      <Section
        icon="mic-outline"
        title="Şarkı Sözleri"
        subtitle={cachedLyricsCount > 0 ? `${cachedLyricsCount} söz çevrimdışı kayıtlı` : undefined}
        theme={theme}>
        <ToggleRow
          theme={theme}
          label="Çalarken otomatik ara"
          hint="Kapalıysa yalnızca kayıtlı sözler kullanılır; internet kullanılmaz."
          value={preferences.autoFetchLyrics}
          onChange={(v) => updatePreferences({ autoFetchLyrics: v })}
        />
        <ToggleRow
          theme={theme}
          label="Player açılınca sözleri göster"
          value={preferences.openPlayerWithLyrics}
          onChange={(v) => updatePreferences({ openPlayerWithLyrics: v })}
        />
        <ChipsRow
          theme={theme}
          label="Tercih edilen kaynak"
          hint="Sonuç bulunamazsa sıradaki kaynağa geçilir."
          value={preferences.lyricsSourcePreference}
          options={LYRICS_SOURCES}
          onChange={(value) =>
            updatePreferences({ lyricsSourcePreference: value as LyricsSourcePreference })
          }
        />
        <ActionRow
          theme={theme}
          label="Kayıtlı sözleri temizle"
          value={`${cachedLyricsCount} kayıt`}
          icon="trash-outline"
          destructive
          disabled={cachedLyricsCount === 0}
          onPress={handleClearLyricsCache}
        />
      </Section>

      {/* ── GÖRÜNÜM ───────────────────────────────────────────────────────── */}
      <Section icon="color-palette-outline" title="Görünüm" theme={theme}>
        <ToggleRow
          theme={theme}
          label="Kapaktan renk türet"
          hint="Tema renkleri çalan parçanın kapağından alınır."
          value={preferences.dynamicColorFromArtwork}
          onChange={(v) => updatePreferences({ dynamicColorFromArtwork: v })}
        />
        <ToggleRow
          theme={theme}
          label="Hareketleri azalt"
          hint="Duraklatma ölçeği ve söz geçişi animasyonlarını kapatır."
          value={preferences.reduceMotion}
          onChange={(v) => updatePreferences({ reduceMotion: v })}
        />
      </Section>

      {/* ── KİTAPLIK FİLTRELERİ ───────────────────────────────────────────── */}
      <Section
        icon="funnel-outline"
        title="Kitaplık Filtreleri"
        subtitle="Taramada hangi dosyaların listeleneceğini belirler"
        theme={theme}>
        <NumberRow
          theme={theme}
          label="En kısa süre (saniye)"
          hint="Örn. 30 → 30 sn'den kısa parçalar (sesli notlar) listelenmez."
          placeholder="sınırsız"
          value={settings.minLengthSec}
          onChange={(v) => updateSettings({ minLengthSec: v })}
        />
        <NumberRow
          theme={theme}
          label="En uzun süre (saniye)"
          placeholder="sınırsız"
          value={settings.maxLengthSec}
          onChange={(v) => updateSettings({ maxLengthSec: v })}
        />
        <NumberRow
          theme={theme}
          label="En küçük boyut (MB)"
          placeholder="sınırsız"
          value={settings.minSizeMB}
          onChange={(v) => updateSettings({ minSizeMB: v })}
          decimal
        />
        <NumberRow
          theme={theme}
          label="En büyük boyut (MB)"
          placeholder="sınırsız"
          value={settings.maxSizeMB}
          onChange={(v) => updateSettings({ maxSizeMB: v })}
          decimal
        />
        <Text style={styles.noteText}>
          Değişiklikler kitaplık yeniden tarandığında uygulanır.
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
            <Text style={styles.sectionTitle}>Gizlenen Şarkılar</Text>
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
                  <Text style={styles.smallMuted}>{hiddenTrackItems.length} şarkı gizlendi</Text>
                  <TouchableOpacity style={styles.smallBtn} activeOpacity={0.7} onPress={unhideAllTracks}>
                    <Ionicons name="refresh" size={14} color={theme.primary} />
                    <Text style={[styles.smallBtnText, { color: theme.primary }]}>
                      Tümünü Geri Getir
                    </Text>
                  </TouchableOpacity>
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
                      <Text style={styles.hiddenTrackTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.duration != null ? (
                        <Text style={styles.smallMuted}>
                          {Math.floor(item.duration / 60)}:
                          {Math.floor(item.duration % 60)
                            .toString()
                            .padStart(2, '0')}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.smallBtn}
                      activeOpacity={0.7}
                      onPress={() => unhideTrack(item.id)}>
                      <Ionicons name="eye-outline" size={15} color={theme.primary} />
                      <Text style={[styles.smallBtnText, { color: theme.primary }]}>Geri Getir</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#52525b" />
                <Text style={styles.smallMuted}>Gizlenen şarkı bulunmuyor.</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* ── VERİ VE BAKIM ─────────────────────────────────────────────────── */}
      <Section icon="server-outline" title="Veri ve Bakım" theme={theme}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Kayıtlı veri boyutu</Text>
            <Text style={styles.rowHint}>
              {storageKB == null
                ? 'Hesaplanıyor...'
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
          label="Kapak önbelleğini temizle"
          value={`${artworkCount} kapak`}
          icon="images-outline"
          onPress={handleClearArtworkCache}
        />
        <ActionRow
          theme={theme}
          label="Sırada listesini temizle"
          value={upNextCount > 0 ? `${upNextCount} şarkı` : 'boş'}
          icon="list-outline"
          disabled={upNextCount === 0}
          onPress={handleClearUpNext}
        />
        <ActionRow
          theme={theme}
          label="Tüm ayarları sıfırla"
          hint="Gizlenen şarkılar ve kayıtlı sözler korunur."
          icon="refresh-outline"
          destructive
          onPress={handleResetSettings}
        />
      </Section>

      {/* ── HAKKINDA ──────────────────────────────────────────────────────── */}
      <Section
        icon="information-circle-outline"
        title="Hakkında"
        subtitle={`RunMusic v${Constants.expoConfig?.version || '1.0.0'}`}
        theme={theme}>
        <View style={styles.detailsBox}>
          <DetailRow label="Sürüm" value={`v${Constants.expoConfig?.version || '1.0.0'}`} />
          <DetailRow label="Çalışma ortamı" value={Updates.runtimeVersion || '1.0.0'} />
          <DetailRow label="Kanal" value={Updates.channel || 'production'} />
          <DetailRow
            label="Çalışan paket"
            value={
              Updates.updateId
                ? `OTA (${Updates.updateId.slice(0, 8)})`
                : Updates.isEmbeddedLaunch
                ? 'Yerel APK'
                : 'Standart'
            }
          />
          {Updates.createdAt ? (
            <DetailRow
              label="Son güncelleme"
              value={`${new Date(Updates.createdAt).toLocaleDateString('tr-TR')} ${new Date(
                Updates.createdAt
              ).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
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
              <Text style={styles.primaryBtnText}>Güncellemeleri Denetle</Text>
            </>
          )}
        </TouchableOpacity>

        <ActionRow
          theme={theme}
          label="GitHub'da kaynak kodu"
          value="Runteryaa/RunMusic"
          icon="logo-github"
          onPress={() => Linking.openURL(GITHUB_URL).catch(() => {})}
        />
      </Section>
    </ScrollView>
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  theme: Theme;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
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
});

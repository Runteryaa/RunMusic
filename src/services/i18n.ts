import { useCallback } from 'react';
import { useStore } from '../store/useStore';

export type AppLanguage = 'system' | 'en' | 'tr';
export type SupportedLanguage = 'en' | 'tr';

export const SUPPORTED_LANGUAGES: { value: AppLanguage; label: string; nativeName: string }[] = [
  { value: 'system', label: 'Sistem Dili', nativeName: 'System Default' },
  { value: 'en', label: 'English', nativeName: 'English' },
  { value: 'tr', label: 'Türkçe', nativeName: 'Türkçe' },
];

/**
 * Cihazın sistem dilini sıfır yerel bağımlılıkla tespit eder.
 * Hermes / JS ortamındaki ECMA-402 Intl desteğinden yararlanır.
 *
 * Kural: Varsayılan olarak İngilizce ('en') kullanılır, ancak sistem dili
 * desteklenen diller listesinde varsa (Türkçe ise 'tr') o dil döner.
 */
export function getSystemLanguage(): SupportedLanguage {
  try {
    const locale =
      Intl.DateTimeFormat().resolvedOptions().locale ||
      (typeof navigator !== 'undefined' ? (navigator.language || (navigator as any).userLanguage) : '');
    if (locale) {
      const langCode = locale.toLowerCase().split(/[-_]/)[0];
      if (langCode === 'tr') {
        return 'tr';
      }
    }
  } catch {
    // Intl desteklenmeyen nadir durumlarda varsayılan İngilizce
  }
  return 'en';
}

/** Tercih edilen uygulama dilini kesinleşmiş ('en' | 'tr') dile dönüştürür. */
export function resolveLanguage(pref?: AppLanguage | null): SupportedLanguage {
  if (!pref || pref === 'system') {
    return getSystemLanguage();
  }
  return pref === 'tr' ? 'tr' : 'en';
}

export const translations = {
  tr: {
    tabs: {
      library: 'Kütüphane',
      settings: 'Ayarlar',
    },
    settings: {
      title: 'Ayarlar',
      language_section: 'Dil',
      language_label: 'Uygulama Dili',
      language_hint: 'Arayüzün görüntüleneceği dili belirler.',
      lang_system: 'Sistem Dili',
      lang_en: 'English',
      lang_tr: 'Türkçe',
      stats_title: 'İstatistikler ve Geçmiş',
      stats_subtitle: 'Dinleme verileriniz ve en çok dinlenenler',
      playback_section: 'Çalma',
      default_sort: 'Varsayılan sıralama',
      default_sort_hint: 'Kitaplık her açıldığında bu sırayla listelenir.',
      restore_queue: 'Açılışta son kuyruğu geri yükle',
      restore_queue_hint: 'Kapalıysa yalnızca son çalan parça yüklenir.',
      keep_playing: 'Uygulama kapatılınca çalmaya devam et',
      keep_playing_hint: 'Son kullanılanlardan kaydırıp kapatınca müzik durmasın.',
      lyrics_section: 'Şarkı Sözleri',
      cached_lyrics_count: 'söz çevrimdışı kayıtlı',
      auto_fetch_lyrics: 'Çalarken otomatik ara',
      auto_fetch_lyrics_hint: 'Kapalıysa yalnızca kayıtlı sözler kullanılır; internet kullanılmaz.',
      open_with_lyrics: 'Player açılınca sözleri göster',
      preferred_source: 'Tercih edilen kaynak',
      preferred_source_hint: 'Sonuç bulunamazsa sıradaki kaynağa geçilir.',
      source_lrclib_first: 'LRCLIB önce',
      source_genius_first: 'Genius önce',
      source_lrclib_only: 'Yalnızca LRCLIB',
      clear_lyrics: 'Kayıtlı sözleri temizle',
      records: 'kayıt',
      appearance_section: 'Görünüm',
      dynamic_color: 'Kapaktan renk türet',
      dynamic_color_hint: 'Tema renkleri çalan parçanın kapağından alınır.',
      preset_color_title: 'Sabit Tema Rengi',
      preset_color_hint: 'Kapak rengi kapalıyken uygulama genelinde kullanılacak renk seçimi:',
      reduce_motion: 'Hareketleri azalt',
      reduce_motion_hint: 'Duraklatma ölçeği ve söz geçişi animasyonlarını kapatır.',
      filters_section: 'Kitaplık Filtreleri',
      filters_subtitle: 'Taramada hangi dosyaların listeleneceğini belirler',
      min_duration: 'En kısa süre (saniye)',
      min_duration_hint: "Örn. 30 → 30 sn'den kısa parçalar (sesli notlar) listelenmez.",
      max_duration: 'En uzun süre (saniye)',
      min_size: 'En küçük boyut (MB)',
      max_size: 'En büyük boyut (MB)',
      unlimited: 'sınırsız',
      filters_note: 'Değişiklikler kitaplık yeniden tarandığında uygulanır.',
      hidden_tracks_title: 'Gizlenen Şarkılar',
      hidden_tracks_count: 'şarkı gizlendi',
      restore_all: 'Tümünü Geri Getir',
      restore: 'Geri Getir',
      no_hidden_tracks: 'Gizlenen şarkı bulunmuyor.',
      data_section: 'Veri ve Bakım',
      data_size: 'Kayıtlı veri boyutu',
      calculating: 'Hesaplanıyor...',
      clear_artwork: 'Kapak önbelleğini temizle',
      artwork_count: 'kapak',
      clear_up_next: 'Sırada listesini temizle',
      up_next_empty: 'boş',
      tracks_count: 'şarkı',
      reset_settings: 'Tüm ayarları sıfırla',
      reset_settings_hint: 'Gizlenen şarkılar ve kayıtlı sözler korunur.',
      about_section: 'Hakkında',
      check_updates: 'Güncellemeleri Denetle',
      checking_update: 'Denetleniyor...',
      source_code: 'Kaynak Kod (GitHub)',
      license: 'Lisans',
      developer: 'Geliştirici',
      alerts: {
        clear_lyrics_title: 'Şarkı Sözlerini Temizle',
        clear_lyrics_msg: 'Kayıtlı tüm şarkı sözleri silinecek. Emin misiniz?',
        clear_artwork_title: 'Kapak Önbelleğini Temizle',
        clear_artwork_msg: 'Çıkarılmış kapak görselleri silinecek. Gerektiğinde dosyalardan yeniden oluşturulur.',
        clear_up_next_title: 'Sırada Listesini Temizle',
        clear_up_next_msg: 'Öne aldığınız tüm şarkılar kuyruktan çıkarılacak.',
        reset_settings_title: 'Ayarları Sıfırla',
        reset_settings_msg: 'Tüm tercihler varsayılana döndürülecek. Devam edilsin mi?',
        cancel: 'İptal',
        clear: 'Temizle',
        reset: 'Sıfırla',
        update_found_title: 'Yeni Güncelleme Bulundu',
        update_found_msg: 'Yeni bir güncelleme bulundu ve arka planda indiriliyor...',
        update_ready_title: 'Güncelleme Hazır',
        update_ready_msg: 'Güncelleme başarıyla indirildi. Yeni sürümü uygulamak için şimdi yeniden başlatılsın mı?',
        later: 'Daha Sonra',
        restart: 'Yeniden Başlat',
        up_to_date_title: 'Uygulama Güncel',
        up_to_date_msg: 'Şu anda en son sürüme sahipsiniz. Yeni bir OTA güncellemesi bulunmuyor.',
        update_config_title: 'Güncelleme Yapılandırması',
        update_config_msg: 'Mevcut APK sürümünde güncelleme kanalı tanımlı değil. Kanal desteği eklenmiş yeni APK sürümünü GitHub Releases üzerinden indirip kurmanız gerekmektedir.',
        update_check_title: 'Güncelleme Denetimi',
        update_check_failed: 'Güncelleme sunucusuna bağlanılamadı.',
      },
    },
    library: {
      title: 'Kütüphane',
      songs_registered: 'şarkı kayıtlı',
      search_placeholder: 'Şarkılarda ara...',
      search_song_or_artist: 'Şarkı veya sanatçı ara...',
      add_to_queue: 'Sıraya Ekle',
      added_to_queue: 'sıraya eklendi',
      play_next: 'Sırada Çal',
      play_next_added: 'sıradaki parça olarak eklendi',
      shuffle_all: 'Karışık Çal',
      shuffle_started: 'Karışık çalma başladı',
      smart_shuffle_started: 'Akıllı karıştırma başladı',
      no_matching_tracks: 'Eşleşen şarkı bulunamadı.',
      no_tracks_yet: 'Henüz şarkı bulunamadı.',
      rescan: 'Tekrar Tara',
      scanning: 'Taranıyor...',
      sort_options_title: 'Sıralama Seçenekleri',
      track_menu_title: 'Şarkı İşlemleri',
      edit_info: 'Bilgileri Düzenle',
      hide_track: 'Şarkıyı Gizle',
      share_track: 'Şarkıyı Paylaş',
    },
    sort: {
      name_asc: 'İsim (A→Z)',
      name_desc: 'İsim (Z→A)',
      duration_asc: 'Süre (kısa→uzun)',
      duration_desc: 'Süre (uzun→kısa)',
      date_desc: 'Eklenme (yeni→eski)',
      date_asc: 'Eklenme (eski→yeni)',
    },
    player: {
      now_playing: 'ŞU AN ÇALIYOR',
      lyrics: 'Şarkı Sözleri',
      queue: 'Sıradaki',
      sleep_timer: 'Uyku Zamanlayıcısı',
      remaining_time: 'Kalan Süre',
      change_duration: 'Süreyi Değiştir',
      select_sleep_duration: 'Kapanma Süresi Seçin',
      cancel_timer: 'İptal Et',
      minutes: 'Dakika',
      stop_after_track: 'Şarkı Bitince Durdur',
      custom_minutes_placeholder: 'Dakika (örn: 20)',
      start: 'Başlat',
      calculating: 'Hesaplanıyor...',
      manual_search: 'Manuel Ara',
      searching_lyrics: 'Sözler aranıyor...',
      auto_scroll: 'Kaydır',
      pause_scroll: 'Durdur',
      no_lyrics: 'Söz bulunamadı',
    },
    edit_track: {
      title: 'Şarkı Bilgilerini Düzenle',
      track_title: 'Şarkı Adı',
      artist: 'Sanatçı',
      album: 'Albüm',
      artwork: 'Kapak Fotoğrafı',
      search_online: 'İnternetten Ara',
      choose_from_gallery: 'Galeriden Seç',
      remove_artwork: 'Kapağı Kaldır',
      save: 'Kaydet',
      cancel: 'İptal',
      reset_to_original: 'Orijinal Bilgilere Dön',
    },
    stats: {
      title: 'İstatistikler ve Geçmiş',
      total_time: 'Toplam Dinleme Süresi',
      total_plays: 'Toplam Çalma',
      top_tracks: 'En Çok Dinlenenler',
      recent_history: 'Son Dinlenenler',
      no_data: 'Henüz dinleme verisi bulunmuyor.',
    },
  },
  en: {
    tabs: {
      library: 'Library',
      settings: 'Settings',
    },
    settings: {
      title: 'Settings',
      language_section: 'Language',
      language_label: 'App Language',
      language_hint: 'Select the display language for the application.',
      lang_system: 'System Default',
      lang_en: 'English',
      lang_tr: 'Türkçe',
      stats_title: 'Statistics & History',
      stats_subtitle: 'Your listening stats and most played tracks',
      playback_section: 'Playback',
      default_sort: 'Default sort order',
      default_sort_hint: 'Library will be sorted in this order when opened.',
      restore_queue: 'Restore last queue on launch',
      restore_queue_hint: 'If turned off, only the last played track will be loaded.',
      keep_playing: 'Keep playing when app is closed',
      keep_playing_hint: 'Keep audio playing when swiped away from recent apps.',
      lyrics_section: 'Lyrics',
      cached_lyrics_count: 'lyrics saved offline',
      auto_fetch_lyrics: 'Auto fetch lyrics while playing',
      auto_fetch_lyrics_hint: 'If turned off, only saved lyrics are used; no internet.',
      open_with_lyrics: 'Open player directly with lyrics',
      preferred_source: 'Preferred lyrics source',
      preferred_source_hint: 'Falls back to the next source if no match is found.',
      source_lrclib_first: 'LRCLIB first',
      source_genius_first: 'Genius first',
      source_lrclib_only: 'LRCLIB only',
      clear_lyrics: 'Clear saved lyrics',
      records: 'records',
      appearance_section: 'Appearance',
      dynamic_color: 'Dynamic colors from artwork',
      dynamic_color_hint: 'Theme colors adapt dynamically to the playing track artwork.',
      preset_color_title: 'Preset Theme Color',
      preset_color_hint: 'Choose an accent color when dynamic color is disabled:',
      reduce_motion: 'Reduce motion',
      reduce_motion_hint: 'Disables pause scaling and lyric transition animations.',
      filters_section: 'Library Filters',
      filters_subtitle: 'Filter which audio files appear in your library',
      min_duration: 'Minimum duration (seconds)',
      min_duration_hint: 'e.g. 30 → tracks shorter than 30s (voice notes) are excluded.',
      max_duration: 'Maximum duration (seconds)',
      min_size: 'Minimum size (MB)',
      max_size: 'Maximum size (MB)',
      unlimited: 'unlimited',
      filters_note: 'Changes take effect when the library is rescanned.',
      hidden_tracks_title: 'Hidden Tracks',
      hidden_tracks_count: 'tracks hidden',
      restore_all: 'Restore All',
      restore: 'Restore',
      no_hidden_tracks: 'No hidden tracks.',
      data_section: 'Data & Maintenance',
      data_size: 'Stored data size',
      calculating: 'Calculating...',
      clear_artwork: 'Clear artwork cache',
      artwork_count: 'covers',
      clear_up_next: 'Clear up next queue',
      up_next_empty: 'empty',
      tracks_count: 'tracks',
      reset_settings: 'Reset all settings',
      reset_settings_hint: 'Hidden tracks and saved lyrics are preserved.',
      about_section: 'About',
      check_updates: 'Check for Updates',
      checking_update: 'Checking...',
      source_code: 'Source Code (GitHub)',
      license: 'License',
      developer: 'Developer',
      alerts: {
        clear_lyrics_title: 'Clear Saved Lyrics',
        clear_lyrics_msg: 'All saved offline lyrics will be removed. Are you sure?',
        clear_artwork_title: 'Clear Artwork Cache',
        clear_artwork_msg: 'Cached album artwork images will be cleared and regenerated as needed.',
        clear_up_next_title: 'Clear Up Next Queue',
        clear_up_next_msg: 'All queued tracks will be removed from up next.',
        reset_settings_title: 'Reset Settings',
        reset_settings_msg: 'All preferences will be reset to defaults. Continue?',
        cancel: 'Cancel',
        clear: 'Clear',
        reset: 'Reset',
        update_found_title: 'Update Found',
        update_found_msg: 'A new update was found and is downloading in the background...',
        update_ready_title: 'Update Ready',
        update_ready_msg: 'Update downloaded. Restart the app now to apply?',
        later: 'Later',
        restart: 'Restart Now',
        up_to_date_title: 'App Up to Date',
        up_to_date_msg: 'You have the latest version. No new updates available.',
        update_config_title: 'Update Configuration',
        update_config_msg: 'Update channel is not configured in this APK. Please install the latest release from GitHub Releases.',
        update_check_title: 'Update Check',
        update_check_failed: 'Could not connect to the update server.',
      },
    },
    library: {
      title: 'Library',
      songs_registered: 'songs loaded',
      search_placeholder: 'Search songs...',
      search_song_or_artist: 'Search songs or artists...',
      add_to_queue: 'Add to Queue',
      added_to_queue: 'added to queue',
      play_next: 'Play Next',
      play_next_added: 'will play next',
      shuffle_all: 'Shuffle All',
      shuffle_started: 'Shuffle playback started',
      smart_shuffle_started: 'Smart shuffle started',
      no_matching_tracks: 'No matching songs found.',
      no_tracks_yet: 'No songs found yet.',
      rescan: 'Rescan',
      scanning: 'Scanning...',
      sort_options_title: 'Sort Options',
      track_menu_title: 'Track Actions',
      edit_info: 'Edit Track Info',
      hide_track: 'Hide Track',
      share_track: 'Share Track',
    },
    sort: {
      name_asc: 'Name (A→Z)',
      name_desc: 'Name (Z→A)',
      duration_asc: 'Duration (short→long)',
      duration_desc: 'Duration (long→short)',
      date_desc: 'Date added (new→old)',
      date_asc: 'Date added (old→new)',
    },
    player: {
      now_playing: 'NOW PLAYING',
      lyrics: 'Lyrics',
      queue: 'Up Next',
      sleep_timer: 'Sleep Timer',
      remaining_time: 'Remaining Time',
      change_duration: 'Change Duration',
      select_sleep_duration: 'Select Sleep Duration',
      cancel_timer: 'Cancel',
      minutes: 'Minutes',
      stop_after_track: 'Stop After Track',
      custom_minutes_placeholder: 'Minutes (e.g. 20)',
      start: 'Start',
      calculating: 'Calculating...',
      manual_search: 'Manual Search',
      searching_lyrics: 'Searching lyrics...',
      auto_scroll: 'Scroll',
      pause_scroll: 'Pause',
      no_lyrics: 'No lyrics found',
    },
    edit_track: {
      title: 'Edit Track Info',
      track_title: 'Track Title',
      artist: 'Artist',
      album: 'Album',
      artwork: 'Album Artwork',
      search_online: 'Search Online',
      choose_from_gallery: 'Choose from Gallery',
      remove_artwork: 'Remove Artwork',
      save: 'Save',
      cancel: 'Cancel',
      reset_to_original: 'Reset to Original',
    },
    stats: {
      title: 'Statistics & History',
      total_time: 'Total Listening Time',
      total_plays: 'Total Plays',
      top_tracks: 'Top Tracks',
      recent_history: 'Recently Played',
      no_data: 'No listening data yet.',
    },
  },
} as const;

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}` | `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKey = NestedKeyOf<typeof translations['tr']>;

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Belirtilen anahtara ve dile göre çevrilmiş metni döndürür.
 */
export function translate(
  key: string,
  lang: SupportedLanguage = 'en',
  params?: Record<string, string | number>
): string {
  const langTable = translations[lang] || translations.en;
  let text = getNestedValue(langTable, key);

  if (!text) {
    // Fallback: İngilizceye bak
    text = getNestedValue(translations.en, key);
  }

  if (!text) {
    return key;
  }

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
    }
  }

  return text;
}

/**
 * React bileşenlerinde dinamik i18n hook'u.
 * Store'daki `preferences.appLanguage` değiştikçe otomatik yeniden render eder.
 */
export function useTranslation() {
  const appLanguage = useStore((s) => s.preferences.appLanguage);
  const resolvedLanguage = resolveLanguage(appLanguage);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      return translate(key, resolvedLanguage, params);
    },
    [resolvedLanguage]
  );

  return {
    t,
    language: appLanguage,
    resolvedLanguage,
    setLanguage: (lang: AppLanguage) => {
      useStore.getState().updatePreferences({ appLanguage: lang });
    },
  };
}

/**
 * Hook dışı kullanımlar için doğrudan çeviri fonksiyonu.
 */
export function t(key: string, params?: Record<string, string | number>, lang?: AppLanguage): string {
  const currentPref = lang ?? useStore.getState?.()?.preferences?.appLanguage;
  const resolved = resolveLanguage(currentPref);
  return translate(key, resolved, params);
}

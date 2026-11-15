import { useStore, type TrackMetadata } from '../store/useStore';
import { cleanDisplayTitle, cleanYouTubeTitle } from './lyricsService';
import { t } from './i18n';

/**
 * Kaydın "görünen" meta verisi: başlık, sanatçı, kapak.
 *
 * Oyuncu ekranındaki isim **kullanıcı tarafından düzenlenmiş** olabilir (parça
 * bilgisi düzenleme ekranı `metadataMap`'e yazar). Bildirim, kilit ekranı ve ana
 * ekran widget'ı ise uzun süre kuyruktaki ham başlığı (çoğu zaman dosya adı)
 * gösteriyordu. Bu yardımcı, oyuncu ekranının kullandığı çözümlemenin aynısını
 * uygular: önce `metadataMap`, sonra kuyruk kaydı.
 *
 * `metadataMap` anahtarları kanonik kimlik veya URL olabildiği için ikisine de
 * bakılır (düzenleme sırasında ikisine de yazılıyor).
 */
export interface DisplayTrackMetadata {
  title: string;
  artist: string;
  artwork: string | null;
}

function isPlaceholderName(value?: string | null): boolean {
  if (!value) return true;
  const lower = value.trim().toLowerCase();
  return (
    lower === 'local audio' ||
    lower === 'unknown artist' ||
    lower === 'bilinmeyen sanatçı' ||
    lower === 'bilinmeyen sanatci' ||
    lower.length === 0
  );
}

function pickMetadata(
  metadataMap: Record<string, TrackMetadata>,
  keys: (string | undefined)[]
): TrackMetadata | undefined {
  for (const key of keys) {
    if (!key) continue;
    const meta = metadataMap[key];
    if (meta) return meta;
  }
  return undefined;
}

/**
 * Bir parçanın ekranda gösterilecek başlığını, sanatçısını ve kapağını çözer.
 * Saf fonksiyondur; mağaza erişimi varsayılan olarak `useStore` üzerinden
 * yapılır (senkron, servis katmanından güvenle çağrılabilir).
 */
export function resolveDisplayMetadata(
  track:
    | { id?: string; url?: string; title?: string; artist?: string; artwork?: unknown }
    | null
    | undefined,
  options?: {
    metadataMap?: Record<string, TrackMetadata>;
    artworkMap?: Record<string, string>;
  }
): DisplayTrackMetadata {
  const state = useStore.getState();
  const metadataMap = options?.metadataMap ?? state.metadataMap;
  const artworkMap = options?.artworkMap ?? state.artworkMap;

  if (!track) {
    return {
      title: t('common.unknown_track'),
      artist: t('common.unknown_artist'),
      artwork: null,
    };
  }

  const id = String(track.id ?? '').trim();
  const url = String(track.url ?? '').trim();
  const meta = pickMetadata(metadataMap, [id, url]);

  const rawArtist = meta?.artist || track.artist || '';
  const artist = isPlaceholderName(rawArtist) ? '' : cleanYouTubeTitle(rawArtist) || '';

  const rawTitle = (meta?.title?.trim() || track.title || '').trim();
  const title =
    cleanDisplayTitle(rawTitle, artist || undefined) || rawTitle || t('common.unknown_track');

  const artwork =
    meta?.artwork ||
    (id ? artworkMap[id] : undefined) ||
    (url ? artworkMap[url] : undefined) ||
    (typeof track.artwork === 'string' ? track.artwork : null) ||
    null;

  return {
    title,
    artist: artist || t('common.unknown_artist'),
    artwork,
  };
}

/**
 * Kullanıcıya gösterilen parça/sanatçı isimlerinin ortak temizleyicisi.
 *
 * NEDEN: kütüphaneye eklenen dosyalar çoğu zaman indirme kaynağının ham
 * başlığını taşır ("Artist - Song (Official Video) [4K]", "Artist - Topic").
 * Bu ham metin hiçbir yerde gösterilmemeli; yalnızca **parça bilgilerini
 * düzenleme** ekranı ham değeri görür. Oyuncu, kütüphane, istatistikler,
 * Wrapped, widget ve scrobble gönderimleri bu modüldeki temizlenmiş isimleri
 * kullanır.
 *
 * Modül saf: native bağımlılık yok, Node üzerinde test edilebilir.
 */
import { cleanDisplayTitle } from './lyricsService';

const AUDIO_EXTENSION = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff?|alac|mp4|webm|mkv)$/i;

/** Yalnızca sonda anlamlı olan, sanatçı adına ait olmayan ekler. */
const ARTIST_SUFFIX_PATTERNS: RegExp[] = [
  /\s*[-–—]\s*topic\s*$/i,
  /\s*[-–—]\s*(official\s*)?(artist\s*)?channel\s*$/i,
  /\s*[-–—]\s*official\s*$/i,
  /\s*[-–—]\s*music\s*$/i,
  /\s+vevo\s*$/i,
  /vevo\s*$/i,
];

/** Parantez içinde geçen, sanatçı adı olmayan etiketler. */
const ARTIST_NOISE_PARENS =
  /\s*[\(\[]\s*(official\s*(music\s*)?(video|audio|lyric\s*video)?|lyric\s*video|audio|video|hd|hq|4k|8k|remaster(ed)?(\s*\d{4})?|explicit|clean|topic)\s*[\)\]]/gi;

/** "Bilinmeyen Sanatçı" / "Unknown Artist" gibi yer tutucular. */
export function isPlaceholderArtist(value?: string | null): boolean {
  const lower = (value ?? '').trim().toLowerCase();
  return (
    lower.length === 0 ||
    lower === 'local audio' ||
    lower === 'unknown artist' ||
    lower === 'bilinmeyen sanatçı' ||
    lower === 'bilinmeyen sanatci'
  );
}

/**
 * Sanatçı adını temizler.
 *
 * Dikkat: tireyi **her yerde** silmeyiz — "AC-DC", "T-Pain" gibi gerçek
 * isimler bozulmasın. Yalnızca bilinen sonekler (" - Topic", "VEVO",
 * " - Official") ve parantezli gürültü kaldırılır.
 */
export function cleanArtistName(raw?: string | null): string {
  let value = (raw ?? '').trim();
  if (!value) return '';

  value = value.replace(AUDIO_EXTENSION, '').trim();
  value = value.replace(ARTIST_NOISE_PARENS, ' ');

  // Sonekleri birkaç kez uygula: "Artist - Topic - Official" gibi zincirler.
  for (let i = 0; i < 3; i++) {
    const before = value;
    for (const pattern of ARTIST_SUFFIX_PATTERNS) {
      value = value.replace(pattern, '');
    }
    value = value.trim();
    if (value === before) break;
  }

  value = value
    .replace(/^[\s,.:;|/~+\-–—]+|[\s,.:;|/~+\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (isPlaceholderArtist(value)) return '';
  return value;
}

/**
 * Parça başlığını gösterime hazırlar.
 *
 * `cleanDisplayTitle` zaten baştaki sıra numaralarını, parantezli etiketleri ve
 * "sanatçı - " önekini temizliyor; burada ek olarak dosya uzantısı ve boşluk
 * artıkları normalize edilir.
 */
export function cleanTrackTitle(
  rawTitle: string | null | undefined,
  artist?: string | null
): string {
  const source = (rawTitle ?? '').trim();
  if (!source) return '';
  const stripped = source.replace(AUDIO_EXTENSION, '').trim();
  const cleaned = cleanDisplayTitle(stripped, artist || undefined);
  return (cleaned || stripped).replace(/\s+/g, ' ').trim();
}

/**
 * Başlık + sanatçı çiftini tek seferde temizler.
 *
 * Sanatçı önce normalize edilir; başlık temizliğinde bu normalize sanatçı
 * kullanılır ki "Sanatçı - Şarkı" öneki doğru kırpılabilsin.
 */
export function cleanTrackFields(
  rawTitle: string | null | undefined,
  rawArtist: string | null | undefined
): { title: string; artist: string } {
  const artist = cleanArtistName(rawArtist);
  return { title: cleanTrackTitle(rawTitle, artist), artist };
}

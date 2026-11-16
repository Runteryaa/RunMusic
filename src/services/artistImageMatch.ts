/**
 * Sanatçı fotoğrafı eşleştirmesinin **saf** parçaları — Genius kaynağı.
 *
 * Neden Deezer değil: Deezer Türkiye'de hizmet vermiyor; API'si ve CDN'i
 * cihazdan erişilemiyor, ayrıca aynı adda onlarca kayıt döndürdüğü için
 * ("Motive" için dört, "UZI" için ondan fazla) yanlış kişinin fotoğrafını
 * gösteriyordu.
 *
 * Genius ise sözleri zaten sağladığımız kaynak: kimin hangi şarkıyı
 * yayınladığını biliyor ve sanatçı kaydında profil görselini tutuyor. Bu
 * modül, ağdan gelen yanıtlar içinden **doğru sanatçının görselini** seçen
 * saf kararları barındırır; `artistImages.ts` ağ ve önbelleği yönetir.
 */
import { normalizeArtistKey } from './artistMatch';

/** Genius sanatçı kaydındaki kullandığımız alanlar. */
export interface GeniusArtistLike {
  id?: number;
  name?: string;
  image_url?: string | null;
  header_image_url?: string | null;
  is_verified?: boolean;
}

/** `search/artist` yanıtındaki tek bir isabet. */
export interface GeniusArtistHit {
  result?: GeniusArtistLike;
}

/** `search/multi` yanıtındaki şarkı kaydı (kullandığımız alanlar). */
export interface GeniusSongLike {
  title?: string;
  title_with_featured?: string;
  artist_names?: string;
  primary_artist?: GeniusArtistLike;
  primary_artists?: GeniusArtistLike[];
}

/**
 * Kelime kümesi benzerliği (0..1).
 *
 * "Motive" ile "Motive" → 1; "MOT!VE" ile "Motive" → 0 (normalize farklı).
 */
export function wordSimilarity(a?: string | null, b?: string | null): number {
  const setA = new Set(normalizeArtistKey(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeArtistKey(b).split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((word) => {
    if (setB.has(word)) intersection++;
  });
  return intersection / Math.max(setA.size, setB.size);
}

/**
 * Genius'ın "fotoğraf yok" görselini ayırt eder.
 *
 * Profili olmayan sanatçılarda `image_url` şu sabit varlıklara işaret eder:
 * `https://assets.genius.com/images/default_cover_image.png` (ve aynı ailedeki
 * `default_banner.png`). Gerçek görseller `images.genius.com` üzerinde, dosya
 * adında 32 karakterlik bir özet taşır. Bu ikisini ayırmazsak herkese aynı gri
 * kapak gösterilir.
 */
export function isPlaceholderArtistImage(url?: string | null): boolean {
  const value = (url ?? '').trim();
  if (!value) return true;
  if (/assets\.genius\.com\/images\/default_/i.test(value)) return true;
  // Görsel barındırıcıları dışındaki adresler kullanılmaz.
  try {
    const { hostname } = new URL(value);
    return !/(^|\.)(images|filepicker-images)\.genius\.com$/i.test(hostname);
  } catch {
    return true;
  }
}

/**
 * Bir sanatçı kaydının kullanılabilir profil görseli (yoksa null).
 *
 * Kare profil görseli (`image_url`) tercih edilir. `header_image_url` geniş bir
 * banner olduğu için kare çerçevede kırpılıp bozuk görünür; yalnızca profil
 * görseli yoksa ve banner gerçekse son çare olarak kullanılır.
 */
export function geniusArtistImageOf(artist?: GeniusArtistLike | null): string | null {
  if (!artist) return null;
  if (!isPlaceholderArtistImage(artist.image_url)) return artist.image_url as string;
  if (!isPlaceholderArtistImage(artist.header_image_url)) return artist.header_image_url as string;
  return null;
}

/** Ada tam eşleşme (normalize edilmiş) veya yeterli kelime benzerliği. */
const MIN_NAME_SIMILARITY = 0.6;

/**
 * Sanatçı arama sonuçlarını kullanılabilir adaylara indirger.
 *
 * Sıra:
 *  1. Gerçek profil görseli olanlar (yer tutucular elenir).
 *  2. Ada **tam** eşleşenler varsa yalnızca onlar; yoksa kelime benzerliği
 *     eşiğini geçenler.
 *  3. Genius'ın kendi alaka sırası korunur. Genius'ta hayran sayısı gibi bir
 *     popülerlik alanı yok; alaka sırası zaten en iyi kaydı başa koyuyor.
 *
 * Tam eşleşme varken benzer isimlileri elemek önemli: "aisu" aramasında
 * "Aisuru", "aisukii", "AiSuu (あいす)" gibi ilgisiz kayıtlar karışıyor.
 */
export function rankGeniusArtists(
  hits: (GeniusArtistHit | GeniusArtistLike)[],
  name: string
): GeniusArtistLike[] {
  const target = normalizeArtistKey(name);
  if (!target) return [];

  const withImage = hits
    .map((hit) => ('result' in hit ? hit.result : hit))
    .filter((artist): artist is GeniusArtistLike => Boolean(artist))
    .map((artist) => ({ artist, image: geniusArtistImageOf(artist) }))
    .filter((entry): entry is { artist: GeniusArtistLike; image: string } => Boolean(entry.image));

  const exact = withImage.filter(
    (entry) => normalizeArtistKey(entry.artist.name) === target
  );
  const pool =
    exact.length > 0
      ? exact
      : withImage.filter(
          (entry) => wordSimilarity(entry.artist.name, name) >= MIN_NAME_SIMILARITY
        );

  return pool.map((entry) => entry.artist);
}

/**
 * Şarkı araması isabetlerinden **ada tam eşleşen** sanatçının görseli.
 *
 * Kullanıcının istediği akış: çalan şarkının adı + sanatçı adı aranır, o
 * şarkıyı yayınlayan sanatçının fotoğrafı alınır. Genius şarkı kaydı bu
 * eşleşmeyi kesinleştirir — aynı ada sahip başka sanatçılar devre dışı kalır.
 *
 * İsabet sırası korunur: sorgu zaten parça adını içerdiği için ilk isabet
 * hedeflenen şarkıdır.
 */
export function pickArtistFromSongs(
  songs: GeniusSongLike[],
  name: string
): string | null {
  const target = normalizeArtistKey(name);
  if (!target) return null;

  for (const song of songs) {
    const candidates: GeniusArtistLike[] = [];
    if (song?.primary_artist) candidates.push(song.primary_artist);
    if (Array.isArray(song?.primary_artists)) candidates.push(...song.primary_artists);

    for (const artist of candidates) {
      if (normalizeArtistKey(artist?.name) !== target) continue;
      const image = geniusArtistImageOf(artist);
      if (image) return image;
    }
  }
  return null;
}

/** Arama başına istenen isabet sayısı (Genius üst sınırı 5). */
export const GENIUS_SUGGEST_LIMIT = 5;

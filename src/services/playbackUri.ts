/**
 * Yerel dosya yollarını TrackPlayer/ExoPlayer'a güvenle vermek için normalize eder.
 *
 * Android `Uri.parse` (ve iOS URL ayrıştırıcıları) `#` karakterini fragment,
 * `?` karakterini query başlangıcı kabul eder. `expo-media-library` ise asset
 * URI'sini `file://$path` olarak, yolu yüzde-kodlamadan üretir. Bu yüzden
 * "... #PLA4.opus" gibi bir dosya `file:///.../#PLA4.opus` hâline gelir ve
 * oynatıcı yolu `#` öncesine kadar keser; dosya bulunamaz, parça yanlışlıkla
 * "çalınamaz" işaretlenir.
 *
 * Bu modül yalnızca yerel `file://` yollarını (veya şemasız ham yolları)
 * kodlar. `content://`, `http://`, `https://` gibi URI'lar olduğu gibi kalır.
 * Zaten kodlanmış `%XX` dizileri korunur; böylece fonksiyon idempotenttir.
 */

const FILE_URI_PREFIX = 'file://';

/** Yerel olmayan, olduğu gibi bırakılması gereken şemalar. */
const PASSTHROUGH_SCHEME = /^(?:https?|content|asset|data|blob):/i;

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

/**
 * Bir dosya yolunu tek seferde yüzde-kodlar. Mevcut `%XX` dizileri korunur,
 * `/` ayırıcıları korunur; diğer her şey (boşluk, `#`, `?`, Unicode, `[`, `]`)
 * `encodeURIComponent` ile kodlanır.
 */
function encodeLocalPath(path: string): string {
  let encoded = '';

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    // Daha önce kodlanmış bir baytı tekrar kodlamayı önle.
    if (char === '%' && i + 2 < path.length && HEX_PAIR.test(path.slice(i + 1, i + 3))) {
      encoded += path.slice(i, i + 3);
      i += 2;
      continue;
    }

    if (char === '/') {
      encoded += char;
      continue;
    }

    const codePoint = path.codePointAt(i);
    if (codePoint == null) continue;

    const symbol = String.fromCodePoint(codePoint);
    encoded += encodeURIComponent(symbol);

    // Vekil çiftin ikinci yarısını tekrar işleme.
    if (symbol.length === 2) i++;
  }

  return encoded;
}

/**
 * TrackPlayer'a verilecek yerel URI'yi güvenli biçime getirir.
 * Uzak/MediaStore URI'larına dokunmaz.
 */
export function toPlayableUri(uri: string | null | undefined): string {
  const raw = String(uri ?? '');
  if (!raw) return '';
  if (PASSTHROUGH_SCHEME.test(raw)) return raw;

  if (/^file:\/\//i.test(raw)) {
    return `${FILE_URI_PREFIX}${encodeLocalPath(raw.slice(FILE_URI_PREFIX.length))}`;
  }

  // Şemasız ham yol (ör. bazı yerel dosya sağlayıcıları).
  return encodeLocalPath(raw);
}

/** Track nesnesinin URL'sini oynatılabilir hâle getirir; gerekmiyorsa aynı nesneyi döndürür. */
export function toPlayableTrack<T extends { url: string }>(track: T): T {
  const url = toPlayableUri(track.url);
  return url === track.url ? track : { ...track, url };
}

/** Bir track listesini TrackPlayer'a vermeden önce normalize eder. */
export function toPlayableTracks<T extends { url: string }>(tracks: readonly T[]): T[] {
  return tracks.map(toPlayableTrack);
}

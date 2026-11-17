/**
 * Sanatçı sayfası için saf veri üretimi.
 *
 * İki iş yapar:
 *  1. Cihaz kütüphanesini sanatçıya göre gruplar (`buildArtistIndex`). Ortak
 *     çalışmalar her iki sanatçının altında da görünür.
 *  2. Dinleme geçmişini sanatçıya göre süzüp o sanatçının istatistiklerini
 *     üretir (`buildArtistProfile`). Toplama işi Wrapped ile aynı motordan
 *     (`buildWrappedStats`) geçtiği için sayılar Wrapped/İstatistikler ile
 *     tutarlıdır.
 *
 * Native import yok; Node doğrulama betiklerinde doğrudan çalışır.
 */

import { normalizeArtistKey, artistNamesFromRow } from './artistMatch';
import { cleanTrackFields } from './displayNames';
import {
  buildWrappedStats,
  type WrappedPlayRow,
  type WrappedRankedItem,
  type WrappedStats,
} from './wrappedStats';

/** Sanatçı sayfasındaki liste için kütüphane parçası. */
export interface ArtistTrack {
  /** Kütüphane varlık kimliği (kuyruk ve oynatma bunu kullanır). */
  id: string;
  uri: string;
  title: string;
  /** Parçanın tam sanatçı alanı ("UZI, MODD" olabilir). */
  artist: string;
  album?: string;
  artwork?: string | null;
  duration: number;
}

/** Kütüphaneden sanatçıya çözümlenmiş parça girdisi. */
export type LibraryArtistInput = ArtistTrack;

export interface ArtistLibraryEntry {
  key: string;
  /** Sanatçının kütüphanede görünen yazımı (ilk karşılaşılan). */
  displayName: string;
  tracks: ArtistTrack[];
}

/** Parçayı ait olduğu tüm sanatçı anahtarlarına dağıtır. */
export function buildArtistIndex(tracks: LibraryArtistInput[]): Map<string, ArtistLibraryEntry> {
  const index = new Map<string, ArtistLibraryEntry>();

  for (const track of tracks) {
    const names = artistNamesFromRow(track.artist);
    const seen = new Set<string>();

    for (const name of names) {
      const key = normalizeArtistKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const entry = index.get(key);
      if (entry) {
        entry.tracks.push(track);
      } else {
        index.set(key, {
          key,
          displayName: name.trim() || track.artist,
          tracks: [track],
        });
      }
    }
  }

  return index;
}

/** Sanatçının en çok dinlenen parçalarından fotoğraf doğrulama ipuçları. */
export const MAX_TITLE_HINTS_PER_ARTIST = 4;

/**
 * Dinleme geçmişinden **sanatçı → parça adları** haritası üretir.
 *
 * Bu harita sanatçı fotoğrafı aramasında kullanılır: Deezer'da aynı adda
 * birden çok sanatçı olduğu için, gerçekten dinlenen parçaların adları
 * (ör. "Cennet", "YIN YANG") doğru kaydı kesin olarak belirler.
 *
 * Tek geçişte üretilir; parça adları dinlenme sayısına göre sıralanır.
 * Dönüş: normalize sanatçı anahtarı → en çok dinlenen birkaç parça adı.
 */
export function buildArtistTitleHints(
  rows: WrappedPlayRow[],
  options?: { perArtist?: number }
): Record<string, string[]> {
  const perArtist = Math.max(1, options?.perArtist ?? MAX_TITLE_HINTS_PER_ARTIST);
  // Anahtar → (başlık → sayı, ilk görülme sırası).
  const titleCounts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    // Fotoğraf arama ipuçları kullanıcıya görünen (temizlenmiş) başlıklardan
    // üretilir: "Song (Official Video)" gibi ham etiketler aramaya sızmasın.
    const title = cleanTrackFields(row.title, row.artist).title;
    if (!title) continue;
    const names = artistNamesFromRow(row.artist);
    const seen = new Set<string>();
    for (const name of names) {
      const key = normalizeArtistKey(name);
      // Boş sanatçı ve aynı satırdaki tekrarlar atlanır.
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let counts = titleCounts.get(key);
      if (!counts) {
        counts = new Map();
        titleCounts.set(key, counts);
      }
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
  }

  const hints: Record<string, string[]> = {};
  for (const [key, counts] of titleCounts) {
    hints[key] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, perArtist)
      .map(([title]) => title);
  }
  return hints;
}

/** Belirli bir sanatçının kütüphanedeki parçaları (yoksa boş dizi). */
export function getArtistTracks(
  index: Map<string, ArtistLibraryEntry>,
  artistKey: string
): ArtistTrack[] {
  return index.get(normalizeArtistKey(artistKey))?.tracks ?? [];
}

/**
 * Bir sanatçı için SQL ön süzmesinde kullanılacak ad yazımları.
 *
 * Sanatçı alanında farklı yazımlar olabiliyor ("UZI", "uzi", "UZI, MODD").
 * Kütüphanedeki tüm parçalardan bu anahtara düşen yazımlar toplanır; böylece
 * `LIKE` sorgusu hiçbir satırı kaçırmaz.
 */
export function collectArtistNameVariants(tracks: ArtistTrack[], artistKey: string): string[] {
  const key = normalizeArtistKey(artistKey);
  const variants = new Set<string>();
  if (!key) return [];

  for (const track of tracks) {
    for (const name of artistNamesFromRow(track.artist)) {
      if (normalizeArtistKey(name) === key && name.trim()) variants.add(name.trim());
    }
  }

  return [...variants];
}

/**
 * Dinleme geçmişinden yalnızca o sanatçıya ait satırları süzer.
 *
 * Sanatçı alanı boş olan eski kayıtlar hiçbir sanatçıya yazılmaz; bu yüzden
 * "bilinmeyen sanatçı" istatistikleri gerçek sanatçılara karışmaz.
 */
export function filterRowsForArtist(rows: WrappedPlayRow[], artistKey: string): WrappedPlayRow[] {
  const key = normalizeArtistKey(artistKey);
  if (!key) return [];
  return rows.filter((row) =>
    artistNamesFromRow(row.artist).some((name) => normalizeArtistKey(name) === key)
  );
}

/**
 * Parça kimliği → o sanatçı için dinleme sayısı.
 *
 * Anahtar olarak `track_id` kullanılır. Kimlik geçmişte varlık kimliği ya da
 * dosya URL'i olarak yazıldığı için sanatçı sayfası iki biçimi de arar.
 */
export function buildArtistTrackPlayCounts(
  rows: WrappedPlayRow[],
  artistKey: string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of filterRowsForArtist(rows, artistKey)) {
    const id = (row.track_id ?? '').trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface ArtistProfile {
  /** Sanatçının normalize anahtarı. */
  key: string;
  /** Geçmişte görünen yazım (bulunamazsa boş). */
  displayName: string;
  stats: WrappedStats;
  /** Parça kimliği → dinleme sayısı (yalnızca bu sanatçı). */
  playCounts: Map<string, number>;
}

/**
 * Sanatçıya özel istatistik paketi.
 *
 * `rows` **zaten o sanatçıya süzülmüş** satırlardır (`getHistoryInRangeForArtists`
 * gibi SQL ön süzmesinden gelir). Tek geçişte hem istatistikler hem parça
 * dinleme sayıları üretilir; eskiden aynı satırlar iki kez filtreleniyordu ve
 * tüm geçmiş tarandığında bu saniyeler alıyordu.
 *
 * `limit` Wrapped'teki varsayılan (5) yerine daha uzun liste üretmek için
 * kullanılır; sanatçı sayfasında "en çok dinlediğin" bölümünü besler.
 */
export function buildArtistProfileFromRows(
  rows: WrappedPlayRow[],
  artistKey: string,
  options?: { limit?: number }
): ArtistProfile {
  const key = normalizeArtistKey(artistKey);

  const playCounts = new Map<string, number>();
  let displayName = '';

  for (const row of rows) {
    const id = (row.track_id ?? '').trim();
    if (id) playCounts.set(id, (playCounts.get(id) ?? 0) + 1);

    if (!displayName) {
      for (const name of artistNamesFromRow(row.artist)) {
        if (normalizeArtistKey(name) === key && name.trim()) {
          displayName = name.trim();
          break;
        }
      }
    }
  }

  return {
    key,
    displayName,
    stats: buildWrappedStats(rows, { limit: options?.limit ?? 5 }),
    playCounts,
  };
}

/** Tüm geçmiş elde olduğunda kullanılan sarmalayıcı (sanatçıya süzer). */
export function buildArtistProfile(
  rows: WrappedPlayRow[],
  artistKey: string,
  options?: { limit?: number }
): ArtistProfile {
  return buildArtistProfileFromRows(filterRowsForArtist(rows, artistKey), artistKey, options);
}

/**
 * Kütüphane parçalarını "en çok dinlenen en üstte" sırasına dizer.
 *
 * Dinleme sayısı eşitse başlığa göre alfabetik; böylece liste her açılışta
 * aynı sırada kalır (deterministik). Hiç dinlenmemiş parçalar sona düşer.
 */
export function sortTracksByPlays(
  tracks: ArtistTrack[],
  playCounts: Map<string, number>
): ArtistTrack[] {
  const playsOf = (track: ArtistTrack) =>
    Math.max(playCounts.get(track.id) ?? 0, track.uri ? playCounts.get(track.uri) ?? 0 : 0);

  return [...tracks].sort((a, b) => {
    const diff = playsOf(b) - playsOf(a);
    if (diff !== 0) return diff;
    return (a.title || '').localeCompare(b.title || '', 'tr');
  });
}

/** Sanatçının en çok dinlenen parçalarını kütüphane parçalarıyla eşler. */
export function topArtistTracks(
  tracks: ArtistTrack[],
  playCounts: Map<string, number>,
  limit = 5
): { track: ArtistTrack; plays: number }[] {
  return sortTracksByPlays(tracks, playCounts)
    .map((track) => ({
      track,
      plays: Math.max(playCounts.get(track.id) ?? 0, track.uri ? playCounts.get(track.uri) ?? 0 : 0),
    }))
    .filter((entry) => entry.plays > 0)
    .slice(0, Math.max(1, limit));
}

/** Toplam dinleme sayısı (sanatçı kapsamında). */
export function getArtistTotalPlays(rows: WrappedPlayRow[], artistKey: string): number {
  return filterRowsForArtist(rows, artistKey).length;
}

export type { WrappedRankedItem };

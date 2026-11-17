import { normalizeSearchText } from './searchUtils';

/**
 * Kitaplık araçları için saf (native'siz) yardımcılar.
 *
 * Ekrandan ayrı tutulur: kopya gruplama ve eksik meta veri tespiti kolayca
 * test edilebilsin, UI yalnızca sonucu çizsin.
 */

/** Araç ekranının ihtiyaç duyduğu en küçük parça bilgisi. */
export interface LibraryToolTrack {
  id: string;
  uri: string;
  filename: string;
  duration: number;
  /** Görünen (temizlenmiş) başlık. */
  title: string;
  /** Görünen (temizlenmiş) sanatçı; bilinmiyorsa boş dize. */
  artist: string;
  album?: string;
  artwork?: string;
  size?: number;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  artist: string;
  /** En az iki parça; süreye göre artan sırada. */
  tracks: LibraryToolTrack[];
}

/** Kopya karşılaştırmasında kullanılan süre toleransı (saniye). */
export const DUPLICATE_DURATION_TOLERANCE_SEC = 2;

function normalizeKeyPart(value: string | undefined): string {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aynı başlık + sanatçıya sahip ve süresi tolerans içinde olan parçaları
 * gruplar.
 *
 * Gruplama iki aşamalıdır: önce normalize edilmiş başlık/sanatçı, sonra bu
 * küme içinde süre komşuluğu. Böylece aynı şarkının 3:01 ve 6:12'lik
 * (ör. normal + uzatılmış) sürümleri yanlışlıkla aynı gruba düşmez.
 */
export function findDuplicateGroups(
  tracks: LibraryToolTrack[],
  toleranceSec: number = DUPLICATE_DURATION_TOLERANCE_SEC
): DuplicateGroup[] {
  const byKey = new Map<string, LibraryToolTrack[]>();

  for (const track of tracks) {
    const titleKey = normalizeKeyPart(track.title);
    const artistKey = normalizeKeyPart(track.artist);
    if (!titleKey) continue;
    const key = `${titleKey}\u0000${artistKey}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(track);
    else byKey.set(key, [track]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => (a.duration || 0) - (b.duration || 0));

    let cluster: LibraryToolTrack[] = [];
    const flush = () => {
      if (cluster.length >= 2) {
        groups.push({
          key: `${key}\u0000${Math.round(cluster[0].duration || 0)}`,
          title: cluster[0].title,
          artist: cluster[0].artist,
          tracks: cluster,
        });
      }
      cluster = [];
    };

    for (const track of sorted) {
      if (cluster.length === 0) {
        cluster = [track];
        continue;
      }
      const previous = cluster[cluster.length - 1];
      if (Math.abs((track.duration || 0) - (previous.duration || 0)) <= toleranceSec) {
        cluster.push(track);
      } else {
        flush();
        cluster = [track];
      }
    }
    flush();
  }

  // En çok yer kaplayan (kimin silineceği belli olsun) gruplar önce gelsin.
  groups.sort((a, b) => {
    const sizeOf = (group: DuplicateGroup) =>
      group.tracks.reduce((sum, track) => sum + (track.size || 0), 0);
    return sizeOf(b) - sizeOf(a) || a.title.localeCompare(b.title);
  });

  return groups;
}

export interface MissingMetadataTrack extends LibraryToolTrack {
  missing: ('artwork' | 'artist' | 'album')[];
}

/** Kapağı, sanatçısı veya albümü eksik parçaları listeler. */
export function findMissingMetadata(tracks: LibraryToolTrack[]): MissingMetadataTrack[] {
  const result: MissingMetadataTrack[] = [];
  for (const track of tracks) {
    const missing: MissingMetadataTrack['missing'] = [];
    if (!track.artwork) missing.push('artwork');
    if (!track.artist) missing.push('artist');
    if (!track.album) missing.push('album');
    if (missing.length > 0) result.push({ ...track, missing });
  }
  // En çok eksiği olanlar önce.
  result.sort((a, b) => b.missing.length - a.missing.length || a.title.localeCompare(b.title));
  return result;
}

/** Süreyi `m:ss` (veya saat varsa `h:mm:ss`) biçiminde yazar. */
export function formatToolDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

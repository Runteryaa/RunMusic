/**
 * Sanatçı fotoğrafı eşleştirmesinin **saf** parçaları.
 *
 * Deezer'da aynı adda birden çok sanatçı olabiliyor ("Motive" için dört ayrı
 * kayıt, "UZI" için beş). Doğru kişiyi seçmek ağ erişimi gerektirmeyen bir
 * sıralama problemidir; bu yüzden burada tutulur ve Node doğrulama betiğiyle
 * gerçek Deezer yanıtları üzerinde test edilebilir.
 *
 * `artistImages.ts` ağ isteklerini ve önbelleği yönetir, kararı buradan alır.
 */
import { normalizeArtistKey } from './artistMatch';

/** Deezer sanatçı arama yanıtındaki kullandığımız alanlar. */
export interface DeezerArtistLike {
  id?: number;
  name?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
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
 * Deezer'ın "fotoğraf yok" görselini ayırt eder.
 *
 * Gerçek görsellerin CDN yolunda 32 karakterlik bir özet (hash) bulunur:
 * `/images/artist/<hash>/500x500-...`. Profili olmayan sanatçılarda bu alan
 * kısa ya da sıfırlarla dolu olur; böyle bir URL beyaz yer tutucu gösterir.
 */
export function isPlaceholderPicture(url?: string | null): boolean {
  if (!url) return true;
  const match = url.match(/\/artist\/([^/]*)\//);
  const hash = match?.[1] ?? '';
  return hash.length < 8 || /^0+$/.test(hash);
}

/**
 * İki başlık listesinin normalize edilmiş örtüşmesi (0..1).
 *
 * Uzun listelerin (25 parça) kısa listeleri ezmemesi için bölen, iki listenin
 * **kısa** olanıdır.
 */
export function titleOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((title) => normalizeArtistKey(title)).filter(Boolean));
  if (setB.size === 0) return 0;
  let hits = 0;
  for (const title of a) {
    const key = normalizeArtistKey(title);
    if (key && setB.has(key)) hits += 1;
  }
  return hits / Math.max(1, Math.min(a.length, setB.size));
}

/** Ada tam eşleşme (normalize edilmiş) veya yeterli kelime benzerliği. */
const MIN_NAME_SIMILARITY = 0.6;

/**
 * Arama sonuçlarını fotoğrafı olan adaylara indirger ve popülerliğe göre
 * sıralar.
 *
 * Sıra:
 *  1. Fotoğrafı olan ve beyaz yer tutucu olmayan kayıtlar.
 *  2. Ada **tam** eşleşenler varsa yalnızca onlar; yoksa kelime benzerliği
 *     eşiğini geçenler.
 *  3. Hayran sayısı (`nb_fan`) azalan.
 *
 * Tam eşleşme varken benzer isimlileri elemek önemli: "Motive" aramasında
 * "MOT!VE" gibi ilgisiz kayıtlar sonuca karışıyor.
 */
export function rankDeezerArtists(
  results: DeezerArtistLike[],
  name: string
): DeezerArtistLike[] {
  const target = normalizeArtistKey(name);
  const withPicture = results.filter((artist) => {
    const picture = artist.picture_big || artist.picture_medium;
    return Boolean(picture) && !isPlaceholderPicture(picture);
  });

  const exact = withPicture.filter((artist) => normalizeArtistKey(artist.name) === target);
  const pool =
    exact.length > 0
      ? exact
      : withPicture.filter((artist) => wordSimilarity(artist.name, name) >= MIN_NAME_SIMILARITY);

  return [...pool].sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
}

/** Bir adayın görsel URL'i (büyük tercih edilir). */
export function artistPictureOf(artist: DeezerArtistLike): string | null {
  return artist.picture_big || artist.picture_medium || null;
}

/** Deezer parça araması yanıtındaki kullandığımız alanlar. */
export interface DeezerTrackLike {
  title?: string;
  artist?: DeezerArtistLike;
}

/**
 * Parça araması sonuçlarından **ada tam eşleşen** sanatçı kimlikleri.
 *
 * Neden bu sinyal daha güçlü: `search?q=<parça> <sanatçı>` sorgusu Deezer'da
 * doğrudan parçayı yayınlayan kaydı döner. En popüler parça listelerini
 * karşılaştırmaya gerek kalmaz ve kütüphanede tek bir parça olsa bile çalışır.
 * Sıra korunur: Deezer'ın alaka sırası ilk sırada en doğru kaydı verir.
 */
export function matchingTrackArtistIds(
  results: DeezerTrackLike[],
  name: string
): number[] {
  const target = normalizeArtistKey(name);
  if (!target) return [];

  const ids: number[] = [];
  for (const result of results) {
    const artistId = result?.artist?.id;
    if (typeof artistId !== 'number') continue;
    if (normalizeArtistKey(result.artist?.name) !== target) continue;
    ids.push(artistId);
  }
  return ids;
}

/**
 * Oy sayımından kazanan sanatçı kimliği.
 *
 * `votes`: sanatçı kimliği → kaç parça araması o kimliği işaret etti.
 * `priority` (popülerliğe göre sıralı adaylar) eşitlik bozucudur.
 */
export function bestVotedId(
  votes: Map<number, number>,
  priority: number[] = []
): number | null {
  if (votes.size === 0) return null;

  let bestId: number | null = null;
  let bestVotes = 0;
  let bestRank = Number.POSITIVE_INFINITY;

  const rankOf = (id: number) => {
    const index = priority.indexOf(id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };

  for (const [id, count] of votes) {
    const rank = rankOf(id);
    if (
      count > bestVotes ||
      (count === bestVotes && rank < bestRank)
    ) {
      bestId = id;
      bestVotes = count;
      bestRank = rank;
    }
  }
  return bestId;
}

/** Kimlik doğrulaması için en fazla kaç parça adı aranır. */
export const MAX_TRACK_SEARCHES = 3;

/** Örtüşme doğrulaması için en fazla kaç adayın parçaları sorgulanır. */
export const MAX_TITLE_CANDIDATES = 3;

/**
 * Popülerliğe göre sıralı adaylar arasından parça örtüşmesine göre seçim.
 *
 * `tops[i]`, `candidates[i]`'nin en popüler parçalarıdır. Örtüşme yoksa
 * popülerlik sıralaması korunur (indeks 0). Böylece doğrulama yalnızca
 * belirsizliği çözer, hiçbir zaman popüler adayı gereksiz yere elemez.
 */
export function pickByTitleOverlap(
  candidates: DeezerArtistLike[],
  knownTitles: string[],
  tops: string[][]
): number {
  if (candidates.length <= 1 || knownTitles.length === 0) return 0;

  let bestIndex = 0;
  let bestScore = 0;
  for (let index = 0; index < candidates.length; index++) {
    const score = titleOverlap(knownTitles, tops[index] ?? []);
    // Eşitlikte daha popüler olan (dizide önce gelen) korunur.
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

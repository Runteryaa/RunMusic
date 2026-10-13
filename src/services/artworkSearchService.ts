/**
 * iTunes Search API üzerinden şarkı ve albüm kapağı arama servisi.
 * Ücretsiz, API anahtarı gerektirmez ve yüksek çözünürlüklü kapaklar sunar.
 */

export interface OnlineArtworkResult {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  artworkUrl: string;
  thumbnailUrl: string;
}

/**
 * Başlık ve sanatçıya göre internetten albüm kapaklarını arar.
 */
export async function searchOnlineArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  try {
    const cleanTitle = title.replace(/\.[a-zA-Z0-9]+$/, '').trim();
    const query = [cleanTitle, artist].filter(Boolean).join(' ').trim();
    if (!query) return [];

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      query
    )}&entity=song&limit=12`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'RunMusic/1.0',
      },
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.results)) {
      return [];
    }

    const seenUrls = new Set<string>();
    const results: OnlineArtworkResult[] = [];

    for (const item of data.results) {
      const art100 = item.artworkUrl100 as string | undefined;
      if (!art100) continue;

      // 100x100 yerine 600x600 veya 1000x1000 yüksek çözünürlüklü URL üret
      const highRes = art100.replace('100x100bb', '600x600bb');
      const thumb = art100.replace('100x100bb', '200x200bb');

      if (seenUrls.has(highRes)) continue;
      seenUrls.add(highRes);

      results.push({
        id: String(item.trackId || item.collectionId || Math.random()),
        trackName: item.trackName || '',
        artistName: item.artistName || '',
        albumName: item.collectionName || undefined,
        artworkUrl: highRes,
        thumbnailUrl: thumb,
      });
    }

    return results;
  } catch (error) {
    console.warn('[artworkSearchService] error searching artwork:', error);
    return [];
  }
}

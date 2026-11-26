import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TouchableOpacity } from '../components/ui/TouchableOpacity';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack } from 'react-native-track-player';

import { GradientSurface, withAlpha } from '../components/ui/GradientSurface';
import { ArtistRenameModal } from '../components/ArtistRenameModal';
import { EditTrackModal, type EditTrackTarget } from '../components/EditTrackModal';
import { useStore, type TrackMetadata } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import {
  getHistoryInRangeForArtists,
  getHistoryInRangeForUnassignedArtist,
  renameArtistInHistory,
  type PlayHistoryItem,
} from '../services/statsDatabase';
import { renameArtistInField } from '../services/artistRename';
import {
  buildArtistProfileFromRows,
  buildArtistIndex,
  collectArtistNameVariants,
  getArtistTracks,
  getUnassignedTracks,
  sortTracksByPlays,
  type ArtistLibraryEntry,
  type ArtistProfile,
  type ArtistTrack,
} from '../services/artistProfile';
import { normalizeArtistKey, artistNamesFromRow } from '../services/artistMatch';
import {
  formatWrappedDuration,
  resolveWrappedWindow,
  type WrappedPeriod,
} from '../services/wrappedStats';
import { cleanTrackFields, cleanArtistName, isPlaceholderArtist } from '../services/displayNames';
import { getSearchKeywords } from '../services/lyricsService';
import { loadArtistImages } from '../services/artistImages';
import { startPlaybackFromLibrary } from '../services/queueController';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useTranslation } from '../services/i18n';
import { useBackToLibrary } from '../hooks/useBackToLibrary';

const PERIODS: WrappedPeriod[] = ['year', 'last12m', 'all'];
const TOP_TRACK_COUNT = 5;

/**
 * Kütüphane bilgisi önbelleği.
 *
 * `clear()` yerine en eski kayıtların bir kısmı atılır: büyük kütüphanelerde
 * her taşmada tüm önbelleği boşaltmak aynı parçaların yeniden ayrıştırılmasına
 * yol açıyordu.
 */
const TRACK_INFO_CACHE = new Map<string, { title: string; artist: string }>();
const MAX_TRACK_INFO_CACHE = 4000;
/** Kararlı boş dizi: bileşen her render'da yeni referans üretmesin. */
const EMPTY_TRACKS: ArtistTrack[] = [];

type MetadataLike = { title?: string; artist?: string; album?: string; artwork?: string };

/**
 * Kütüphane varlığını görünen başlık/sanatçıya çözer.
 *
 * `index.tsx` içindeki kütüphane listesiyle **aynı** sıra izlenir (önce
 * metadataMap, sonra dosya adı ayrıştırma). Böylece listede "UZI, MODD" yazan
 * parça sanatçı sayfasında da aynı sanatçılara düşer.
 */
function resolveLibraryInfo(
  asset: { id: string; uri: string; filename: string; modificationTime?: number },
  metadataMap: Record<string, MetadataLike>
): { title: string; artist: string } {
  const meta = metadataMap[asset.id] || metadataMap[asset.uri];
  const cacheKey = `${asset.id}_${asset.modificationTime || 0}_${meta?.title || ''}_${meta?.artist || ''}`;
  const cached = TRACK_INFO_CACHE.get(cacheKey);
  if (cached) return cached;

  const metaTitle = meta?.title?.trim() || '';
  const rawMetaArtist = meta?.artist?.trim() || '';
  const metaArtist = isPlaceholderArtist(rawMetaArtist) ? '' : cleanArtistName(rawMetaArtist);

  let info: { title: string; artist: string };
  if (metaTitle && metaArtist) {
    info = { title: cleanTrackFields(metaTitle, metaArtist).title, artist: metaArtist };
  } else {
    const keywords = getSearchKeywords(asset.filename);
    const keywordArtist = isPlaceholderArtist(keywords.expectedArtist)
      ? ''
      : cleanArtistName(keywords.expectedArtist);
    const fields = cleanTrackFields(metaTitle || keywords.expectedTrack || asset.filename, metaArtist);
    info = { title: fields.title, artist: fields.artist || keywordArtist };
  }

  if (TRACK_INFO_CACHE.size >= MAX_TRACK_INFO_CACHE) {
    const drop = Math.floor(MAX_TRACK_INFO_CACHE * 0.15);
    let removed = 0;
    for (const key of TRACK_INFO_CACHE.keys()) {
      TRACK_INFO_CACHE.delete(key);
      if (++removed >= drop) break;
    }
  }
  TRACK_INFO_CACHE.set(cacheKey, info);
  return info;
}

/**
 * Sanatçı indeksi önbelleği.
 *
 * Tüm kütüphaneyi her açılışta yeniden gruplamak büyük kütüphanelerde
 * gözle görülür bir gecikme yaratıyordu. İndeks yalnızca `library` veya
 * `metadataMap` referansı değişince yeniden kurulur.
 */
let indexCache: {
  library: unknown;
  metadataMap: unknown;
  index: Map<string, ArtistLibraryEntry>;
  /** İndeksin kaynağı; "sanatçısı boş" parçalar için de kullanılır. */
  inputs: ArtistTrack[];
} | null = null;

/** Kütüphane varlıklarını görünen başlık/sanatçıyla parça girdilerine çevirir. */
function buildArtistInputs(
  library: { id: string; uri: string; filename: string; modificationTime?: number; duration?: number }[],
  metadataMap: Record<string, MetadataLike>
): ArtistTrack[] {
  return library.map((asset) => {
    const info = resolveLibraryInfo(asset, metadataMap);
    return {
      id: asset.id,
      uri: asset.uri,
      title: info.title,
      artist: info.artist,
      album: metadataMap[asset.id]?.album || undefined,
      artwork: metadataMap[asset.id]?.artwork || undefined,
      duration: asset.duration || 0,
    };
  });
}

function getCachedArtistWorkspace(
  library: { id: string; uri: string; filename: string; modificationTime?: number; duration?: number }[],
  metadataMap: Record<string, MetadataLike>
) {
  if (indexCache && indexCache.library === library && indexCache.metadataMap === metadataMap) {
    return indexCache;
  }

  const inputs = buildArtistInputs(library, metadataMap);
  const index = buildArtistIndex(inputs);
  indexCache = { library, metadataMap, index, inputs };
  return indexCache;
}

function getCachedArtistIndex(
  library: { id: string; uri: string; filename: string; modificationTime?: number; duration?: number }[],
  metadataMap: Record<string, MetadataLike>
): Map<string, ArtistLibraryEntry> {
  return getCachedArtistWorkspace(library, metadataMap).index;
}

/** `199` → `3:19` (satır sonundaki süre). */
function formatTrackDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total <= 0) return '';
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function ArtistScreen() {
  const router = useRouter();
  // Geri tuşu kütüphaneye döner; oynatıcı çalmaya devam eder.
  useBackToLibrary();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name?: string | string[] }>();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();
  const activeTrack = useActiveTrack();
  const openFullscreenPlayer = usePlayerUIStore((s) => s.openFullscreenPlayer);

  const artistName = Array.isArray(params.name) ? params.name[0] : params.name || '';
  const artistKey = normalizeArtistKey(artistName);
  /** Boş sanatçı: istatistiklerdeki "-" grubu; düzeltilecek parçalar listelenir. */
  const isUnassignedArtist = artistKey.length === 0;

  const library = useStore((s) => s.library);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);
  const allAssets = useStore((s) => s.allAssets);

  const [period, setPeriod] = useState<WrappedPeriod>('all');
  /**
   * Profil, ait olduğu sanatçı anahtarıyla birlikte tutulur.
   *
   * NEDEN: sayfa aynı route üzerinde yeni `name` parametresiyle yeniden
   * kullanılabiliyor. State yalnızca sanatçıya göre sıfırlansaydı, ilk karede
   * yeni sanatçının adıyla birlikte **eski** istatistikler görünürdü. Anahtar
   * eşleşmediğinde `profile` doğrudan `null` türetilir; böylece eski veri hiçbir
   * karede çizilmez ve render sırasında state yazmaya gerek kalmaz.
   */
  const [profileState, setProfileState] = useState<{
    key: string;
    value: ArtistProfile;
  } | null>(null);
  const profile = profileState?.key === artistKey ? profileState.value : null;
  /**
   * "Bilinmeyen sanatçı" sayfasında geçmişte görülen parçalar.
   *
   * Kütüphane kaydı artık sanatçı içerse bile eski dinleme satırları boş
   * kalmış olabilir; bu parçalar da listede görünür ki kayıtları düzeltilebilsin.
   */
  const [unassignedHistoryState, setUnassignedHistoryState] = useState<{
    key: string;
    tracks: ArtistTrack[];
  } | null>(null);
  /** Yüklenmiş (sanatçı + dönem) anahtarı; eşleşmiyorsa yükleme sürüyor. */
  const [loadedKey, setLoadedKey] = useState('');
  const [artistImageState, setArtistImageState] = useState<{
    key: string;
    uri: string | null;
  } | null>(null);
  const artistImage = artistImageState?.key === artistKey ? artistImageState.uri : null;
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamedTo, setRenamedTo] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  /** "Bilinmeyen sanatçı" listesinden açılan parça düzenleme modalı. */
  const [trackToEdit, setTrackToEdit] = useState<EditTrackTarget | null>(null);
  /** Metadata düzenlemesinden sonra geçmiş sorgusunu yeniden çalıştırır. */
  const [statsRevision, setStatsRevision] = useState(0);

  const loadKey = `${artistKey}|${period}`;
  const loading = loadedKey !== loadKey;
  const unassignedHistoryTracks =
    unassignedHistoryState?.key === loadKey ? unassignedHistoryState.tracks : EMPTY_TRACKS;

  // Ekran kapandıktan sonra gelen sonuçların state yazmasını engeller
  // (hızlı geri dönüşlerde gereksiz iş yapılmaz).
  const mountedRef = useRef(true);
  /** Yalnızca en son dönem isteğinin sonucu uygulanır. */
  const requestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const durationLabels = {
    hour: t('wrapped.unit_hour'),
    minute: t('wrapped.unit_minute'),
    second: t('wrapped.unit_second'),
  };

  /** Cihazdaki sanatçı parçaları (indeks önbellekli). */
  const artistTracks = useMemo<ArtistTrack[]>(() => {
    const workspace = getCachedArtistWorkspace(library, metadataMap);
    if (isUnassignedArtist) return getUnassignedTracks(workspace.inputs);
    return getArtistTracks(workspace.index, artistKey);
  }, [library, metadataMap, artistKey, isUnassignedArtist]);

  /** Geçmiş satırlarını cihazdaki dosyaya eşlemek için kimlik/URL tablosu. */
  const assetLookup = useMemo(() => {
    const byId = new Map<string, (typeof library)[number]>();
    const byUri = new Map<string, (typeof library)[number]>();
    for (const asset of library) {
      byId.set(asset.id, asset);
      if (asset.uri) byUri.set(asset.uri, asset);
    }
    return { byId, byUri };
  }, [library]);

  /**
   * İstatistikler artık SQL'de ön süzülür: yalnızca bu sanatçının satırları
   * çekilir. Önceden tüm geçmiş (`SELECT *`) köprüden geçip JS'te süzülüyordu;
   * "Tüm Zamanlar" seçiliyken on binlerce satırda bu, ekranı saniyelerce
   * kilitliyordu.
   */
  const loadProfile = useCallback(
    async (nextPeriod: WrappedPeriod) => {
      // Dönem hızlıca değiştirilirse eski isteğin sonucu yenisini ezmesin.
      const requestId = ++requestRef.current;
      const key = `${artistKey}|${nextPeriod}`;
      try {
        const range = resolveWrappedWindow(nextPeriod, Date.now());
        const cleaned: PlayHistoryItem[] = [];
        let historyTracks: ArtistTrack[] | null = null;

        if (isUnassignedArtist) {
          // Sanatçısı boş parçalar tek grup altında toplanır; sayılar
          // istatistik ekranındaki boş etiketli "sanatçı" ile birebir aynıdır.
          const rows = await getHistoryInRangeForUnassignedArtist(
            range.startSql,
            range.endSql
          );
          const historyEntries: ArtistTrack[] = [];
          const seen = new Set<string>();

          for (const row of rows) {
            const fields = cleanTrackFields(row.title, row.artist);
            cleaned.push({ ...row, title: fields.title || row.title, artist: '' });

            const id = String(row.track_id ?? '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);

            const asset = assetLookup.byId.get(id) ?? assetLookup.byUri.get(id);
            const info = asset ? resolveLibraryInfo(asset, metadataMap) : null;
            const assetMeta = asset ? metadataMap[asset.id] ?? metadataMap[asset.uri] : undefined;
            historyEntries.push({
              id,
              uri: asset?.uri || id,
              title: info?.title || fields.title || row.title || '',
              artist: info?.artist || '',
              album: assetMeta?.album || undefined,
              artwork: row.artwork || assetMeta?.artwork || undefined,
              duration: asset?.duration || 0,
            });
          }
          historyTracks = historyEntries;
        } else {
          const names = [
            artistName,
            ...collectArtistNameVariants(artistTracks, artistKey),
          ].filter(Boolean);

          const rows = await getHistoryInRangeForArtists(range.startSql, range.endSql, names);

          // SQL ön süzmesi alt dize eşleşmesidir; kesin eşleşme JS'te doğrulanır.
          for (const row of rows) {
            const matches = artistNamesFromRow(row.artist).some(
              (name) => normalizeArtistKey(name) === artistKey
            );
            if (!matches) continue;

            /*
             * Geçmiş satırı, dosyanın **şu anki** sanatçısıyla çelişebilir:
             * kullanıcı parçanın sanatçısını sonradan değiştirmişse (ve geçmiş
             * güncellemesi o satıra ulaşamamışsa) parça hâlâ eski sanatçının
             * sayfasında "hayalet" olarak görünüyordu — kapağı ve süresi yok,
             * "Cihazda yok" yazıyor ama dosya cihazda olduğu için çalıyordu.
             * Dosya bulunuyorsa ve sanatçısı artık bu sayfaya ait değilse satır
             * atlanır. Sanatçı bilgisi boşsa eski kayda güvenilir (parça hâlâ
             * düzeltilmemiş olabilir).
             */
            const id = String(row.track_id ?? '').trim();
            const asset = id ? assetLookup.byId.get(id) ?? assetLookup.byUri.get(id) : undefined;
            if (asset) {
              const currentKeys = artistNamesFromRow(
                resolveLibraryInfo(asset, metadataMap).artist
              )
                .map((name) => normalizeArtistKey(name))
                .filter(Boolean);
              if (currentKeys.length > 0 && !currentKeys.includes(artistKey)) continue;
            }

            const fields = cleanTrackFields(row.title, row.artist);
            cleaned.push({ ...row, title: fields.title || row.title, artist: fields.artist });
          }
        }

        if (!mountedRef.current || requestId !== requestRef.current) return;
        if (historyTracks) setUnassignedHistoryState({ key, tracks: historyTracks });
        setProfileState({
          key: artistKey,
          value: buildArtistProfileFromRows(cleaned, artistKey, { limit: TOP_TRACK_COUNT }),
        });
      } catch (e) {
        console.warn('Artist stats fetch error:', e);
        if (mountedRef.current && requestId === requestRef.current) {
          setProfileState({ key: artistKey, value: buildArtistProfileFromRows([], artistKey) });
        }
      } finally {
        if (mountedRef.current && requestId === requestRef.current) setLoadedKey(key);
      }
    },
    [artistKey, artistName, artistTracks, isUnassignedArtist, assetLookup, metadataMap]
  );

  useEffect(() => {
    void loadProfile(period);
  }, [period, loadProfile, statsRevision]);

  /**
   * Fotoğraf: sanatçı sayfası açılır açılmaz (istatistiklerden bağımsız)
   * yüklenir. Kütüphanedeki parça adları ipucu olarak verilir ki Deezer'da
   * aynı adı taşıyan yanlış sanatçı seçilmesin.
   */
  useEffect(() => {
    let cancelled = false;
    if (!artistName || isUnassignedArtist) return;
    const titles = artistTracks.slice(0, 12).map((track) => track.title).filter(Boolean);
    void loadArtistImages([artistName], { [artistKey]: titles })
      .then((images) => {
        if (!cancelled) setArtistImageState({ key: artistKey, uri: images[artistKey] || null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artistName, artistKey, artistTracks, isUnassignedArtist]);

  const sortedTracks = useMemo(() => {
    const playCounts = profile?.playCounts ?? new Map<string, number>();
    if (!isUnassignedArtist) return sortTracksByPlays(artistTracks, playCounts);

    /*
     * Kütüphanede sanatçısı boş olanlar + geçmişte sanatçısız kalmış parçalar.
     * Aynı parça iki kaynakta da varsa kütüphane girdisi esas alınır (dosya
     * yolu ve albüm bilgisi oradan gelir), geçmişten yalnızca eksik alanlar
     * tamamlanır.
     */
    const merged = new Map<string, ArtistTrack>();
    for (const track of unassignedHistoryTracks) merged.set(track.id, track);
    for (const track of artistTracks) {
      const previous = merged.get(track.id);
      merged.set(track.id, {
        ...previous,
        ...track,
        uri: track.uri || previous?.uri || '',
        title: track.title || previous?.title || '',
        album: track.album || previous?.album,
        artwork: track.artwork || previous?.artwork,
        duration: track.duration || previous?.duration || 0,
      });
    }
    return sortTracksByPlays([...merged.values()], playCounts);
  }, [artistTracks, profile, isUnassignedArtist, unassignedHistoryTracks]);

  /** Başlıkta gösterilecek isim: geçmiş → kütüphane → ham parametre. */
  const displayName = useMemo(() => {
    // Yeniden adlandırma sonucu yalnızca hâlâ bu sanatçıya aitse geçerlidir;
    // başka bir sanatçıya geçildiğinde eski isim başlığa sızmaz.
    if (renamedTo && normalizeArtistKey(renamedTo) === artistKey) return renamedTo;
    if (profile?.displayName) return profile.displayName;
    for (const track of artistTracks) {
      const match = artistNamesFromRow(track.artist).find(
        (part) => normalizeArtistKey(part) === artistKey
      );
      if (match?.trim()) return match.trim();
    }
    return artistName;
  }, [renamedTo, profile, artistTracks, artistKey, artistName]);

  const stats = profile?.stats;
  const artistHistoryCount = stats?.totalPlays ?? 0;

  /**
   * Sanatçı adını değiştirir / birleştirir.
   *
   * 1. Kütüphanedeki tüm eşleşen parçaların `metadataMap` sanatçı alanı yeni
   *    ada çevrilir (ortak çalışmalardaki diğer isimler korunur).
   * 2. Geçmiş (istatistik) satırları SQLite'ta aynı kuralla güncellenir.
   * 3. Ekran yeni ada geçer; aynı adda sanatçı varsa indeks ikisini tek
   *    grupta topladığı için birleşme kendiliğinden olur.
   */
  const handleRenameArtist = useCallback(
    async (nextName: string) => {
      const trimmed = (nextName ?? '').trim();
      if (!trimmed || renaming || isUnassignedArtist) return;
      const replacement = cleanArtistName(trimmed) || trimmed;
      if (normalizeArtistKey(replacement) === artistKey) {
        setRenameOpen(false);
        return;
      }

      setRenaming(true);
      try {
        const store = useStore.getState();
        const currentMetadata = store.metadataMap;
        const index = getCachedArtistIndex(store.library, currentMetadata);
        const targetIds = new Set(getArtistTracks(index, artistKey).map((track) => track.id));

        const batch: Record<string, TrackMetadata> = {};
        for (const asset of store.library) {
          const metaKey = currentMetadata[asset.id]
            ? asset.id
            : currentMetadata[asset.uri]
              ? asset.uri
              : asset.id;
          const existing = currentMetadata[metaKey] ?? {};
          const info = resolveLibraryInfo(asset, currentMetadata);
          const matches =
            targetIds.has(asset.id) ||
            artistNamesFromRow(info.artist).some(
              (name) => normalizeArtistKey(name) === artistKey
            );
          if (!matches) continue;

          const nextArtist = renameArtistInField(info.artist, displayName, replacement);
          if (nextArtist == null) continue;

          batch[metaKey] = {
            ...existing,
            // Başlık metadata'da yoksa görünen (temizlenmiş) başlık sabitlenir;
            // aksi halde yeniden adlandırma sonrası isim kaybolabiliyordu.
            title: existing.title || info.title || undefined,
            artist: nextArtist,
          };
        }

        if (Object.keys(batch).length > 0) {
          useStore.getState().setBatchTrackMetadata(batch);
        }
        await renameArtistInHistory(displayName, replacement);
        // Artist image cache is keyed by name; the new name loads its own photo.
        setArtistImageState(null);
        setRenamedTo(replacement);
        setRenameOpen(false);
        router.setParams({ name: replacement });
        Alert.alert(t('artist.rename_title'), t('artist.rename_done'));
      } catch (error) {
        console.warn('Artist rename failed:', error);
        Alert.alert(t('artist.rename_title'), t('artist.rename_failed'));
      } finally {
        setRenaming(false);
      }
    },
    [artistKey, displayName, renaming, router, t, isUnassignedArtist]
  );

  const queueFrom = useCallback(
    (tracks: ArtistTrack[], startId: string, shuffle = false) =>
      startPlaybackFromLibrary({
        tracks: tracks.map((track) => ({
          id: track.id,
          url: track.uri,
          title: track.title,
          artist: track.artist,
          artwork: track.artwork || undefined,
          duration: track.duration,
        })),
        startId,
        shuffle,
      }),
    []
  );
  /**
   * Cihazdaki dosyalarla eşleşen oynatılabilir kuyruk.
   *
   * NEDEN: sanatçı listesi geçmişten gelen kayıtları da taşıyabiliyor (dosya
   * silinmiş, yeniden adlandırılmış ya da taşınmış olabilir). Kuyruk doğrudan bu
   * listeden kurulduğunda `TrackPlayer.setQueue` geçersiz bir URL yüzünden
   * reddediliyor, hata yutulduğu için de dokunuş "hiçbir şey yapmıyor" gibi
   * görünüyordu. Artık kuyruğa yalnızca gerçek dosyası olan parçalar giriyor.
   */
  const playableTracks = useMemo<ArtistTrack[]>(() => {
    // Tarama henüz bitmediyse `allAssets` boş olabilir; o durumda kütüphane
    // listesi aynı varlıkları taşır.
    const sourceAssets = allAssets.length > 0 ? allAssets : library;
    const byId = new Map<string, (typeof allAssets)[number]>();
    const byUri = new Map<string, (typeof allAssets)[number]>();
    for (const asset of sourceAssets) {
      byId.set(asset.id, asset);
      if (asset.uri) byUri.set(asset.uri, asset);
    }

    const result: ArtistTrack[] = [];
    const seen = new Set<string>();
    for (const track of sortedTracks) {
      const asset = byId.get(track.id) ?? (track.uri ? byUri.get(track.uri) : undefined);
      if (!asset?.uri || seen.has(asset.id)) continue;
      seen.add(asset.id);
      result.push({
        ...track,
        id: asset.id,
        uri: asset.uri,
        duration: asset.duration || track.duration,
      });
    }
    return result;
  }, [sortedTracks, allAssets, library]);

  /** Satır başına arama maliyetini önlemek için oynatılabilir anahtarlar. */
  const playableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const track of playableTracks) {
      keys.add(track.id);
      if (track.uri) keys.add(track.uri);
    }
    return keys;
  }, [playableTracks]);

  const isPlayableTrack = useCallback(
    (track: { id: string; uri: string }) =>
      playableKeys.has(track.id) || (track.uri ? playableKeys.has(track.uri) : false),
    [playableKeys]
  );

  const playableById = useMemo(
    () => new Map(playableTracks.map((track) => [track.id, track])),
    [playableTracks]
  );

  /** Geçmişteki bir kimliği/URL'i cihazdaki dosyayla eşler. */
  const resolvePlayable = useCallback(
    (idOrUri: string): ArtistTrack | null => {
      if (!idOrUri) return null;
      const direct = playableById.get(idOrUri);
      if (direct) return direct;
      const byUri = playableTracks.find((track) => track.uri === idOrUri);
      if (byUri) return byUri;
      const asset =
        allAssets.find((candidate) => candidate.id === idOrUri) ??
        allAssets.find((candidate) => candidate.uri === idOrUri);
      if (!asset?.uri) return null;
      const existing = playableById.get(asset.id);
      if (existing) return existing;
      // Dosya cihazda var ama sanatçı listesine girmemiş (ör. geçmişte başka
      // yazımla kaydedilmiş): doğrudan varlıktan oynatılabilir kayıt üretilir.
      const info = resolveLibraryInfo(asset, metadataMap);
      return {
        id: asset.id,
        uri: asset.uri,
        title: info.title,
        artist: info.artist,
        album: metadataMap[asset.id]?.album || undefined,
        artwork: metadataMap[asset.id]?.artwork || undefined,
        duration: asset.duration || 0,
      };
    },
    [playableById, playableTracks, allAssets, metadataMap]
  );

  const missingTrackAlert = useCallback(() => {
    Alert.alert(t('artist.track_unavailable_title'), t('artist.track_unavailable'));
  }, [t]);

  const startPlayback = useCallback(
    async (shuffle: boolean) => {
      if (playableTracks.length === 0) {
        missingTrackAlert();
        return;
      }
      try {
        await queueFrom(playableTracks, playableTracks[0].id, shuffle);
        // Kütüphane ekranındaki davranışla aynı: çalma başlayınca tam ekran
        // oynatıcı açılır. Bu olmadan ses başlasa bile sayfada görünür bir
        // değişiklik olmuyor ve dokunuş "hiçbir şey yapmıyor" gibi algılanıyordu.
        openFullscreenPlayer();
      } catch (e) {
        console.warn('Failed to play artist queue:', e);
        missingTrackAlert();
      }
    },
    [playableTracks, queueFrom, missingTrackAlert, openFullscreenPlayer]
  );

  /**
   * Tek parçayı çalar.
   *
   * Kuyruk, seçilen parçadan başlayacak şekilde cihazdaki parçalarla kurulur;
   * seçilen parça cihazda yoksa sessizce hiçbir şey yapmak yerine kullanıcıya
   * sebep gösterilir.
   */
  const playTrack = useCallback(
    async (track: ArtistTrack) => {
      const target = resolvePlayable(track.id) ?? resolvePlayable(track.uri);
      if (!target) {
        missingTrackAlert();
        return;
      }
      try {
        const queue = playableTracks.some((item) => item.id === target.id)
          ? playableTracks
          : [...playableTracks, target];
        await queueFrom(queue, target.id);
        openFullscreenPlayer();
      } catch (e) {
        console.warn('Failed to play artist track:', e);
        missingTrackAlert();
      }
    },
    [playableTracks, queueFrom, resolvePlayable, missingTrackAlert, openFullscreenPlayer]
  );

  /** Sanatçısı boş parçayı düzenleme modalında açar. */
  const editTrack = useCallback((track: ArtistTrack) => {
    setTrackToEdit({
      id: track.id,
      uri: track.uri,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork ?? null,
    });
  }, []);

  const formatDay = (ms: number | null) => {
    if (!ms) return t('artist.never');
    return new Date(ms).toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const topTracks = stats?.topTracks ?? [];

  const summaryTiles = [
    {
      key: 'plays',
      icon: 'play-circle-outline' as const,
      value: String(stats?.totalPlays ?? 0),
      label: t('wrapped.total_plays'),
    },
    {
      key: 'time',
      icon: 'time-outline' as const,
      value: formatWrappedDuration(stats?.totalSeconds ?? 0, durationLabels),
      label: t('wrapped.total_time'),
    },
    {
      key: 'tracks',
      icon: 'musical-notes-outline' as const,
      value: String(stats?.uniqueTracks ?? 0),
      label: t('wrapped.total_tracks'),
    },
    {
      key: 'days',
      icon: 'calendar-outline' as const,
      value: String(stats?.activeDays ?? 0),
      label: t('wrapped.streak_active'),
    },
  ];

  const habitRows: { label: string; value: string }[] = [
    { label: t('artist.first_play'), value: formatDay(stats?.firstPlayAt ?? null) },
    { label: t('artist.last_play'), value: formatDay(stats?.lastPlayAt ?? null) },
  ];
  if (stats?.busiestHour != null) {
    habitRows.push({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: stats.busiestHour }),
    });
  }
  if (stats?.longestStreak) {
    habitRows.push({
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: stats.longestStreak }),
    });
  }

  const header = (
    <View>
      {/* ── Sanatçı kartı: uygulamanın kart dilinde, tema rengiyle ── */}
      <View style={[styles.heroCard, { borderColor: `${theme.primary}44` }]}>
        {/* Tema renginden koyu karta akan yüzey; düz #18181b yerine derinlik. */}
        <GradientSurface
          pointerEvents="none"
          colors={[withAlpha(theme.primary, 0.3), withAlpha(theme.primary, 0.04), '#18181b']}
          locations={[0, 0.55, 1]}
          direction="diagonal"
          borderRadius={20}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.heroGlow, { backgroundColor: theme.glowColor }]} />
        {artistImage ? (
          <Image source={{ uri: artistImage }} style={styles.heroPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.heroPhoto, { backgroundColor: `${theme.primary}26` }]}>
            <Text style={[styles.heroPhotoText, { color: theme.primary }]}>{initial}</Text>
          </View>
        )}
        <Text style={styles.heroName} numberOfLines={2}>
          {displayName || t('common.unknown_artist')}
        </Text>
        <Text style={styles.heroMeta}>
          {t('artist.songs_count', { count: artistTracks.length })}
          {artistHistoryCount > 0 ? ` · ${t('artist.plays_total', { count: artistHistoryCount })}` : ''}
        </Text>
      </View>

      {/* ── Çal / Karıştır ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[
            styles.playButton,
            { backgroundColor: playableTracks.length > 0 ? theme.primary : '#27272a' },
          ]}
          activeOpacity={0.85}
          disabled={playableTracks.length === 0}
          onPress={() => void startPlayback(false)}>
          <Ionicons name="play" size={18} color="#ffffff" />
          <Text style={styles.playButtonText}>{t('artist.play')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.shuffleButton, { borderColor: `${theme.primary}88` }]}
          activeOpacity={0.85}
          disabled={playableTracks.length === 0}
          onPress={() => void startPlayback(true)}>
          <Ionicons name="shuffle" size={18} color={theme.primary} />
          <Text style={[styles.shuffleButtonText, { color: theme.primary }]}>
            {t('artist.shuffle')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Dönem ── */}
      <Text style={styles.sectionLabel}>{t('stats.period_label')}</Text>
      <View style={styles.periodRow}>
        {PERIODS.map((item) => {
          const active = period === item;
          const labelKey =
            item === 'year'
              ? 'wrapped.period_year'
              : item === 'last12m'
                ? 'wrapped.period_last12m'
                : 'wrapped.period_all';
          return (
            <TouchableOpacity
              key={item}
              style={[
                styles.periodChip,
                active && { backgroundColor: `${theme.primary}26`, borderColor: theme.primary },
              ]}
              onPress={() => setPeriod(item)}
              activeOpacity={0.8}>
              <Text
                style={[styles.periodChipText, active && { color: theme.primary, fontWeight: '700' }]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      ) : artistHistoryCount === 0 ? (
        <Text style={styles.emptyText}>{t('artist.no_stats')}</Text>
      ) : (
        <>
          {/* Özet kartları */}
          <View style={styles.summaryGrid}>
            {summaryTiles.map((tile) => (
              <View key={tile.key} style={styles.summaryTile}>
                <Ionicons name={tile.icon} size={18} color={theme.primary} />
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                  {tile.value}
                </Text>
                <Text style={styles.summaryLabel} numberOfLines={1}>
                  {tile.label}
                </Text>
              </View>
            ))}
          </View>

          {/* Alışkanlıklar */}
          <View style={[styles.habitCard, { borderColor: `${theme.primary}33` }]}>
            {habitRows.map((row) => (
              <View key={row.label} style={styles.habitRow}>
                <Text style={styles.habitLabel}>{row.label}</Text>
                <Text style={styles.habitValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          {/* En çok dinlediklerin */}
          {topTracks.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('artist.top_tracks')}</Text>
              {topTracks.map((item, index) => {
                // `resolvePlayable` cihazdaki dosyayı bulur; bulduysa parça
                // gerçekten oynatılabilir (ana liste kapsamı dışında kalmış
                // olabilir, ör. sanatçısı sonradan düzenlenmiş kayıtlar).
                const resolved = resolvePlayable(item.key);
                const match =
                  resolved ??
                  sortedTracks.find(
                    (track) => track.id === item.key || track.uri === item.key
                  );
                const playable = resolved ? true : match ? isPlayableTrack(match) : false;
                return (
                  <TouchableOpacity
                    key={`top-${item.key}`}
                    style={styles.row}
                    activeOpacity={0.75}
                    onPress={() => {
                      // Parça cihazda yoksa dokunuş sessizce yutulmaz; sebep gösterilir.
                      if (!match) {
                        missingTrackAlert();
                        return;
                      }
                      if (isUnassignedArtist && !playable) editTrack(match);
                      else void playTrack(match);
                    }}>
                    <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>
                      {index + 1}
                    </Text>
                    {item.artwork ? (
                      <Image source={{ uri: item.artwork }} style={styles.rankArtwork} contentFit="cover" />
                    ) : (
                      <View style={[styles.rankArtwork, styles.rankArtworkFallback]}>
                        <Ionicons name="musical-note" size={16} color="#71717a" />
                      </View>
                    )}
                    <View style={styles.rowInfo}>
                      <Text
                        style={[styles.rowTitle, !playable && styles.rowTitleMuted]}
                        numberOfLines={1}>
                        {item.label || '—'}
                      </Text>
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {playable
                          ? formatWrappedDuration(item.seconds, durationLabels)
                          : t('artist.not_on_device')}
                      </Text>
                    </View>
                    <Text style={[styles.rowRight, { color: theme.primary }]}>
                      {item.plays} {t('stats.plays_suffix')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </>
      )}

      {isUnassignedArtist ? (
        <View
          style={[
            styles.hintCard,
            { borderColor: `${theme.primary}44`, backgroundColor: `${theme.primary}12` },
          ]}>
          <Ionicons name="pencil-outline" size={16} color={theme.primary} />
          <Text style={styles.hintText}>{t('artist.unassigned_hint')}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>
        {t('artist.songs')}
        {artistTracks.length > 0 ? ` (${artistTracks.length})` : ''}
      </Text>
    </View>
  );

  const renderTrack = ({ item }: { item: ArtistTrack }) => {
    const isCurrent =
      activeTrack != null && (activeTrack.id === item.id || activeTrack.url === item.uri);
    const plays =
      profile?.playCounts.get(item.id) ?? (item.uri ? profile?.playCounts.get(item.uri) : 0) ?? 0;
    const playable = isPlayableTrack(item);
    return (
      <TouchableOpacity
        style={[
          styles.trackCard,
          isCurrent && { borderColor: `${theme.primary}66`, backgroundColor: `${theme.primary}14` },
        ]}
        activeOpacity={0.75}
        onPress={() => {
          // Sanatçısı boş parçalarda amaç genelde kaydı düzeltmek; ancak dosya
          // cihazda varsa dokunuş yine de çalar. Düzenleme uzun basışta ve
          // kalem rozetinde.
          if (isUnassignedArtist && !playable) editTrack(item);
          else void playTrack(item);
        }}
        onLongPress={() => editTrack(item)}>
        <TrackArtwork
          uri={item.artwork || metadataMap[item.id]?.artwork || artworkMap[item.id]}
          trackId={item.id}
          trackUri={item.uri}
          size={46}
          borderRadius={8}
          iconSize={20}
        />
        <View style={styles.rowInfo}>
          <Text
            style={[
              styles.rowTitle,
              isCurrent && { color: theme.primary },
              !playable && styles.rowTitleMuted,
            ]}
            numberOfLines={1}>
            {item.title || t('common.unknown_track')}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {!playable
              ? t('artist.not_on_device')
              : `${item.album ? `${item.album} · ` : ''}${
                  plays > 0 ? t('artist.plays_total', { count: plays }) : t('artist.not_played')
                }`}
          </Text>
        </View>
        {isUnassignedArtist ? (
          <TouchableOpacity
            style={[styles.editBadge, { backgroundColor: `${theme.primary}26` }]}
            accessibilityRole="button"
            accessibilityLabel={t('artist.rename')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => editTrack(item)}>
            <Ionicons name="pencil" size={16} color={theme.primary} />
          </TouchableOpacity>
        ) : isCurrent ? (
          <Ionicons name="volume-medium" size={18} color={theme.primary} />
        ) : (
          <Text style={styles.trackDuration}>{formatTrackDuration(item.duration)}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/statistics'))}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('artist.title')}
        </Text>
        {!isUnassignedArtist ? (
          <TouchableOpacity
            style={styles.renameBtn}
            onPress={() => setRenameOpen(true)}
            disabled={renaming}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('artist.rename')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="pencil" size={18} color={theme.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ArtistRenameModal
        visible={renameOpen}
        initialValue={displayName || artistName}
        onCancel={() => setRenameOpen(false)}
        onSubmit={(name) => void handleRenameArtist(name)}
      />

      <EditTrackModal
        visible={trackToEdit != null}
        track={trackToEdit}
        onClose={() => setTrackToEdit(null)}
        onSaved={() => setStatsRevision((value) => value + 1)}
      />

      <FlashList
        // Sanatçı değişince liste baştan kurulur: kaydırma konumu ve eski
        // satırlar yeni sanatçıya taşınmaz.
        key={artistKey}
        data={sortedTracks}
        keyExtractor={(item) => `artist-track-${item.id}`}
        renderItem={renderTrack}
        style={{ flex: 1 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { paddingHorizontal: 16 }]}>{t('artist.no_songs')}</Text>
        }
        ListFooterComponent={
          <View style={{ paddingBottom: insets.bottom + 110 }}>
            <AdBanner style={{ marginTop: 12 }} />
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  renameBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },

  // ── Sanatçı kartı ───────────────────────────────────────────────────────
  heroCard: {
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 190,
    height: 190,
    borderRadius: 95,
    opacity: 0.5,
  },
  heroPhoto: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
  },
  heroPhotoText: {
    fontSize: 42,
    fontWeight: '800',
  },
  heroName: {
    marginTop: 14,
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  heroMeta: {
    marginTop: 5,
    fontSize: 13,
    color: '#a1a1aa',
    textAlign: 'center',
  },

  // ── Eylemler ────────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  playButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 999,
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  shuffleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#18181b',
  },
  shuffleButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Dönem ───────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
    alignItems: 'center',
  },
  periodChipText: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '600',
  },

  // ── Özet / alışkanlık ───────────────────────────────────────────────────
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 13,
    paddingHorizontal: 12,
    gap: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#a1a1aa',
  },
  habitCard: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 18,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 10,
  },
  habitLabel: {
    fontSize: 12,
    color: '#71717a',
  },
  habitValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    flexShrink: 1,
    textAlign: 'right',
  },

  // ── Listeler ────────────────────────────────────────────────────────────
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#18181b',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 10,
  },
  rankIndex: {
    width: 16,
    fontSize: 12,
    fontWeight: '800',
    color: '#52525b',
    textAlign: 'center',
  },
  rankArtwork: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  rankArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 3,
  },
  /** Cihazda bulunmayan (geçmişten kalan) parçalar soluk gösterilir. */
  rowTitleMuted: {
    color: '#a1a1aa',
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  rowRight: {
    fontSize: 12,
    fontWeight: '700',
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 12,
  },
  trackDuration: {
    fontSize: 12,
    color: '#71717a',
    fontVariant: ['tabular-nums'],
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#d4d4d8',
  },
  editBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 12,
  },
});

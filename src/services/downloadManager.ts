import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useDownloadStore } from '../store/useDownloadStore';
import { useStore } from '../store/useStore';
import { saveCachedLibrary } from './libraryStorage';
import { t } from './i18n';
import type { DownloadTask } from '../types/download';

const activeDownloads = new Map<string, FileSystem.DownloadResumable>();
const libraryAdditions = new Map<string, Promise<boolean>>();

/**
 * Incremental library updates must start from `allAssets`; `library` only
 * contains visible tracks and using it would silently drop hidden entries.
 */
function getAllLibraryAssets(): MediaLibrary.Asset[] {
  const { allAssets, library } = useStore.getState();
  return allAssets.length > 0 ? allAssets : library;
}

function isTaskCancelled(taskId: string): boolean {
  return useDownloadStore.getState().tasks.find((t) => t.id === taskId)?.status === 'cancelled';
}

function buildDownloadAsset(task: DownloadTask): MediaLibrary.Asset {
  return {
    id: task.mediaLibraryAssetId || `local_${task.id}`,
    filename: task.fileName || `${task.title || 'audio'}.mp3`,
    uri: task.localFileUri!,
    mediaType: 'audio' as any,
    width: 0,
    height: 0,
    creationTime: task.createdAt || Date.now(),
    modificationTime: task.completedAt || task.createdAt || Date.now(),
    duration: task.duration || 0,
  };
}

function isAssetForDownload(asset: MediaLibrary.Asset, task: DownloadTask): boolean {
  return (
    asset.id === (task.mediaLibraryAssetId || `local_${task.id}`) ||
    asset.uri === task.localFileUri
  );
}

/**
 * Bir medya taraması sürerken tamamlanan indirmeler taramanın başlangıç
 * anlık görüntüsünde yer almaz. Tarama sonucu yazılmadan hemen önce bu
 * yardımcı çağrılır; tamamlanan indirmeleri güncel store'dan okuyup listeye
 * ekler. Böylece indirme, tarama tarafından sessizce ezilmez.
 *
 * `completedAfter`: bu andan sonra tamamlanan görevler, tarama sonucunda
 * henüz görünmeseler bile iyimser biçimde eklenir. Eski ve dosyası silinmiş
 * görevlerin hayalet kayıt olarak geri gelmesini önler.
 */
export function mergeCompletedDownloadsIntoAssets(
  assets: MediaLibrary.Asset[],
  options?: { completedAfter?: number }
): MediaLibrary.Asset[] {
  const completedTasks = useDownloadStore
    .getState()
    .tasks.filter((t) => t.status === 'completed' && t.localFileUri);
  if (completedTasks.length === 0) return assets;

  const currentAssets = getAllLibraryAssets();
  const cutoff = options?.completedAfter;

  const assetIds = new Set(assets.map((asset) => asset.id));
  const assetUris = new Set(assets.map((asset) => asset.uri));

  const isKnownInScannedAssets = (task: DownloadTask): boolean => {
    const assetId = task.mediaLibraryAssetId || `local_${task.id}`;
    return (
      assetIds.has(assetId) ||
      assetIds.has(`local_${task.id}`) ||
      assetUris.has(task.localFileUri!)
    );
  };

  const relevantTasks = completedTasks.filter((task) => {
    // Tarama sürerken tamamlanan görevler henüz taranmamış olabilir; onları
    // iyimser biçimde ekle. Daha eski görevler yalnızca tarama sonucunda
    // doğrulanmış bir varlıkları varsa korunur; böylece cache'te kalmış,
    // dosyası silinmiş hayalet kayıtlar geri getirilmez.
    if (cutoff != null && (task.completedAt || 0) >= cutoff) return true;
    return isKnownInScannedAssets(task);
  });
  if (relevantTasks.length === 0) return assets;

  const downloadAssetIds = new Set<string>();
  const downloadUris = new Set<string>();
  for (const task of relevantTasks) {
    downloadAssetIds.add(task.mediaLibraryAssetId || `local_${task.id}`);
    downloadAssetIds.add(`local_${task.id}`);
    if (task.localFileUri) downloadUris.add(task.localFileUri);
  }

  const candidates = [...assets, ...currentAssets];
  const downloadAssets: MediaLibrary.Asset[] = [];
  const seenIds = new Set<string>();
  const seenUris = new Set<string>();

  for (const task of relevantTasks) {
    const existing =
      (task.mediaLibraryAssetId
        ? candidates.find((asset) => asset.id === task.mediaLibraryAssetId)
        : undefined) || candidates.find((asset) => isAssetForDownload(asset, task));
    const asset = existing || buildDownloadAsset(task);

    if (seenIds.has(asset.id) || seenUris.has(asset.uri)) continue;
    seenIds.add(asset.id);
    seenUris.add(asset.uri);
    downloadAssets.push(asset);
  }

  const remaining = assets.filter(
    (asset) => !downloadAssetIds.has(asset.id) && !downloadUris.has(asset.uri)
  );
  return [...downloadAssets, ...remaining];
}

function sanitizeFileName(name: string): string {
  // `#` ve `%` dosya sisteminde geçerli olsa da `file://` URI'larında fragment
  // veya yüzde-kod çözümleme karakteri olarak yorumlanır. İndirme hedefi
  // URI'sinin (ve MediaStore'a aktarımın) bozulmaması için baştan temizle.
  return name.replace(/[<>:"/\\|?*#%\x00-\x1F]/g, '_').trim();
}

export interface StartDownloadParams {
  title: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  downloadUrl: string;
  suggestedFileName?: string;
  storageTarget?: 'public' | 'private';
  sourceExtensionId?: string;
}

/**
 * Evrensel İndirme Başlatıcı:
 * Eklentilerden veya uygulama içinden çağrılan ses indirmelerini yönetir.
 */
export async function startDownload(params: StartDownloadParams): Promise<{ downloadId: string }> {
  const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const store = useDownloadStore.getState();

  const title = (params.title || 'Unknown Title').trim();
  const artist = (params.artist || 'Unknown Artist').trim();

  // Dosya uzantısını belirle (.mp3 varsayılan)
  let ext = '.mp3';
  if (params.suggestedFileName && params.suggestedFileName.includes('.')) {
    const rawExt = params.suggestedFileName.substring(params.suggestedFileName.lastIndexOf('.')).toLowerCase();
    // Kullanıcı talebi: mp4 olarak indirilen hızlı akışlar doğrudan .mp3 uzantısıyla saklanır
    if (rawExt === '.mp4') {
      ext = '.mp3';
    } else if (['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg'].includes(rawExt)) {
      ext = rawExt;
    }
  } else if (params.downloadUrl.includes('.m4a')) {
    ext = '.m4a';
  }

  const baseName = sanitizeFileName(params.suggestedFileName?.replace(/\.[^/.]+$/, '') || `${artist} - ${title}`);
  const finalFileName = `${baseName}${ext}`;

  // Hedef depolama: parametre verilmemişse varsayılan depolama hedefini kullan
  const defaultTarget = store.defaultStorageTarget || 'public';
  const target: 'public' | 'private' = params.storageTarget
    ? (params.storageTarget === 'public' ? 'public' : 'private')
    : (defaultTarget === 'public' ? 'public' : 'private');

  const downloadDir = `${FileSystem.documentDirectory || ''}downloads/`;
  const localFileUri = `${downloadDir}${downloadId}_${finalFileName}`;

  const task: DownloadTask = {
    id: downloadId,
    title,
    artist,
    artwork: params.artwork,
    duration: params.duration,
    downloadUrl: params.downloadUrl,
    fileName: finalFileName,
    localFileUri,
    status: 'downloading',
    progress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    createdAt: Date.now(),
    sourceExtensionId: params.sourceExtensionId,
    storageTarget: target,
  };

  store.addTask(task);

  // Arka planda indirmeyi başlat
  executeDownload(task).catch((err) => {
    console.warn('[downloadManager] İndirme yürütme hatası:', err);
  });

  return { downloadId };
}

async function executeDownload(task: DownloadTask): Promise<void> {
  const downloadDir = `${FileSystem.documentDirectory || ''}downloads/`;

  if (isTaskCancelled(task.id)) return;

  try {
    const dirInfo = await FileSystem.getInfoAsync(downloadDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });
    }

    let lastUpdate = 0;
    let lastProgress = 0;

    const callback = (downloadProgress: FileSystem.DownloadProgressData) => {
      const progress = downloadProgress.totalBytesExpectedToWrite > 0
        ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
        : 0;

      const now = Date.now();
      if (now - lastUpdate > 250 || Math.abs(progress - lastProgress) >= 0.01 || progress === 1) {
        lastUpdate = now;
        lastProgress = progress;
        useDownloadStore.getState().updateTask(task.id, {
          progress,
          downloadedBytes: downloadProgress.totalBytesWritten,
          totalBytes: downloadProgress.totalBytesExpectedToWrite,
        });
      }
    };

    const downloadResumable = FileSystem.createDownloadResumable(
      task.downloadUrl,
      task.localFileUri!,
      {},
      callback
    );

    activeDownloads.set(task.id, downloadResumable);

    const result = await downloadResumable.downloadAsync();
    activeDownloads.delete(task.id);

    if (!result || !result.uri) {
      throw new Error(t('downloads.download_failed'));
    }

    // Cancellation can land while downloadAsync() is resolving. Do not let a
    // cancelled task continue into MediaLibrary/library updates.
    if (isTaskCancelled(task.id)) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
      return;
    }

    // Kullanıcı deneyimi: mp4 uzantılı indirmeleri doğrudan .mp3 uzantısına taşı
    let finalFileUri = task.localFileUri!;
    let finalFileName = task.fileName;
    if (finalFileUri.toLowerCase().endsWith('.mp4')) {
      const newFileUri = finalFileUri.replace(/\.mp4$/i, '.mp3');
      try {
        await FileSystem.moveAsync({ from: finalFileUri, to: newFileUri });
        finalFileUri = newFileUri;
        finalFileName = finalFileName.replace(/\.mp4$/i, '.mp3');
      } catch (moveErr) {
        console.warn('[downloadManager] mp4 -> mp3 dönüştürme uyarısı:', moveErr);
      }
    }

    let mediaAssetId: string | undefined;

    // Eğer genel müzik kütüphanesine kaydedilmesi istenmişse
    if (task.storageTarget === 'public') {
      try {
        let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
        if (!permission.granted && permission.status !== 'granted' && permission.canAskAgain) {
          permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
        }

        if (permission.granted || permission.status === 'granted') {
          const createdAsset = await MediaLibrary.createAssetAsync(finalFileUri);
          if (createdAsset?.id) {
            mediaAssetId = createdAsset.id;
          }
        }
      } catch (mediaLibErr) {
        console.warn('[downloadManager] MediaLibrary kayıt uyarısı:', mediaLibErr);
      }
    }

    // Another cancellation check after MediaLibrary registration; a cancelled
    // task must not be marked completed or added to the library.
    if (isTaskCancelled(task.id)) {
      if (mediaAssetId) {
        await MediaLibrary.deleteAssetsAsync([mediaAssetId]).catch(() => {});
      }
      await FileSystem.deleteAsync(finalFileUri, { idempotent: true }).catch(() => {});
      return;
    }

    useDownloadStore.getState().updateTask(task.id, {
      status: 'completed',
      progress: 1,
      completedAt: Date.now(),
      mediaLibraryAssetId: mediaAssetId,
      localFileUri: finalFileUri,
      fileName: finalFileName,
    });

    if (!isTaskCancelled(task.id)) {
      let addedToLibrary = false;

      // Genel (public) indirmeler cihazın medya kütüphanesine de kaydedilir.
      // Özel (private) indirmeler burada MediaStore'a taşınmaz.
      if (task.storageTarget === 'public' || mediaAssetId) {
        try {
          addedToLibrary = await addDownloadToLibrary(task.id);
        } catch (e) {
          console.warn('[downloadManager] Otomatik kütüphane ekleme hatası:', e);
        }
      }

      // Public ekleme başarısız olduysa veya indirme private ise, tamamlanan
      // dosyayı kitaplık ekranının odaklanmasını beklemeden RunMusic
      // kütüphanesine yerel kayıt olarak ekle.
      if (!addedToLibrary && !isTaskCancelled(task.id)) {
        await syncCompletedDownloadsWithLibrary().catch((e) => {
          console.warn('[downloadManager] Tamamlanan indirme eşitleme hatası:', e);
        });
      }
    }
  } catch (error: any) {
    activeDownloads.delete(task.id);
    if (isTaskCancelled(task.id)) return;
    const errMsg = error?.message || t('downloads.generic_error');
    useDownloadStore.getState().updateTask(task.id, {
      status: 'failed',
      error: errMsg,
    });
  }
}

/**
 * Devam eden indirmeyi iptal eder.
 */
export async function cancelDownload(downloadId: string): Promise<void> {
  // Mark first so an in-flight download that resolves during cancellation
  // observes the cancelled state and does not resurrect itself.
  useDownloadStore.getState().updateTask(downloadId, {
    status: 'cancelled',
  });

  const resumable = activeDownloads.get(downloadId);
  if (resumable) {
    try {
      await resumable.cancelAsync();
    } catch {
      // ignore
    }
    activeDownloads.delete(downloadId);
  }

  const task = useDownloadStore.getState().tasks.find((t) => t.id === downloadId);
  if (task && task.localFileUri) {
    FileSystem.deleteAsync(task.localFileUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Özel depolamadaki indirilmiş parçayı kullanıcının isteğiyle cihazın genel
 * müzik kütüphanesine (MediaLibrary) aktarır ve RunMusic kütüphanesine ekler.
 *
 * Aynı görev için eşzamanlı çağrılar (otomatik ekleme + kullanıcı butonu)
 * paylaşılır; aksi halde iki ayrı MediaStore varlığı oluşturulabilir.
 */
export function addDownloadToLibrary(downloadId: string): Promise<boolean> {
  const inFlight = libraryAdditions.get(downloadId);
  if (inFlight) return inFlight;

  const promise = addDownloadToLibraryInternal(downloadId).finally(() => {
    if (libraryAdditions.get(downloadId) === promise) {
      libraryAdditions.delete(downloadId);
    }
  });
  libraryAdditions.set(downloadId, promise);
  return promise;
}

async function addDownloadToLibraryInternal(downloadId: string): Promise<boolean> {
  const task = useDownloadStore.getState().tasks.find((t) => t.id === downloadId);
  if (!task || !task.localFileUri) {
    throw new Error(t('downloads.file_not_found'));
  }
  if (task.status === 'cancelled') return false;

  const fileInfo = await FileSystem.getInfoAsync(task.localFileUri);
  if (!fileInfo.exists) {
    throw new Error(t('downloads.local_file_not_found'));
  }

  let targetFileUri = task.localFileUri;
  let targetFileName = task.fileName;

  // Kullanıcı talebi: Eğer dosya .mp4 uzantılıysa, kütüphaneye .mp3 olarak aktar
  if (targetFileUri.toLowerCase().endsWith('.mp4')) {
    const newFileUri = targetFileUri.replace(/\.mp4$/i, '.mp3');
    try {
      await FileSystem.moveAsync({ from: targetFileUri, to: newFileUri });
      targetFileUri = newFileUri;
      targetFileName = targetFileName.replace(/\.mp4$/i, '.mp3');
      useDownloadStore.getState().updateTask(downloadId, {
        localFileUri: targetFileUri,
        fileName: targetFileName,
      });
    } catch (moveErr) {
      console.warn('[downloadManager] mp4 -> mp3 dönüştürme uyarısı:', moveErr);
    }
  }

  let createdAsset: MediaLibrary.Asset | null = null;
  // Eğer daha önce MediaLibrary varlığı oluşturulmadıysa oluştur
  if (!task.mediaLibraryAssetId) {
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!permission.granted && permission.status !== 'granted' && permission.canAskAgain) {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }

      if (permission.granted || permission.status === 'granted') {
        const result = await MediaLibrary.createAssetAsync(targetFileUri);
        if (result && result.id) {
          createdAsset = result;
        }
      }
    } catch (mediaLibErr) {
      console.warn('[downloadManager] MediaLibrary sistem kaydı başarısız, yerel kütüphaneye ekleniyor:', mediaLibErr);
    }
  }

  if (isTaskCancelled(downloadId)) {
    if (createdAsset?.id) {
      await MediaLibrary.deleteAssetsAsync([createdAsset.id]).catch(() => {});
    }
    await FileSystem.deleteAsync(targetFileUri, { idempotent: true }).catch(() => {});
    return false;
  }

  // Cihaz MediaStore varlığı oluşturulamasa dahi parçayı doğrudan RunMusic kütüphanesine ekle
  const finalAsset: MediaLibrary.Asset = (createdAsset && createdAsset.id) ? {
    ...createdAsset,
    creationTime: createdAsset.creationTime || task.createdAt || Date.now(),
    modificationTime: createdAsset.modificationTime || task.completedAt || Date.now(),
    duration: createdAsset.duration || task.duration || 0,
  } : {
    id: task.mediaLibraryAssetId || `local_${downloadId}`,
    filename: targetFileName,
    uri: targetFileUri,
    mediaType: 'audio' as any,
    width: 0,
    height: 0,
    creationTime: task.createdAt || Date.now(),
    modificationTime: task.completedAt || task.createdAt || Date.now(),
    duration: task.duration || 0,
  };

  // RunMusic ana kütüphanesine varlığı anında ekle ve önbelleğe kaydet (listenin en başına)
  const currentAssets = getAllLibraryAssets();
  const filteredAssets = currentAssets.filter(
    (a) =>
      a.id !== finalAsset.id &&
      a.uri !== finalAsset.uri &&
      a.id !== `local_${downloadId}` &&
      a.uri !== task.localFileUri &&
      a.uri !== targetFileUri
  );
  const updatedAssets = [finalAsset, ...filteredAssets];
  useStore.getState().setLibrary(updatedAssets);
  saveCachedLibrary(updatedAssets).catch(() => {});

  // Şarkı bilgilerini metadataMap ve artworkMap'e yaz ki kütüphanede sanatçı, başlık ve kapak anında görünsün
  if (task.title || task.artist || task.artwork) {
    const metaPayload = {
      title: task.title,
      artist: task.artist,
      artwork: task.artwork,
      duration: task.duration,
    };
    const ids = Array.from(new Set([
      finalAsset.id,
      finalAsset.uri,
      `local_${downloadId}`,
      task.id,
      targetFileUri,
    ]));
    for (const id of ids) {
      useStore.getState().setTrackMetadata(id, metaPayload);
      if (task.artwork) {
        useStore.getState().setArtwork(id, task.artwork);
      }
    }
  }

  // Görevi kütüphaneye eklendi olarak işaretle ve dosya yolunu güncelle
  useDownloadStore.getState().updateTask(downloadId, {
    mediaLibraryAssetId: finalAsset.id,
    storageTarget: 'public',
    localFileUri: targetFileUri,
    fileName: targetFileName,
  });

  return true;
}

/**
 * Tamamlanan tüm indirmeleri RunMusic ana kütüphanesi (useStore.library) ile senkronize eder.
 * Dosyaların diskte var olduğunu PARALEL olarak doğrular ve kütüphanede eksik olanları en başa ekler.
 */
export async function syncCompletedDownloadsWithLibrary(): Promise<MediaLibrary.Asset[]> {
  const downloadTasks = useDownloadStore.getState().tasks;

  // Yalnızca tamamlanmış ve yerel dosya yolu olan görevler
  const completedTasks = downloadTasks.filter((t) => t.status === 'completed' && t.localFileUri);
  if (completedTasks.length === 0) return useStore.getState().library;

  // Dosya varlık denetimini sıralı değil PARALEL olarak çalıştır (gecikmeyi sıfırlar)
  const checkedResults = await Promise.all(
    completedTasks.map(async (task) => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(task.localFileUri!);
        return fileInfo.exists ? task : null;
      } catch {
        return null;
      }
    })
  );

  // Re-read the store after the async file checks. A full media scan may have
  // completed meanwhile; merging into a stale snapshot would overwrite it.
  const currentAssets = getAllLibraryAssets();
  const currentAssetIds = new Set(currentAssets.map((a) => a.id));
  const currentAssetUris = new Set(currentAssets.map((a) => a.uri));

  // A task can be cancelled or removed while its file check is in flight.
  // Only tasks that are still completed may be inserted into the library.
  const latestTasksById = new Map(
    useDownloadStore.getState().tasks.map((task) => [task.id, task])
  );
  const validTasks = checkedResults
    .filter((task): task is DownloadTask => task !== null)
    .map((task) => latestTasksById.get(task.id))
    .filter(
      (task): task is DownloadTask =>
        !!task && task.status === 'completed' && !!task.localFileUri
    );
  const newAssetsToAdd: MediaLibrary.Asset[] = [];
  const metaBatch: Record<string, any> = {};

  for (const task of validTasks) {
    const assetId = task.mediaLibraryAssetId || `local_${task.id}`;
    const alreadyInLib =
      currentAssetIds.has(assetId) ||
      currentAssetUris.has(task.localFileUri!) ||
      (task.mediaLibraryAssetId ? currentAssetIds.has(task.mediaLibraryAssetId) : false);

    const asset: MediaLibrary.Asset = buildDownloadAsset(task);

    if (!alreadyInLib) {
      newAssetsToAdd.push(asset);
      currentAssetIds.add(assetId);
      currentAssetUris.add(task.localFileUri!);
    }

    // Metadata ve Artwork kayıtlarını toplu güncellemek üzere biriktir
    if (task.title || task.artist || task.artwork) {
      const metaPayload = {
        title: task.title,
        artist: task.artist,
        artwork: task.artwork,
        duration: task.duration,
      };
      const ids = [assetId, task.localFileUri!, task.id, `local_${task.id}`];
      if (task.mediaLibraryAssetId) ids.push(task.mediaLibraryAssetId);
      for (const id of ids) {
        metaBatch[id] = metaPayload;
        if (task.artwork) {
          useStore.getState().setArtwork(id, task.artwork);
        }
      }
    }
  }

  if (Object.keys(metaBatch).length > 0) {
    useStore.getState().setBatchTrackMetadata(metaBatch);
  }

  if (newAssetsToAdd.length > 0) {
    // Re-read once more before committing so a scan/download that finished
    // during the metadata work is not lost.
    const latestAssets = getAllLibraryAssets();
    const latestIds = new Set(latestAssets.map((a) => a.id));
    const assetsToPrepend = newAssetsToAdd.filter((asset) => !latestIds.has(asset.id));
    const updatedAssets = [...assetsToPrepend, ...latestAssets];
    useStore.getState().setLibrary(updatedAssets);
    saveCachedLibrary(updatedAssets).catch(() => {});
    return useStore.getState().library;
  }

  return useStore.getState().library;
}

/**
 * İndirilen görevi ve yerel dosyasını kalıcı olarak siler.
 */
export async function deleteDownloadedFile(downloadId: string): Promise<void> {
  const task = useDownloadStore.getState().tasks.find((t) => t.id === downloadId);
  if (task?.localFileUri) {
    try {
      await FileSystem.deleteAsync(task.localFileUri, { idempotent: true });
    } catch {
      // ignore
    }
  }

  // Kütüphaneden de kaldır
  const currentAssets = getAllLibraryAssets();
  const filteredAssets = currentAssets.filter(
    (a) =>
      a.id !== task?.mediaLibraryAssetId &&
      a.id !== `local_${downloadId}` &&
      (!task?.localFileUri || a.uri !== task.localFileUri)
  );
  if (filteredAssets.length !== currentAssets.length) {
    useStore.getState().setLibrary(filteredAssets);
    saveCachedLibrary(filteredAssets).catch(() => {});
  }

  useDownloadStore.getState().removeTask(downloadId);
}


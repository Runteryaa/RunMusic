import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useDownloadStore } from '../store/useDownloadStore';
import { useStore } from '../store/useStore';
import { saveCachedLibrary } from './libraryStorage';
import type { DownloadTask } from '../types/download';

const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
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
      throw new Error('İndirme tamamlanamadı veya dosya oluşturulamadı.');
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

    useDownloadStore.getState().updateTask(task.id, {
      status: 'completed',
      progress: 1,
      completedAt: Date.now(),
      mediaLibraryAssetId: mediaAssetId,
      localFileUri: finalFileUri,
      fileName: finalFileName,
    });

    // Eğer genel kütüphaneye eklendiyse veya hedef public ise kütüphaneye ve store'a hemen kaydet
    if (task.storageTarget === 'public' || mediaAssetId) {
      await addDownloadToLibrary(task.id).catch((e) => {
        console.warn('[downloadManager] Otomatik kütüphane ekleme hatası:', e);
      });
    }
  } catch (error: any) {
    activeDownloads.delete(task.id);
    const errMsg = error?.message || 'İndirme sırasında bir hata oluştu.';
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

  useDownloadStore.getState().updateTask(downloadId, {
    status: 'cancelled',
  });
}

/**
 * Özel depolamadaki indirilmiş parçayı kullanıcının isteğiyle cihazın genel
 * müzik kütüphanesine (MediaLibrary) aktarır ve RunMusic kütüphanesine ekler.
 */
export async function addDownloadToLibrary(downloadId: string): Promise<boolean> {
  const task = useDownloadStore.getState().tasks.find((t) => t.id === downloadId);
  if (!task || !task.localFileUri) {
    throw new Error('Dosya bulunamadı.');
  }

  const fileInfo = await FileSystem.getInfoAsync(task.localFileUri);
  if (!fileInfo.exists) {
    throw new Error('İndirilen yerel dosya bulunamadı.');
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
  const currentLib = useStore.getState().library;
  const filteredLib = currentLib.filter(
    (a) => a.id !== finalAsset.id && a.uri !== finalAsset.uri && a.id !== `local_${downloadId}`
  );
  const updatedLib = [finalAsset, ...filteredLib];
  useStore.getState().setLibrary(updatedLib);
  saveCachedLibrary(updatedLib).catch(() => {});

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
  const currentLib = useStore.getState().library;
  const currentLibIds = new Set(currentLib.map((a) => a.id));
  const currentLibUris = new Set(currentLib.map((a) => a.uri));

  // Yalnızca tamamlanmış ve yerel dosya yolu olan görevler
  const completedTasks = downloadTasks.filter((t) => t.status === 'completed' && t.localFileUri);
  if (completedTasks.length === 0) return currentLib;

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

  const validTasks = checkedResults.filter((t): t is DownloadTask => t !== null);
  const newAssetsToAdd: MediaLibrary.Asset[] = [];
  const metaBatch: Record<string, any> = {};

  for (const task of validTasks) {
    const assetId = task.mediaLibraryAssetId || `local_${task.id}`;
    const alreadyInLib =
      currentLibIds.has(assetId) ||
      currentLibUris.has(task.localFileUri!) ||
      (task.mediaLibraryAssetId ? currentLibIds.has(task.mediaLibraryAssetId) : false);

    const asset: MediaLibrary.Asset = {
      id: assetId,
      filename: task.fileName || `${task.title || 'audio'}.mp3`,
      uri: task.localFileUri!,
      mediaType: 'audio' as any,
      width: 0,
      height: 0,
      creationTime: task.createdAt || Date.now(),
      modificationTime: task.completedAt || Date.now(),
      duration: task.duration || 0,
    };

    if (!alreadyInLib) {
      newAssetsToAdd.push(asset);
      currentLibIds.add(assetId);
      currentLibUris.add(task.localFileUri!);
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
    const updatedLib = [...newAssetsToAdd, ...currentLib];
    useStore.getState().setLibrary(updatedLib);
    saveCachedLibrary(updatedLib).catch(() => {});
    return updatedLib;
  }

  return currentLib;
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
  const currentLib = useStore.getState().library;
  const filteredLib = currentLib.filter(
    (a) =>
      a.id !== task?.mediaLibraryAssetId &&
      a.id !== `local_${downloadId}` &&
      (!task?.localFileUri || a.uri !== task.localFileUri)
  );
  if (filteredLib.length !== currentLib.length) {
    useStore.getState().setLibrary(filteredLib);
    saveCachedLibrary(filteredLib).catch(() => {});
  }

  useDownloadStore.getState().removeTask(downloadId);
}


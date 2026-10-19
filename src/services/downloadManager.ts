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

  // Hedef depolama: Tüm indirmeler güvenli ve izole olarak uygulamanın özel depolama alanına kaydedilir
  const target: 'public' | 'private' = params.storageTarget === 'public' ? 'public' : 'private';

  const downloadDir = `${FileSystem.documentDirectory || ''}downloads/`;
  const localFileUri = `${downloadDir}${downloadId}_${finalFileName}`;

  const task: DownloadTask = {
    id: downloadId,
    title,
    artist,
    artwork: params.artwork,
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

    let mediaAssetId: string | undefined;

    // Eğer genel müzik kütüphanesine kaydedilmesi istenmişse
    if (task.storageTarget === 'public') {
      try {
        const isVideo = task.fileName.toLowerCase().endsWith('.mp4');
        const permissionsToRequest: ('audio' | 'video')[] = isVideo ? ['audio', 'video'] : ['audio'];
        let permission = await MediaLibrary.getPermissionsAsync(false, permissionsToRequest as any);
        if (!permission.granted && permission.status !== 'granted' && permission.canAskAgain) {
          permission = await MediaLibrary.requestPermissionsAsync(false, permissionsToRequest as any);
        }

        if (permission.granted || permission.status === 'granted') {
          const createdAsset = await MediaLibrary.createAssetAsync(result.uri);
          if (createdAsset?.id) {
            mediaAssetId = createdAsset.id;

            // RunMusic ana kütüphanesine yeni varlığı anında ekle ve önbelleğe kaydet
            const currentLib = useStore.getState().library;
            if (!currentLib.some((a) => a.id === createdAsset.id || a.uri === createdAsset.uri)) {
              const updatedLib = [createdAsset, ...currentLib];
              useStore.getState().setLibrary(updatedLib);
              saveCachedLibrary(updatedLib).catch(() => {});
            }

            if (task.title || task.artist || task.artwork) {
              useStore.getState().setTrackMetadata(createdAsset.id, {
                title: task.title,
                artist: task.artist,
                artwork: task.artwork,
              });
            }
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
    });
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

  // Cihaz MediaStore varlığı oluşturulamasa dahi parçayı doğrudan RunMusic kütüphanesine ekle
  const finalAsset: MediaLibrary.Asset = (createdAsset && createdAsset.id) ? createdAsset : {
    id: `local_${downloadId}`,
    filename: targetFileName,
    uri: targetFileUri,
    mediaType: 'audio' as any,
    width: 0,
    height: 0,
    creationTime: task.createdAt || Date.now(),
    modificationTime: Date.now(),
    duration: 0,
  };

  // RunMusic ana kütüphanesine varlığı anında ekle ve önbelleğe kaydet
  const currentLib = useStore.getState().library;
  if (!currentLib.some((a) => a.id === finalAsset.id || a.uri === finalAsset.uri)) {
    const updatedLib = [finalAsset, ...currentLib];
    useStore.getState().setLibrary(updatedLib);
    saveCachedLibrary(updatedLib).catch(() => {});
  }

  // Şarkı bilgilerini metadataMap'e yaz ki kütüphanede sanatçı ve başlık anında görünsün
  if (task.title || task.artist || task.artwork) {
    useStore.getState().setTrackMetadata(finalAsset.id, {
      title: task.title,
      artist: task.artist,
      artwork: task.artwork,
    });
  }

  // Görevi kütüphaneye eklendi olarak işaretle
  useDownloadStore.getState().updateTask(downloadId, {
    mediaLibraryAssetId: finalAsset.id,
    storageTarget: 'public',
  });

  return true;
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


/**
 * Atlama (skip) kararı (saf).
 *
 * React/TrackPlayer bağımlılığı yoktur; Node doğrulama betiğinden import
 * edilebilir.
 */

/** `play_history` ile aynı eşik: 30 sn veya kısa parçalarda sürenin yarısı. */
export function skipThresholdSeconds(duration: number): number {
  return Math.min(30, duration > 0 ? duration * 0.5 : 30);
}

/**
 * Bir parça değişiminin "erken atlama" sayılıp sayılmayacağını belirler.
 *
 * @param lastPosition Önceki parçanın bırakıldığı konum (sn).
 * @param duration Önceki parçanın süresi (sn, bilinmiyorsa 0).
 * @param alreadyRecorded Önceki oturum dinleme eşiğini geçip geçmişe yazıldı mı.
 */
export function shouldCountSkip(
  lastPosition: number,
  duration: number,
  alreadyRecorded: boolean
): boolean {
  if (alreadyRecorded) return false;
  const position = Math.max(0, lastPosition || 0);
  // Parça hiç başlamadıysa (ör. kuyruk kurulurken değişti) atlama değildir.
  if (position < 0.5) return false;
  // Doğal son: şarkı bitmeye yakın bırakıldıysa atlama sayılmaz.
  if (duration > 0 && position >= duration - 5) return false;
  // Dinleme eşiği geçildiyse geçmişe yazılmıştır; atlama sayılmaz.
  if (position >= skipThresholdSeconds(duration)) return false;
  return true;
}

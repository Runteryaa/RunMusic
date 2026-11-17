/**
 * Sanatçı adı değiştirme / birleştirme yardımcıları.
 *
 * NEDEN: Kütüphaneye gelen etiketler hatalı olabiliyor ("Mavi Solman" aslında
 * "Mavi"). Kullanıcı sanatçı sayfasından adı düzeltince **tüm** parçaların
 * metadata'sı yeni ada taşınmalı; yeni ad zaten varsa iki sanatçı birleşmeli.
 *
 * Modül saf (native/React yok) ki Node doğrulama betiğinde çalışsın. Hem
 * `metadataMap` yazımı hem SQLite geçmiş güncellemesi aynı kuralı kullanır:
 * sanatçı alanı görünen adlara bölünür, eşleşen ad değiştirilir, tekrarlar
 * birleştirilir.
 */

import { normalizeArtistKey } from './artistMatch';
import { cleanArtistName } from './displayNames';
import { splitArtistNames } from './wrappedStats';

/**
 * Bir sanatçı alanında `oldName` geçiyorsa `newName` ile değiştirir.
 *
 * Dönüş:
 *  - `null`: alanda bu sanatçı yok, satır değişmemeli.
 *  - aksi halde yeni sanatçı alanı ("A, B" biçiminde birleştirilmiş).
 *
 * Ortak çalışmalar korunur: "Mavi Solman, UZI" → "Mavi, UZI". Aynı ada iki kez
 * düşen parçalar (birleşme sonrası) tekilleştirilir.
 */
export function renameArtistInField(
  rawField: string | null | undefined,
  oldName: string,
  newName: string
): string | null {
  const oldKey = normalizeArtistKey(oldName);
  const replacement = cleanArtistName(newName) || (newName ?? '').trim();
  if (!oldKey || !replacement) return null;

  const parts = splitArtistNames(rawField);
  if (parts.length === 0) return null;

  let changed = false;
  const seen = new Set<string>();
  const next: string[] = [];

  for (const part of parts) {
    const isTarget = normalizeArtistKey(part) === oldKey;
    const name = isTarget ? replacement : cleanArtistName(part) || part.trim();
    const key = normalizeArtistKey(name);
    if (!key) continue;
    if (isTarget) changed = true;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(name);
  }

  if (!changed || next.length === 0) return null;
  const joined = next.join(', ');
  // Görünürde bir şey değişmediyse boşuna yazma.
  if (joined === (rawField ?? '').trim()) return null;
  return joined;
}

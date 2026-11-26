import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TouchableOpacity } from './ui/TouchableOpacity';
import { useTranslation } from '../services/i18n';
import type { ThemeColors } from '../services/colorThemeService';
import type { LyricsSearchHit } from '../services/lyricsSearch';

/**
 * Kitaplık aramasında "Sözlerde eşleşenler" paneli.
 *
 * NEDEN AYRI BİLEŞEN: panel `FlashList`ın `ListHeaderComponent`'ı içinde
 * render ediliyor. Genişletme durumu ekran state'inde tutulduğunda, sanal
 * listenin başlık öğesini yeniden çizmemesi yüzünden "Genişlet" düğmesine
 * basmak görünürde hiçbir şey yapmıyordu. Durum burada, satırın kendi
 * içinde tutulur: düğmeye basıldığında yalnızca bu bileşen yeniden çizilir,
 * dolayısıyla genişletme her koşulda çalışır.
 *
 * Panel varsayılan olarak **kapalıdır**: yalnızca başlık çubuğu görünür,
 * sağ kenarındaki küçük ok ile aşağı doğru açılır. Söz araması yapan her
 * kullanıcıya sonuç listesini zorla göstermek kitaplık listesini
 * kısaltıyordu.
 */

interface LyricsMatchesPanelProps {
  hits: LyricsSearchHit[];
  theme: ThemeColors;
  onOpenTrack: (hit: LyricsSearchHit) => void;
}

export function LyricsMatchesPanel({ hits, theme, onOpenTrack }: LyricsMatchesPanelProps) {
  const { t } = useTranslation();
  /** Panel başlık çubuğu açık mı? (Varsayılan: kapalı.) */
  const [isOpen, setIsOpen] = useState(false);
  /** Genişletilmiş parça kimlikleri (panel açıkken satır bazında). */
  const [expanded, setExpanded] = useState<string[]>([]);

  const toggleHit = (trackId: string) => {
    setExpanded((current) =>
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId]
    );
  };

  return (
    <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={t('library.lyrics_matches')}
        accessibilityHint={isOpen ? t('library.lyrics_collapse') : t('library.lyrics_expand')}
        onPress={() => setIsOpen((value) => !value)}>
        <Ionicons name="mic-outline" size={15} color={theme.primary} />
        <Text style={styles.panelTitle} numberOfLines={1}>
          {t('library.lyrics_matches')}
        </Text>
        <View style={[styles.countPill, { backgroundColor: `${theme.primary}26` }]}>
          <Text style={[styles.countText, { color: theme.primary }]}>{hits.length}</Text>
        </View>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={isOpen ? theme.primary : '#a1a1aa'}
        />
      </TouchableOpacity>

      {isOpen ? (
        <View style={styles.body}>
          {hits.map((hit) => {
            const isExpanded = expanded.includes(hit.track.id);
            const hasMore = hit.details.trim() !== hit.snippet.trim();
            return (
              <View key={`lyrics-hit-${hit.track.id}`} style={styles.row}>
                <TouchableOpacity
                  style={styles.main}
                  activeOpacity={0.75}
                  onPress={() => onOpenTrack(hit)}>
                  <View style={styles.textWrap}>
                    <Text style={styles.title} numberOfLines={1}>
                      {hit.track.title}
                      {hit.track.artist ? ` · ${hit.track.artist}` : ''}
                    </Text>
                    <Text
                      style={[styles.snippet, isExpanded && styles.snippetExpanded]}
                      numberOfLines={isExpanded ? undefined : 2}>
                      {isExpanded ? hit.details : hit.snippet}
                    </Text>
                  </View>
                </TouchableOpacity>
                {hasMore ? (
                  <TouchableOpacity
                    style={styles.toggle}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityLabel={
                      isExpanded ? t('library.lyrics_collapse') : t('library.lyrics_expand')
                    }
                    onPress={() => toggleHit(hit.track.id)}>
                    <Text style={[styles.toggleText, { color: theme.primary }]}>
                      {isExpanded ? t('library.lyrics_collapse') : t('library.lyrics_expand')}
                    </Text>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={theme.primary}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  /** Başlık çubuğu: panel kapalıyken tek görünen kısım. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  panelTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#d4d4d8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countPill: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
  },
  /** Satırın gövdesi: parçayı açar. Genişletme düğmesi ayrı dokunuş alanıdır. */
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e4e4e7',
  },
  snippet: {
    fontSize: 11,
    color: '#a1a1aa',
    marginTop: 2,
    fontStyle: 'italic',
  },
  /** Genişletilmiş hâl: satır araları açılır, italik kalkar (okunaklı söz). */
  snippetExpanded: {
    lineHeight: 17,
    fontStyle: 'normal',
    color: '#d4d4d8',
    marginTop: 4,
    marginBottom: 4,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

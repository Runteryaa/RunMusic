import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { TrackArtwork } from './TrackArtwork';
import { useTranslation } from '../services/i18n';

/** Sürükleme matematiği sabit satır yüksekliğine dayanır; stil ile eşleşmeli. */
export const UPNEXT_ROW_HEIGHT = 62;

export interface UpNextItem {
  /** Kararlı React key'i (kuyruk indeksi değişebilir). */
  key: string;
  title: string;
  artist?: string;
  artwork?: string;
  trackId?: string | null;
  trackUri?: string | null;
}

interface Props {
  items: UpNextItem[];
  accentColor: string;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onItemPress?: (item: UpNextItem, index: number) => void;
}

/**
 * "Sırada" (manuel öncelikli kuyruk) listesi.
 *
 * Uygulamanın ve kuyruk ekranının tasarım standartlarıyla birebir uyumlu kartlar:
 *  - Yumuşak köşe yuvarlama (borderRadius: 12)
 *  - Saydam kart arka planı (theme.surface / rgba(255, 255, 255, 0.05))
 *  - Beyaz başlık, gri alt sanatçı metni
 *  - Dokunarak çalma (onItemPress)
 *  - Tutamaktan (≡) basılı tutup sürükleyerek yeniden sıralama
 *  - Sağa/sola kaydırarak silme (Swipeable)
 */
export function QueueUpNextList({ items, accentColor, onMove, onRemove, onItemPress }: Props) {
  const commit = useCallback(
    (from: number, to: number) => {
      if (from !== to) onMove(from, to);
    },
    [onMove]
  );

  return (
    <View style={{ height: items.length * UPNEXT_ROW_HEIGHT }}>
      {items.map((item, index) => (
        <UpNextRow
          key={item.key}
          item={item}
          index={index}
          count={items.length}
          accentColor={accentColor}
          onCommit={commit}
          onRemove={onRemove}
          onPress={onItemPress}
        />
      ))}
    </View>
  );
}

interface RowProps {
  item: UpNextItem;
  index: number;
  count: number;
  accentColor: string;
  onCommit: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onPress?: (item: UpNextItem, index: number) => void;
}

function UpNextRow({
  item,
  index,
  count,
  accentColor,
  onCommit,
  onRemove,
  onPress,
}: RowProps) {
  const { t } = useTranslation();
  const dragY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        .runOnJS(true)
        .onStart(() => {
          isDragging.value = true;
          dragY.value = 0;
        })
        .onUpdate((event) => {
          dragY.value = event.translationY;
        })
        .onEnd(() => {
          const offset = Math.round(dragY.value / UPNEXT_ROW_HEIGHT);
          const target = Math.max(0, Math.min(count - 1, index + offset));
          isDragging.value = false;
          dragY.value = 0;
          onCommit(index, target);
        })
        .onFinalize(() => {
          isDragging.value = false;
          dragY.value = 0;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, count, onCommit]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }, { scale: isDragging.value ? 1.02 : 1 }],
    zIndex: isDragging.value ? 50 : 0,
    opacity: isDragging.value ? 0.95 : 1,
  }));

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.removeAction}
      activeOpacity={0.8}
      onPress={() => onRemove(index)}>
      <Ionicons name="trash-outline" size={20} color="#ffffff" />
    </TouchableOpacity>
  );

  const isExtensionTrack =
    item.trackId?.startsWith('ext_') ||
    (typeof item.trackUri === 'string' && item.trackUri.startsWith('http'));

  return (
    <Animated.View style={[styles.rowWrapper, animatedStyle]}>
      <Swipeable
        renderRightActions={renderRightActions}
        friction={1}
        rightThreshold={130}
        overshootRight={false}
        activeOffsetX={[-20, 20]}
        failOffsetY={[-15, 15]}
        onSwipeableOpen={(direction, swipeable) => {
          swipeable?.close?.();
          if (direction === 'right') {
            onRemove(index);
          }
        }}>
        <View style={styles.cardContainer}>
          {/* Sol: Sürükleme Tutamağı */}
          <GestureDetector gesture={pan}>
            <View style={styles.dragHandle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}>
              <Ionicons name="reorder-two-outline" size={20} color="rgba(255,255,255,0.4)" />
            </View>
          </GestureDetector>

          {/* Ana İçerik: Dokunarak Çalma */}
          <TouchableOpacity
            style={styles.mainContent}
            activeOpacity={0.7}
            onPress={() => onPress?.(item, index)}>
            <TrackArtwork
              uri={item.artwork}
              trackId={item.trackId}
              trackUri={item.trackUri}
              size={40}
              borderRadius={6}
              iconSize={18}
            />

            <View style={styles.textBox}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={styles.artistContainer}>
                {isExtensionTrack ? (
                  <View style={styles.extBadge}>
                    <Ionicons
                      name="globe-outline"
                      size={10}
                      color="rgba(255,255,255,0.7)"
                      style={{ marginRight: 3 }}
                    />
                    <Text style={styles.extBadgeText}>{t('common.extension')}</Text>
                  </View>
                ) : null}
                <Text style={styles.artist} numberOfLines={1}>
                  {item.artist || t('common.unknown_artist')}
                </Text>
              </View>
            </View>

            <View style={styles.rightSlot}>
              <Ionicons name="play" size={13} color="rgba(255,255,255,0.25)" />
            </View>
          </TouchableOpacity>
        </View>
      </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rowWrapper: {
    height: UPNEXT_ROW_HEIGHT,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  cardContainer: {
    height: UPNEXT_ROW_HEIGHT - 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    paddingLeft: 4,
    paddingRight: 10,
  },
  dragHandle: {
    width: 30,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  textBox: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  artistContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  extBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
  },
  extBadgeText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 9,
    fontWeight: '600',
  },
  artist: {
    color: '#71717a',
    fontSize: 12,
    flex: 1,
  },
  rightSlot: {
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAction: {
    width: 68,
    height: UPNEXT_ROW_HEIGHT - 4,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

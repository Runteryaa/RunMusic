import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { TrackArtwork } from './TrackArtwork';

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
}

/**
 * "Sırada" (manuel kuyruk) listesi.
 *
 * Etkileşimler bilinçli olarak AYRIŞTIRILMIŞTIR ki birbirleriyle çakışmasın:
 *  - YENİDEN SIRALAMA: soldaki tutamak (≡) üzerinde kısa basılı tutma sonrası
 *    başlayan dikey sürükleme. Bırakınca hedef konum hesaplanıp bildirilir.
 *  - KALDIRMA: satırı yatay kaydırma (Swipeable) veya beliren çöp düğmesi.
 *
 * Her satır kendi animasyon durumunu (`useSharedValue`) tutar: React Compiler
 * prop olarak geçen shared value'ların değiştirilmesine izin vermez, ayrıca
 * satırların birbirini kaydırması için ek senkron gerekmez.
 */
export function QueueUpNextList({ items, accentColor, onMove, onRemove }: Props) {
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
}

function UpNextRow({ item, index, count, accentColor, onCommit, onRemove }: RowProps) {
  // Bu satıra özel sürükleme durumu (aynı bileşende oluşturulur ve değiştirilir).
  const dragY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        // Geri çağrılar JS iş parçacığında çalışsın: worklet → JS köprüsü gerekmez.
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
          // İptal edilirse (ör. sistem geri hareketi) durumu temizle.
          isDragging.value = false;
          dragY.value = 0;
        }),
    // Shared value'lar ref gibi kararlıdır; bağımlılığa yazılmaz (yazılırsa
    // React Compiler bunları "hook argümanı" sayıp değiştirilmesini engeller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, count, onCommit]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }, { scale: isDragging.value ? 1.03 : 1 }],
    zIndex: isDragging.value ? 50 : 0,
    opacity: isDragging.value ? 0.97 : 1,
  }));

  const renderRightActions = () => (
    <TouchableOpacity
      style={[styles.removeAction, { backgroundColor: '#ef4444' }]}
      activeOpacity={0.8}
      onPress={() => onRemove(index)}>
      <Ionicons name="trash-outline" size={20} color="#ffffff" />
    </TouchableOpacity>
  );

  return (
    <Animated.View style={[styles.rowWrapper, animatedStyle]}>
      <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
        <View style={styles.row}>
          <GestureDetector gesture={pan}>
            <View style={styles.dragHandle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}>
              <Ionicons name="reorder-three" size={22} color="rgba(255,255,255,0.45)" />
            </View>
          </GestureDetector>

          <TrackArtwork
            uri={item.artwork}
            trackId={item.trackId}
            trackUri={item.trackUri}
            size={40}
            borderRadius={6}
            iconSize={18}
          />

          <View style={styles.textBox}>
            <Text style={[styles.title, { color: accentColor }]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {item.artist}
              </Text>
            ) : null}
          </View>
        </View>
      </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rowWrapper: {
    height: UPNEXT_ROW_HEIGHT,
  },
  row: {
    height: UPNEXT_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    backgroundColor: '#18181b',
  },
  dragHandle: {
    width: 34,
    height: UPNEXT_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBox: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  artist: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  removeAction: {
    width: 72,
    height: UPNEXT_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

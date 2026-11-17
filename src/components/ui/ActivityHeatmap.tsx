import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '../../services/colorThemeService';
import { buildHeatmapColumns, heatmapLevel } from '../../services/statsHeatmap';

/**
 * GitHub tarzı dinleme ısı haritası.
 *
 * Saf görsel: veri hazır `counts` sözlüğü olarak gelir; bileşen yalnızca
 * yerel güne göre ızgarayı kurar. Hücreler dokunmaya kapalıdır (yüzlerce
 * hücrede jestek dinleyici eklememek için) — özet ve renk skalası yeterli.
 */
export function ActivityHeatmap({
  counts,
  weeks,
  theme,
  lessLabel,
  moreLabel,
  style,
}: {
  counts: Record<string, number>;
  weeks: number;
  theme: ThemeColors;
  lessLabel: string;
  moreLabel: string;
  style?: any;
}) {
  const [width, setWidth] = useState(0);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const value of Object.values(counts)) {
      if (value > max) max = value;
    }
    return max;
  }, [counts]);

  const columns = useMemo(() => buildHeatmapColumns(weeks, counts), [weeks, counts]);

  const gap = weeks > 30 ? 1.5 : 2;
  const cellSize =
    width > 0 ? Math.max(2, Math.floor((width - (weeks - 1) * gap) / weeks)) : 0;

  const levelColor = (level: 0 | 1 | 2 | 3 | 4): string => {
    switch (level) {
      case 1:
        return `${theme.primary}38`;
      case 2:
        return `${theme.primary}66`;
      case 3:
        return `${theme.primary}aa`;
      case 4:
        return theme.primary;
      default:
        return 'rgba(255, 255, 255, 0.07)';
    }
  };

  return (
    <View style={style}>
      <View
        style={[styles.grid, { gap }]}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setWidth((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
        }}>
        {cellSize > 0
          ? columns.map((column, columnIndex) => (
              <View key={`col-${columnIndex}`} style={{ gap }}>
                {column.map((cell) => (
                  <View
                    key={cell.dateKey}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: Math.max(1, Math.round(cellSize / 4)),
                      backgroundColor: cell.filled
                        ? levelColor(heatmapLevel(cell.count, maxCount))
                        : 'transparent',
                    }}
                  />
                ))}
              </View>
            ))
          : null}
      </View>

      <View style={styles.legendRow}>
        <Text style={styles.legendText}>{lessLabel}</Text>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <View
            key={level}
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              marginHorizontal: 1.5,
              backgroundColor: levelColor(level),
            }}
          />
        ))}
        <Text style={styles.legendText}>{moreLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  legendText: {
    color: '#71717a',
    fontSize: 10,
    marginHorizontal: 5,
  },
});

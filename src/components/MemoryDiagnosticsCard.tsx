import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  clearMemoryDiagnostics,
  ensureMemoryDiagnosticsHydrated,
  formatMemoryDiagnostics,
  getDiagnosticSnapshot,
  type DiagnosticSnapshot,
} from '../services/memoryDiagnostics';
import { useIsAppActive } from '../hooks/useIsAppActive';
import { useThemeStore } from '../store/useThemeStore';

type Theme = ReturnType<typeof useThemeStore.getState>['theme'];

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function MemoryDiagnosticsCard({
  theme,
  language,
}: {
  theme: Theme;
  language: string;
}) {
  const isAppActive = useIsAppActive();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(() => getDiagnosticSnapshot());
  const tr = language === 'tr';

  const refresh = useCallback(async () => {
    await ensureMemoryDiagnosticsHydrated();
    setSnapshot(getDiagnosticSnapshot());
  }, []);

  useEffect(() => {
    if (!isAppActive) return;
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAppActive, refresh]);

  const handleShare = useCallback(async () => {
    await ensureMemoryDiagnosticsHydrated();
    const message = formatMemoryDiagnostics();
    try {
      await Share.share({
        title: 'RunMusic memory diagnostics',
        message,
      });
    } catch {
      // The user may cancel the share sheet.
    }
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert(
      tr ? 'Tanılamayı temizle' : 'Clear diagnostics',
      tr
        ? 'Mevcut bellek günlüğü silinsin mi? Yeni bir deneme için temiz bir başlangıç yapar.'
        : 'Delete the current memory log? This starts a clean reproduction run.',
      [
        { text: tr ? 'Vazgeç' : 'Cancel', style: 'cancel' },
        {
          text: tr ? 'Temizle' : 'Clear',
          style: 'destructive',
          onPress: () => {
            void clearMemoryDiagnostics().then(refresh);
          },
        },
      ]
    );
  }, [refresh, tr]);

  const latest = snapshot.samples[snapshot.samples.length - 1];
  const recentSamples = snapshot.samples.slice(-8);
  const components = latest?.components ?? snapshot.components;
  const componentRows = Object.entries(components).slice(0, 10);

  return (
    <View>
      <Text style={styles.hint}>
        {tr
          ? 'Uzun arka plan çalma sonrası çökme olursa bu günlüğü paylaş. Örnekler dakikada bir, bileşen sayaçları her render’da güncellenir.'
          : 'If the app crashes after long background playback, share this log. Samples are taken once per minute; component counters update on every render.'}
      </Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>JS heap</Text>
          <Text style={styles.summaryValue}>{formatBytes(latest?.jsHeapSize ?? null)}</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>{tr ? 'Ayrılan' : 'Allocated'}</Text>
          <Text style={styles.summaryValue}>
            {formatBytes(latest?.jsAllocatedBytes ?? null)}
          </Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>{tr ? 'Örnek' : 'Samples'}</Text>
          <Text style={styles.summaryValue}>{snapshot.samples.length}</Text>
        </View>
      </View>

      {latest ? (
        <Text style={styles.latestLine}>
          {formatTime(latest.at)} · {latest.appState} ·{' '}
          {tr ? 'oynatılıyor' : 'playing'}={String(latest.extra.playing ?? false)}
        </Text>
      ) : (
        <Text style={styles.emptyText}>
          {tr ? 'Henüz örnek yok.' : 'No samples yet.'}
        </Text>
      )}

      {componentRows.length > 0 ? (
        <View style={styles.counterBox}>
          {componentRows.map(([name, stat]) => (
            <View key={name} style={styles.counterRow}>
              <Text style={styles.counterName}>{name}</Text>
              <Text style={styles.counterValue}>
                {stat.mounts}/{stat.unmounts}/{stat.renders}
              </Text>
            </View>
          ))}
          <Text style={styles.counterHint}>
            {tr ? 'mount/unmount/render' : 'mount/unmount/render'}
          </Text>
        </View>
      ) : null}

      {recentSamples.length > 0 ? (
        <View style={styles.logBox}>
          {recentSamples.map((sample) => (
            <Text key={`${sample.session}-${sample.at}`} style={styles.logLine} numberOfLines={2}>
              [{formatTime(sample.at)}] {sample.appState} heap={formatBytes(sample.jsHeapSize)}{' '}
              alloc={formatBytes(sample.jsAllocatedBytes)} lib={String(sample.extra.library ?? '-')}{' '}
              q={String(sample.extra.queue ?? '-')}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.primary }]}
          activeOpacity={0.7}
          onPress={handleShare}>
          <Ionicons name="share-outline" size={16} color="#ffffff" />
          <Text style={styles.actionBtnText}>{tr ? 'Günlüğü paylaş' : 'Share log'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.clearBtn, { borderColor: theme.border || '#27272a' }]}
          activeOpacity={0.7}
          onPress={handleClear}>
          <Ionicons name="trash-outline" size={16} color="#ef4444" />
          <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>
            {tr ? 'Temizle' : 'Clear'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  summaryLabel: {
    color: '#71717a',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  latestLine: {
    color: '#a1a1aa',
    fontSize: 11,
    marginBottom: 8,
  },
  emptyText: {
    color: '#71717a',
    fontSize: 12,
    marginBottom: 8,
  },
  counterBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  counterName: {
    color: '#d4d4d8',
    fontSize: 11,
  },
  counterValue: {
    color: '#a1a1aa',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  counterHint: {
    color: '#52525b',
    fontSize: 9,
    marginTop: 4,
  },
  logBox: {
    backgroundColor: '#09090b',
    borderRadius: 10,
    padding: 8,
    marginBottom: 10,
  },
  logLine: {
    color: '#a1a1aa',
    fontSize: 9,
    lineHeight: 13,
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  clearBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});

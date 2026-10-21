import { useCallback, useMemo, type ReactNode } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import {
  EQUALIZER_BAND_FREQUENCIES,
  EQUALIZER_MAX_DB,
  EQUALIZER_MIN_DB,
  PREAMP_MAX_DB,
  PREAMP_MIN_DB,
  type ReplayGainMode,
} from '../services/audioEffectsSettings';
import { isNativeAudioEffectsAvailable } from '../services/audioEffectsService';
import { ValueSlider } from '../components/ValueSlider';

type Theme = ReturnType<typeof useThemeStore.getState>['theme'];

function formatDb(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

export default function AudioEffectsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const audioEffects = useStore((state) => state.preferences.audioEffects);
  const setAudioEffects = useStore((state) => state.setAudioEffects);
  const resetAudioEffects = useStore((state) => state.resetAudioEffects);

  const equalizerSupported = Platform.OS === 'android' && isNativeAudioEffectsAvailable();
  const nativeUnavailable = Platform.OS === 'android' && !isNativeAudioEffectsAvailable();
  const iosFallback = Platform.OS === 'ios';

  const bandLabels = useMemo(
    () => [
      t('audioEffects.band_60'),
      t('audioEffects.band_230'),
      t('audioEffects.band_910'),
      t('audioEffects.band_3600'),
      t('audioEffects.band_14000'),
    ],
    [t]
  );

  const replayGainOptions = useMemo(
    () => [
      { value: 'off' as ReplayGainMode, label: t('audioEffects.mode_off') },
      { value: 'track' as ReplayGainMode, label: t('audioEffects.mode_track') },
      { value: 'album' as ReplayGainMode, label: t('audioEffects.mode_album') },
    ],
    [t]
  );

  const updateBand = useCallback(
    (index: number, value: number) => {
      const bands = [...audioEffects.equalizerBands];
      bands[index] = value;
      setAudioEffects({ equalizerBands: bands });
    },
    [audioEffects.equalizerBands, setAudioEffects]
  );

  const resetEqualizer = useCallback(() => {
    setAudioEffects({ equalizerBands: EQUALIZER_BAND_FREQUENCIES.map(() => 0) });
  }, [setAudioEffects]);

  const confirmResetAll = useCallback(() => {
    Alert.alert(
      t('audioEffects.reset_confirm_title'),
      t('audioEffects.reset_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.reset'),
          style: 'destructive',
          onPress: () => resetAudioEffects(),
        },
      ]
    );
  }, [resetAudioEffects, t]);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/settings');
            }
          }}
          hitSlop={12}
          accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('audioEffects.title')}</Text>
          <Text style={styles.headerSubtitle}>{t('audioEffects.subtitle')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 24) + 32 },
        ]}
        showsVerticalScrollIndicator={false}>
        {iosFallback ? (
          <View style={styles.noteCard}>
            <Ionicons name="information-circle-outline" size={18} color={theme.primary} />
            <Text style={styles.noteText}>{t('audioEffects.ios_note')}</Text>
          </View>
        ) : null}

        {nativeUnavailable ? (
          <View style={styles.noteCard}>
            <Ionicons name="cloud-download-outline" size={18} color={theme.primary} />
            <Text style={styles.noteText}>{t('audioEffects.native_unavailable')}</Text>
          </View>
        ) : null}

        <Card
          icon="options-outline"
          title={t('audioEffects.equalizer_section')}
          subtitle={equalizerSupported ? t('audioEffects.live_hint') : t('audioEffects.unsupported_eq')}
          theme={theme}>
          <View style={styles.toggleRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('audioEffects.equalizer_enable')}</Text>
              <Text style={styles.rowHint}>{t('audioEffects.equalizer_hint')}</Text>
            </View>
            <Switch
              value={audioEffects.equalizerEnabled}
              disabled={!equalizerSupported}
              onValueChange={(value) => setAudioEffects({ equalizerEnabled: value })}
              trackColor={{ false: '#3f3f46', true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.sliders}>
            {bandLabels.map((label, index) => {
              const value = audioEffects.equalizerBands[index] ?? 0;
              return (
                <View key={label} style={styles.sliderBlock}>
                  <View style={styles.sliderHeader}>
                    <Text style={styles.sliderLabel}>{label}</Text>
                    <Text style={[styles.sliderValue, { color: theme.primary }]}>
                      {formatDb(value)}
                    </Text>
                  </View>
                  <ValueSlider
                    value={value}
                    min={EQUALIZER_MIN_DB}
                    max={EQUALIZER_MAX_DB}
                    step={0.5}
                    disabled={!equalizerSupported || !audioEffects.equalizerEnabled}
                    accentColor={theme.primary}
                    onChange={(next) => updateBand(index, next)}
                  />
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={resetEqualizer}
            disabled={!equalizerSupported}
            activeOpacity={0.7}>
            <Ionicons
              name="refresh-outline"
              size={16}
              color={equalizerSupported ? theme.primary : '#52525b'}
            />
            <Text
              style={[
                styles.secondaryBtnText,
                { color: equalizerSupported ? theme.primary : '#52525b' },
              ]}>
              {t('audioEffects.reset_equalizer')}
            </Text>
          </TouchableOpacity>
        </Card>

        <Card
          icon="volume-high-outline"
          title={t('audioEffects.replay_gain_section')}
          subtitle={t('audioEffects.replay_gain_subtitle')}
          theme={theme}>
          <Text style={styles.rowLabel}>{t('audioEffects.replay_gain_mode')}</Text>
          <Text style={styles.rowHint}>{t('audioEffects.replay_gain_hint')}</Text>
          <View style={styles.chipsWrap}>
            {replayGainOptions.map((option) => {
              const active = audioEffects.replayGainMode === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  activeOpacity={0.7}
                  onPress={() => setAudioEffects({ replayGainMode: option.value })}
                  style={[
                    styles.chip,
                    active && { backgroundColor: theme.primary, borderColor: theme.primary },
                  ]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.toggleRow, styles.toggleRowBorder]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('audioEffects.prevent_clipping')}</Text>
              <Text style={styles.rowHint}>{t('audioEffects.prevent_clipping_hint')}</Text>
            </View>
            <Switch
              value={audioEffects.preventClipping}
              onValueChange={(value) => setAudioEffects({ preventClipping: value })}
              trackColor={{ false: '#3f3f46', true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </Card>

        <Card
          icon="speedometer-outline"
          title={t('audioEffects.preamp')}
          subtitle={t('audioEffects.preamp_subtitle')}
          theme={theme}>
          <View style={styles.sliderBlock}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>{t('audioEffects.preamp')}</Text>
              <Text style={[styles.sliderValue, { color: theme.primary }]}>
                {formatDb(audioEffects.preampDb)}
              </Text>
            </View>
            <ValueSlider
              value={audioEffects.preampDb}
              min={PREAMP_MIN_DB}
              max={PREAMP_MAX_DB}
              step={0.5}
              accentColor={theme.primary}
              onChange={(value) => setAudioEffects({ preampDb: value })}
            />
            <Text style={styles.rowHint}>{t('audioEffects.preamp_hint')}</Text>
          </View>
        </Card>

        <TouchableOpacity
          style={styles.resetBtn}
          onPress={confirmResetAll}
          activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={16} color="#ef4444" />
          <Text style={styles.resetBtnText}>{t('audioEffects.reset_all')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Card({
  icon,
  title,
  subtitle,
  theme,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  theme: Theme;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={18} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    marginBottom: 12,
  },
  noteText: {
    flex: 1,
    color: '#d4d4d8',
    fontSize: 12,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  cardBody: {
    padding: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleRowBorder: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  rowHint: {
    color: '#71717a',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  sliders: {
    marginTop: 16,
    gap: 6,
  },
  sliderBlock: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sliderLabel: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  sliderValue: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#27272a',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
  },
  chipText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3f1f1f',
    backgroundColor: '#1f1414',
    marginTop: 2,
  },
  resetBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
});

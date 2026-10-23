import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
  BUILT_IN_EQUALIZER_PRESETS,
  EQUALIZER_BAND_FREQUENCIES,
  EQUALIZER_MAX_DB,
  EQUALIZER_MIN_DB,
  MAX_CUSTOM_PRESETS,
  PREAMP_MAX_DB,
  PREAMP_MIN_DB,
  PRESET_NAME_MAX_LENGTH,
  bandsMatch,
  normalizePresetName,
  type EqualizerPreset,
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

  // Kaydırıcılar sürüklenirken yalnızca yerel taslak güncellenir. Böylece her
  // pikselde büyük AsyncStorage kaydı yazılmaz; ses ayarı parmak kalkınca uygulanır.
  const [draftBands, setDraftBands] = useState<number[]>(audioEffects.equalizerBands);
  const [draftPreamp, setDraftPreamp] = useState(audioEffects.preampDb);
  const draftBandsRef = useRef(audioEffects.equalizerBands);
  const draftPreampRef = useRef(audioEffects.preampDb);

  useEffect(() => {
    draftBandsRef.current = audioEffects.equalizerBands;
    setDraftBands(audioEffects.equalizerBands);
  }, [audioEffects.equalizerBands]);

  useEffect(() => {
    draftPreampRef.current = audioEffects.preampDb;
    setDraftPreamp(audioEffects.preampDb);
  }, [audioEffects.preampDb]);

  const equalizerSupported = Platform.OS === 'android' && isNativeAudioEffectsAvailable();
  const nativeUnavailable = Platform.OS === 'android' && !isNativeAudioEffectsAvailable();
  const iosFallback = Platform.OS === 'ios';

  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [presetName, setPresetName] = useState('');
  const customPresets = audioEffects.customPresets;

  const builtInPresets = useMemo(() => {
    const labels: Record<string, string> = {
      flat: t('audioEffects.preset_flat'),
      bass: t('audioEffects.preset_bass'),
      vocal: t('audioEffects.preset_vocal'),
      rock: t('audioEffects.preset_rock'),
      podcast: t('audioEffects.preset_podcast'),
    };
    return BUILT_IN_EQUALIZER_PRESETS.map((preset) => ({
      ...preset,
      label: labels[preset.id] ?? preset.id,
    }));
  }, [t]);

  const allPresets = useMemo(
    () => [
      ...customPresets.map((preset) => ({
        id: preset.id,
        label: preset.name,
        bands: preset.bands,
        custom: true,
      })),
      ...builtInPresets.map((preset) => ({
        id: preset.id,
        label: preset.label,
        bands: preset.bands,
        custom: false as const,
      })),
    ],
    [builtInPresets, customPresets]
  );

  const activePreset = useMemo(
    () => allPresets.find((preset) => bandsMatch(draftBands, preset.bands)),
    [allPresets, draftBands]
  );

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

  const updateBand = useCallback((index: number, value: number) => {
    const bands = [...draftBandsRef.current];
    bands[index] = value;
    draftBandsRef.current = bands;
    setDraftBands(bands);
  }, []);

  const commitBand = useCallback(
    (index: number, value: number) => {
      const bands = [...draftBandsRef.current];
      bands[index] = value;
      draftBandsRef.current = bands;
      setDraftBands(bands);
      setAudioEffects({ equalizerBands: bands });
    },
    [setAudioEffects]
  );

  const updatePreamp = useCallback((value: number) => {
    draftPreampRef.current = value;
    setDraftPreamp(value);
  }, []);

  const commitPreamp = useCallback(
    (value: number) => {
      draftPreampRef.current = value;
      setDraftPreamp(value);
      setAudioEffects({ preampDb: value });
    },
    [setAudioEffects]
  );

  const resetEqualizer = useCallback(() => {
    setAudioEffects({ equalizerBands: EQUALIZER_BAND_FREQUENCIES.map(() => 0) });
  }, [setAudioEffects]);

  const applyPreset = useCallback(
    (bands: readonly number[]) => {
      const next = [...bands];
      draftBandsRef.current = next;
      setDraftBands(next);
      setAudioEffects({ equalizerBands: next, equalizerEnabled: true });
    },
    [setAudioEffects]
  );

  const openSavePreset = useCallback(() => {
    setPresetName('');
    setPresetModalVisible(true);
  }, []);

  const closeSavePreset = useCallback(() => {
    setPresetModalVisible(false);
    setPresetName('');
  }, []);

  const savePreset = useCallback(() => {
    const name = normalizePresetName(presetName);
    if (!name) return;

    const existingIndex = customPresets.findIndex(
      (preset) => preset.name.toLowerCase() === name.toLowerCase()
    );

    let nextPresets: EqualizerPreset[];
    if (existingIndex >= 0) {
      nextPresets = customPresets.map((preset, index) =>
        index === existingIndex
          ? { ...preset, name, bands: [...draftBandsRef.current] }
          : preset
      );
    } else {
      if (customPresets.length >= MAX_CUSTOM_PRESETS) {
        Alert.alert(
          t('audioEffects.preset_limit_title'),
          t('audioEffects.preset_limit_msg', { count: MAX_CUSTOM_PRESETS })
        );
        return;
      }
      nextPresets = [
        ...customPresets,
        {
          id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          bands: [...draftBandsRef.current],
        },
      ];
    }

    setAudioEffects({ customPresets: nextPresets });
    closeSavePreset();
  }, [closeSavePreset, customPresets, presetName, setAudioEffects, t]);

  const confirmDeletePreset = useCallback(
    (preset: EqualizerPreset) => {
      Alert.alert(
        t('audioEffects.preset_delete_title'),
        t('audioEffects.preset_delete_msg', { name: preset.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              setAudioEffects({
                customPresets: customPresets.filter((item) => item.id !== preset.id),
              });
            },
          },
        ]
      );
    },
    [customPresets, setAudioEffects, t]
  );

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

          <View style={styles.presetHeader}>
            <Text style={styles.rowLabel}>{t('audioEffects.presets')}</Text>
            <TouchableOpacity
              style={[styles.savePresetBtn, !equalizerSupported && styles.disabledBtn]}
              onPress={openSavePreset}
              disabled={!equalizerSupported}
              activeOpacity={0.7}
              accessibilityRole="button">
              <Ionicons
                name="add"
                size={14}
                color={equalizerSupported ? theme.primary : '#52525b'}
              />
              <Text
                style={[
                  styles.savePresetBtnText,
                  { color: equalizerSupported ? theme.primary : '#52525b' },
                ]}>
                {t('audioEffects.save_preset')}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.rowHint}>
            {t('audioEffects.active_preset', {
              name: activePreset ? activePreset.label : t('audioEffects.preset_custom'),
            })}
          </Text>
          <View style={styles.chipsWrap}>
            {builtInPresets.map((preset) => {
              const active = activePreset?.id === preset.id;
              return (
                <TouchableOpacity
                  key={preset.id}
                  activeOpacity={0.7}
                  disabled={!equalizerSupported}
                  onPress={() => applyPreset(preset.bands)}
                  style={[
                    styles.chip,
                    active && { backgroundColor: theme.primary, borderColor: theme.primary },
                    !equalizerSupported && styles.disabledChip,
                  ]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {customPresets.map((preset) => {
              const active = activePreset?.id === preset.id;
              return (
                <TouchableOpacity
                  key={preset.id}
                  activeOpacity={0.7}
                  disabled={!equalizerSupported}
                  onPress={() => applyPreset(preset.bands)}
                  onLongPress={() => confirmDeletePreset(preset)}
                  delayLongPress={450}
                  style={[
                    styles.chip,
                    styles.customChip,
                    active && { backgroundColor: theme.primary, borderColor: theme.primary },
                    !equalizerSupported && styles.disabledChip,
                  ]}>
                  <Ionicons
                    name="bookmark-outline"
                    size={12}
                    color={active ? '#ffffff' : '#a1a1aa'}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {preset.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {customPresets.length > 0 ? (
            <Text style={styles.presetHint}>{t('audioEffects.preset_delete_hint')}</Text>
          ) : null}

          <View style={styles.sliders}>
            {bandLabels.map((label, index) => {
              const value = draftBands[index] ?? 0;
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
                    onSlidingComplete={(next) => commitBand(index, next)}
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
                {formatDb(draftPreamp)}
              </Text>
            </View>
            <ValueSlider
              value={draftPreamp}
              min={PREAMP_MIN_DB}
              max={PREAMP_MAX_DB}
              step={0.5}
              accentColor={theme.primary}
              onChange={updatePreamp}
              onSlidingComplete={commitPreamp}
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

      <Modal
        visible={presetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeSavePreset}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('audioEffects.save_preset_title')}</Text>
            <TextInput
              value={presetName}
              onChangeText={setPresetName}
              placeholder={t('audioEffects.preset_name_placeholder')}
              placeholderTextColor="#71717a"
              style={styles.modalInput}
              maxLength={PRESET_NAME_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={savePreset}
              selectionColor={theme.primary}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={closeSavePreset}
                activeOpacity={0.7}
                accessibilityRole="button">
                <Text style={styles.modalBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalSaveBtn,
                  { backgroundColor: theme.primary },
                  !presetName.trim() && styles.disabledBtn,
                ]}
                onPress={savePreset}
                disabled={!presetName.trim()}
                activeOpacity={0.7}
                accessibilityRole="button">
                <Text style={styles.modalSaveBtnText}>{t('audioEffects.save_preset')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disabledChip: {
    opacity: 0.5,
  },
  presetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  savePresetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  savePresetBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  presetHint: {
    color: '#71717a',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#18181b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 18,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalInput: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#121212',
    color: '#ffffff',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
  },
  modalBtnText: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '600',
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
  },
  modalSaveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
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

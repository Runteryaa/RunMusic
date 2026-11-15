import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '../../store/useThemeStore';
import { useConnectionsStore } from '../../store/useConnectionsStore';
import { useTranslation } from '../../services/i18n';
import {
  buildAuthUrl,
  requestAuthToken,
  requestSession,
  resolveLastFmCredentials,
} from '../../services/connections/lastfm';
import {
  LISTENBRAINZ_TOKEN_URL,
  validateToken,
} from '../../services/connections/listenbrainz';
import {
  clearQueue,
  getQueueSize,
} from '../../services/connections/scrobbleQueue';
import { flushScrobbles } from '../../services/connections/scrobbleService';

/**
 * Ayarlar → Bağlantılar.
 *
 * Uygulamanın kendi istatistiklerinden bilinçli olarak ayrıdır: burada kurulan
 * bağlantılar yalnızca dış servislere veri gönderir, yerel istatistiklere
 * hiçbir şey yazmaz ve onlardan hiçbir şey okumaz.
 */

type ServiceKey = 'lastfm' | 'listenbrainz';

function statusColor(connected: boolean): string {
  return connected ? '#10b981' : '#71717a';
}

export function ConnectionsSection() {
  const theme = useThemeStore((s) => s.theme);
  const { t } = useTranslation();
  const [openService, setOpenService] = useState<ServiceKey | null>(null);

  const lastfmUsername = useConnectionsStore((s) => s.lastfm.username);
  const listenbrainzUsername = useConnectionsStore((s) => s.listenbrainz.username);
  const activeCount = (lastfmUsername ? 1 : 0) + (listenbrainzUsername ? 1 : 0);

  const rows: {
    key: ServiceKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    brandColor: string;
    username: string | null;
  }[] = [
    { key: 'lastfm', label: 'Last.fm', icon: 'musical-note', brandColor: '#d51007', username: lastfmUsername },
    { key: 'listenbrainz', label: 'ListenBrainz', icon: 'radio', brandColor: '#eb743b', username: listenbrainzUsername },
  ];

  return (
    <>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {activeCount > 0
            ? t('connections.subtitle_active', { count: activeCount })
            : t('connections.subtitle_off')}
        </Text>
      </View>

      {rows.map((row) => (
        <TouchableOpacity
          key={row.key}
          style={styles.serviceRow}
          activeOpacity={0.7}
          onPress={() => setOpenService(row.key)}>
          <View style={[styles.serviceIcon, { backgroundColor: `${row.brandColor}22` }]}>
            <Ionicons name={row.icon} size={17} color={row.brandColor} />
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceLabel}>{row.label}</Text>
            <View style={styles.serviceStatusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(Boolean(row.username)) }]} />
              <Text style={styles.serviceStatus} numberOfLines={1}>
                {row.username
                  ? t('connections.status_connected', { name: row.username })
                  : t('connections.status_disconnected')}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#71717a" />
        </TouchableOpacity>
      ))}

      <PendingQueueFooter themePrimary={theme.primary} />

      <ConnectionSheet
        service={openService}
        onClose={() => setOpenService(null)}
      />
    </>
  );
}

/** Kuyrukta bekleyen kayıt sayısı + elle gönderme. */
function PendingQueueFooter({ themePrimary }: { themePrimary: string }) {
  const { t } = useTranslation();
  const [count, setCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const anyEnabled = useConnectionsStore(
    (s) => Boolean(s.lastfm.sessionKey || s.listenbrainz.token)
  );

  const refresh = useCallback(() => {
    void getQueueSize().then(setCount).catch(() => {});
  }, []);

  useEffect(() => {
    if (!anyEnabled) return;
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [anyEnabled, refresh]);

  if (!anyEnabled) return null;

  const handleSendNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await flushScrobbles();
      const remaining = await getQueueSize();
      setCount(remaining);
      Alert.alert(
        t('connections.queue_title'),
        remaining > 0
          ? t('connections.pending', { count: remaining })
          : t('connections.queue_sent')
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    Alert.alert(t('connections.clear_queue'), t('connections.clear_queue_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('connections.clear_queue'),
        style: 'destructive',
        onPress: () => {
          void clearQueue().then(() => setCount(0));
        },
      },
    ]);
  };

  return (
    <View style={styles.queueFooter}>
      <Text style={styles.queueText}>
        {count > 0 ? t('connections.pending', { count }) : t('connections.pending_none')}
      </Text>
      <View style={styles.queueActions}>
        <TouchableOpacity onPress={handleSendNow} disabled={busy} hitSlop={8}>
          {busy ? (
            <ActivityIndicator size="small" color={themePrimary} />
          ) : (
            <Text style={[styles.queueActionText, { color: themePrimary }]}>
              {t('connections.send_now')}
            </Text>
          )}
        </TouchableOpacity>
        {count > 0 ? (
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={[styles.queueActionText, { color: '#71717a' }]}>
              {t('connections.clear_queue')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function ConnectionSheet({
  service,
  onClose,
}: {
  service: ServiceKey | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);

  return (
    <Modal
      visible={service !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.sheetHandle} />
          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled">
            {service === 'lastfm' ? (
              <LastFmPanel theme={theme} onClose={onClose} />
            ) : service === 'listenbrainz' ? (
              <ListenBrainzPanel theme={theme} onClose={onClose} />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type Theme = ReturnType<typeof useThemeStore.getState>['theme'];

function LastFmPanel({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const lastfm = useConnectionsStore((s) => s.lastfm);
  const customApiKey = useConnectionsStore((s) => s.lastfmCustomApiKey);
  const customSecret = useConnectionsStore((s) => s.lastfmCustomSecret);
  const error = useConnectionsStore((s) => s.lastfmError);
  const connect = useConnectionsStore((s) => s.connectLastFm);
  const disconnect = useConnectionsStore((s) => s.disconnectLastFm);
  const setOptions = useConnectionsStore((s) => s.setLastFmOptions);
  const setCustomCredentials = useConnectionsStore((s) => s.setLastFmCustomCredentials);

  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<'start' | 'finish' | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(customApiKey || '');
  const [secretDraft, setSecretDraft] = useState(customSecret || '');

  const credentials = resolveLastFmCredentials(customApiKey, customSecret);

  const handleStart = async () => {
    if (busy) return;
    setBusy('start');
    try {
      const token = await requestAuthToken(credentials);
      setPendingToken(token);
      await WebBrowser.openBrowserAsync(buildAuthUrl(credentials.apiKey, token));
    } catch (e) {
      Alert.alert(t('connections.lastfm'), e instanceof Error ? e.message : t('connections.error_generic'));
    } finally {
      setBusy(null);
    }
  };

  const handleFinish = async () => {
    if (!pendingToken || busy) return;
    setBusy('finish');
    try {
      const session = await requestSession(credentials, pendingToken);
      connect(session.username, session.sessionKey);
      setPendingToken(null);
      Alert.alert(
        t('connections.connected_title'),
        t('connections.lb_connected_msg', { name: session.username })
      );
      onClose();
    } catch (e) {
      Alert.alert(t('connections.lastfm'), e instanceof Error ? e.message : t('connections.error_generic'));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(t('connections.disconnect'), t('connections.disconnect_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('connections.disconnect'),
        style: 'destructive',
        onPress: () => {
          disconnect();
          onClose();
        },
      },
    ]);
  };

  const connected = Boolean(lastfm.sessionKey);

  return (
    <View>
      <View style={styles.sheetHeader}>
        <View style={[styles.serviceIcon, { backgroundColor: '#d5100722' }]}>
          <Ionicons name="musical-note" size={17} color="#d51007" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>Last.fm</Text>
          <Text style={styles.sheetSubtitle} numberOfLines={1}>
            {connected && lastfm.username
              ? t('connections.status_connected', { name: lastfm.username })
              : t('connections.status_disconnected')}
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {connected ? (
        <View>
          <SwitchRow
            theme={theme}
            label={t('connections.now_playing')}
            hint={t('connections.now_playing_hint')}
            value={lastfm.nowPlaying}
            onChange={(v) => setOptions({ nowPlaying: v })}
          />
          <SwitchRow
            theme={theme}
            label={t('connections.scrobble')}
            hint={t('connections.scrobble_hint')}
            value={lastfm.scrobble}
            onChange={(v) => setOptions({ scrobble: v })}
          />
          <TouchableOpacity style={styles.dangerButton} onPress={handleDisconnect} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={16} color="#ef4444" />
            <Text style={styles.dangerButtonText}>{t('connections.disconnect')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.bodyText}>{t('connections.lastfm_help')}</Text>

          {pendingToken ? (
            <View style={styles.stepBox}>
              <Text style={styles.stepText}>{t('connections.lastfm_waiting')}</Text>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.primary }]}
                onPress={handleFinish}
                activeOpacity={0.8}
                disabled={busy !== null}>
                {busy === 'finish' ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>{t('connections.lastfm_confirm')}</Text>
                )}
              </TouchableOpacity>
              <View style={styles.inlineActions}>
                <TouchableOpacity
                  onPress={() =>
                    WebBrowser.openBrowserAsync(buildAuthUrl(credentials.apiKey, pendingToken))
                  }
                  hitSlop={8}>
                  <Text style={[styles.linkText, { color: theme.primary }]}>
                    {t('connections.lastfm_reopen')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPendingToken(null)} hitSlop={8}>
                  <Text style={[styles.linkText, { color: '#a1a1aa' }]}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.primary }]}
              onPress={handleStart}
              activeOpacity={0.8}
              disabled={busy !== null}>
              {busy === 'start' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>{t('connections.connect')}</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setShowAdvanced((v) => !v)}
            activeOpacity={0.7}>
            <Text style={styles.advancedToggleText}>{t('connections.lastfm_advanced')}</Text>
            <Ionicons
              name={showAdvanced ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#71717a"
            />
          </TouchableOpacity>

          {showAdvanced ? (
            <View style={styles.advancedBox}>
              <Text style={styles.advancedHint}>{t('connections.lastfm_advanced_hint')}</Text>
              <TextInput
                style={styles.input}
                value={apiKeyDraft}
                onChangeText={setApiKeyDraft}
                placeholder={t('connections.lastfm_api_key')}
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={secretDraft}
                onChangeText={setSecretDraft}
                placeholder={t('connections.lastfm_shared_secret')}
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <View style={styles.inlineActions}>
                <TouchableOpacity
                  onPress={() => {
                    setCustomCredentials(apiKeyDraft.trim(), secretDraft.trim());
                    Alert.alert(t('connections.lastfm'), t('connections.saved'));
                  }}
                  hitSlop={8}>
                  <Text style={[styles.linkText, { color: theme.primary }]}>
                    {t('connections.save')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setApiKeyDraft('');
                    setSecretDraft('');
                    setCustomCredentials(null, null);
                  }}
                  hitSlop={8}>
                  <Text style={[styles.linkText, { color: '#a1a1aa' }]}>
                    {t('connections.reset')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function ListenBrainzPanel({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const listenbrainz = useConnectionsStore((s) => s.listenbrainz);
  const error = useConnectionsStore((s) => s.listenbrainzError);
  const connect = useConnectionsStore((s) => s.connectListenBrainz);
  const disconnect = useConnectionsStore((s) => s.disconnectListenBrainz);
  const setOptions = useConnectionsStore((s) => s.setListenBrainzOptions);
  const setError = useConnectionsStore((s) => s.setListenBrainzError);

  const [tokenDraft, setTokenDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const connected = Boolean(listenbrainz.token);

  const handleConnect = async () => {
    const token = tokenDraft.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await validateToken(token);
      if (!result.valid || !result.username) {
        setError(t('connections.token_invalid'));
        return;
      }
      connect(result.username, token);
      setTokenDraft('');
      Alert.alert(
        t('connections.connected_title'),
        t('connections.lb_connected_msg', { name: result.username })
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connections.error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(t('connections.disconnect'), t('connections.disconnect_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('connections.disconnect'),
        style: 'destructive',
        onPress: () => {
          disconnect();
          onClose();
        },
      },
    ]);
  };

  return (
    <View>
      <View style={styles.sheetHeader}>
        <View style={[styles.serviceIcon, { backgroundColor: '#eb743b22' }]}>
          <Ionicons name="radio" size={17} color="#eb743b" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>ListenBrainz</Text>
          <Text style={styles.sheetSubtitle} numberOfLines={1}>
            {connected && listenbrainz.username
              ? t('connections.status_connected', { name: listenbrainz.username })
              : t('connections.status_disconnected')}
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {connected ? (
        <View>
          <SwitchRow
            theme={theme}
            label={t('connections.now_playing')}
            hint={t('connections.now_playing_hint')}
            value={listenbrainz.nowPlaying}
            onChange={(v) => setOptions({ nowPlaying: v })}
          />
          <SwitchRow
            theme={theme}
            label={t('connections.scrobble')}
            hint={t('connections.scrobble_hint')}
            value={listenbrainz.scrobble}
            onChange={(v) => setOptions({ scrobble: v })}
          />
          <TouchableOpacity style={styles.dangerButton} onPress={handleDisconnect} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={16} color="#ef4444" />
            <Text style={styles.dangerButtonText}>{t('connections.disconnect')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.bodyText}>{t('connections.listenbrainz_help')}</Text>
          <Text style={styles.fieldLabel}>{t('connections.listenbrainz_token')}</Text>
          <TextInput
            style={styles.input}
            value={tokenDraft}
            onChangeText={setTokenDraft}
            placeholder={t('connections.listenbrainz_token_hint')}
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <View style={styles.inlineActions}>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync(LISTENBRAINZ_TOKEN_URL)}
              hitSlop={8}>
              <Text style={[styles.linkText, { color: theme.primary }]}>
                {t('connections.listenbrainz_get_token')}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: theme.primary, opacity: tokenDraft.trim() ? 1 : 0.5 },
            ]}
            onPress={handleConnect}
            activeOpacity={0.8}
            disabled={busy || !tokenDraft.trim()}>
            {busy ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>{t('connections.listenbrainz_verify')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function SwitchRow({
  theme,
  label,
  hint,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {hint ? <Text style={styles.switchHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#3f3f46', true: theme.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 8,
  },
  summaryText: {
    fontSize: 12,
    color: '#71717a',
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a55',
  },
  serviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  serviceText: {
    flex: 1,
  },
  serviceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  serviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  serviceStatus: {
    fontSize: 12,
    color: '#71717a',
    flexShrink: 1,
  },
  queueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  queueText: {
    fontSize: 12,
    color: '#71717a',
    flexShrink: 1,
  },
  queueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginLeft: 12,
  },
  queueActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 2,
  },
  bodyText: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 19,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
    marginBottom: 12,
    lineHeight: 17,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a55',
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  switchHint: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 3,
    lineHeight: 16,
  },
  primaryButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef444455',
    justifyContent: 'center',
  },
  dangerButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 12,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepBox: {
    backgroundColor: '#ffffff08',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  stepText: {
    fontSize: 13,
    color: '#d4d4d8',
    lineHeight: 19,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 6,
  },
  advancedToggleText: {
    fontSize: 12,
    color: '#71717a',
    fontWeight: '600',
  },
  advancedBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#09090b',
  },
  advancedHint: {
    fontSize: 11,
    color: '#71717a',
    lineHeight: 16,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#09090b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 8,
  },
});

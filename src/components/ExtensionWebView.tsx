import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { generateInjectedJavaScript, handleBridgeMessage } from '../services/extensionBridge';
import type { InstalledExtension } from '../types/extension';

interface ExtensionWebViewProps {
  extension: InstalledExtension;
}

export const ExtensionWebView: React.FC<ExtensionWebViewProps> = ({ extension }) => {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const webViewRef = useRef<WebView>(null);
  const isLoadedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const injectedJS = useMemo(() => {
    return generateInjectedJavaScript(extension.manifest.id, theme);
  }, [extension.manifest.id, theme]);

  // Uygulama teması değiştiğinde açık olan WebView içine anında bildir
  useEffect(() => {
    if (!isLoadedRef.current || !webViewRef.current) return;
    const themePayload = {
      primary: theme.primary,
      background: '#121212',
      cardBackground: '#1e1e1e',
      text: '#ffffff',
      isDark: true,
    };
    const js = `
      if (window.RunMusic && typeof window.RunMusic._handleEvent === 'function') {
        window.RunMusic._handleEvent('themeChange', ${JSON.stringify(themePayload)});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [theme.primary]);

  const handleMessage = (event: any) => {
    const rawData = event.nativeEvent?.data;
    if (!rawData) return;

    handleBridgeMessage(rawData, extension, (jsCode) => {
      webViewRef.current?.injectJavaScript(jsCode);
    });
  };

  const webSourceUri = useMemo(() => {
    const rawUrl = extension.manifest.page || extension.manifest.entryUrl || '';
    if (!rawUrl) return '';
    const updateTime = extension.updatedAt || extension.installedAt || 0;
    try {
      const parsed = new URL(rawUrl);
      parsed.searchParams.set('v', extension.manifest.version || '1.0.0');
      if (updateTime) {
        parsed.searchParams.set('_t', String(updateTime));
      }
      return parsed.toString();
    } catch {
      const sep = rawUrl.includes('?') ? '&' : '?';
      return `${rawUrl}${sep}v=${extension.manifest.version || '1.0.0'}&_t=${updateTime}`;
    }
  }, [
    extension.manifest.page,
    extension.manifest.entryUrl,
    extension.manifest.version,
    extension.updatedAt,
    extension.installedAt,
  ]);

  const handleReload = () => {
    setHasError(false);
    setIsLoading(true);
    isLoadedRef.current = false;
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      <WebView
        key={webSourceUri}
        ref={webViewRef}
        source={{ uri: webSourceUri }}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={handleMessage}
        onLoadStart={() => {
          setIsLoading(true);
          setHasError(false);
        }}
        onLoadEnd={() => {
          setIsLoading(false);
          isLoadedRef.current = true;
          // Sayfa ilk yüklendiğinde güncel temayı WebView içine gönder
          const themePayload = {
            primary: theme.primary,
            background: '#121212',
            cardBackground: '#1e1e1e',
            text: '#ffffff',
            isDark: true,
          };
          const js = `
            if (window.RunMusic && typeof window.RunMusic._handleEvent === 'function') {
              window.RunMusic._handleEvent('themeChange', ${JSON.stringify(themePayload)});
            }
            true;
          `;
          webViewRef.current?.injectJavaScript(js);
        }}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setIsLoading(false);
          setHasError(true);
          setErrorMessage(nativeEvent.description || t('extensions.page_load_failed'));
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={['*']}
        style={styles.webView}
      />

      {/* Loading Overlay */}
      {isLoading && !hasError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>{t('extensions.loading_named', { name: extension.manifest.name })}</Text>
        </View>
      )}

      {/* Error Overlay */}
      {hasError && (
        <View style={styles.errorOverlay}>
          <Ionicons name="cloud-offline-outline" size={54} color="#71717a" />
          <Text style={styles.errorTitle}>{t('extensions.connection_error')}</Text>
          <Text style={styles.errorSubtitle}>
            {errorMessage || t('extensions.connection_error_desc')}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: theme.primary }]}
            onPress={handleReload}
          >
            <Ionicons name="refresh" size={18} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  webView: {
    flex: 1,
    backgroundColor: '#121212',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 14,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    zIndex: 11,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

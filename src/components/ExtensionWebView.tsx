import React, { useRef, useState, useMemo } from 'react';
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
import { generateInjectedJavaScript, handleBridgeMessage } from '../services/extensionBridge';
import type { InstalledExtension } from '../types/extension';

interface ExtensionWebViewProps {
  extension: InstalledExtension;
}

export const ExtensionWebView: React.FC<ExtensionWebViewProps> = ({ extension }) => {
  const theme = useThemeStore((s) => s.theme);
  const webViewRef = useRef<WebView>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const injectedJS = useMemo(() => {
    return generateInjectedJavaScript(extension.manifest.id);
  }, [extension.manifest.id]);

  const handleMessage = (event: any) => {
    const rawData = event.nativeEvent?.data;
    if (!rawData) return;

    handleBridgeMessage(rawData, extension, (jsCode) => {
      webViewRef.current?.injectJavaScript(jsCode);
    });
  };

  const handleReload = () => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: extension.manifest.entryUrl }}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={handleMessage}
        onLoadStart={() => {
          setIsLoading(true);
          setHasError(false);
        }}
        onLoadEnd={() => {
          setIsLoading(false);
        }}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setIsLoading(false);
          setHasError(true);
          setErrorMessage(nativeEvent.description || 'Sayfa yüklenemedi.');
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
          <Text style={styles.loadingText}>{extension.manifest.name} yükleniyor...</Text>
        </View>
      )}

      {/* Error Overlay */}
      {hasError && (
        <View style={styles.errorOverlay}>
          <Ionicons name="cloud-offline-outline" size={54} color="#71717a" />
          <Text style={styles.errorTitle}>Bağlantı Hatası</Text>
          <Text style={styles.errorSubtitle}>
            {errorMessage || 'Eklenti web adresi açılamadı. Lütfen internet bağlantınızı kontrol edin.'}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: theme.primary }]}
            onPress={handleReload}
          >
            <Ionicons name="refresh" size={18} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.retryBtnText}>Yeniden Dene</Text>
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

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { udpDiscoveryService } from '../services/remote/udpDiscovery';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import { RUNMUSIC_TCP_PORT, type DiscoveredHost } from '../services/remote/remoteTypes';

interface DeviceSelectorModalProps {
  visible: boolean;
  onClose: () => void;
}

export function DeviceSelectorModal({ visible, onClose }: DeviceSelectorModalProps) {
  const theme = useThemeStore((s) => s.theme);
  const mode = useRemoteConnectStore((s) => s.mode);
  const connectionStatus = useRemoteConnectStore((s) => s.connectionStatus);
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const discoveredHosts = useRemoteConnectStore((s) => s.discoveredHosts);
  const setDiscoveredHosts = useRemoteConnectStore((s) => s.setDiscoveredHosts);

  const [showManualIp, setShowManualIp] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState(RUNMUSIC_TCP_PORT.toString());

  useEffect(() => {
    if (!visible) return;

    // Start discovering devices over UDP while modal is open
    const unsubscribe = udpDiscoveryService.startClientListener((hosts) => {
      setDiscoveredHosts(hosts);
    });

    return () => {
      unsubscribe();
    };
  }, [visible, setDiscoveredHosts]);

  const handleSelectLocal = () => {
    if (mode === 'client') {
      remoteSyncManager.disconnectClient();
    }
    onClose();
  };

  const handleSelectHost = async (host: DiscoveredHost) => {
    await remoteSyncManager.connectToHost(host);
    // Keep modal open while pairing so user can see progress or PIN prompt
  };

  const handleManualConnect = async () => {
    const ip = manualIp.trim();
    if (!ip) return;

    const port = parseInt(manualPort.trim(), 10) || RUNMUSIC_TCP_PORT;
    const manualHost: DiscoveredHost = {
      deviceId: `manual_${ip}`,
      deviceName: `Cihaz (${ip})`,
      hostIp: ip,
      port,
      lastSeen: Date.now(),
    };

    setShowManualIp(false);
    await remoteSyncManager.connectToHost(manualHost);
  };

  const isConnectedToRemote = mode === 'client' && connectionStatus === 'connected';

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { borderColor: theme.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="radio" size={24} color={theme.primary} />
              <Text style={styles.title}>Cihaza Bağlan</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>

          {/* Current / Local Device Item */}
          <TouchableOpacity
            style={[
              styles.deviceItem,
              !isConnectedToRemote && styles.activeDeviceItem,
              { borderColor: !isConnectedToRemote ? theme.primary : theme.border },
            ]}
            onPress={handleSelectLocal}
            activeOpacity={0.7}
          >
            <View style={[styles.deviceIcon, { backgroundColor: !isConnectedToRemote ? theme.primary + '25' : 'rgba(255,255,255,0.06)' }]}>
              <Ionicons
                name="phone-portrait-outline"
                size={22}
                color={!isConnectedToRemote ? theme.primary : 'rgba(255,255,255,0.7)'}
              />
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>Bu Telefon</Text>
              <Text style={styles.deviceSubtitle}>
                {!isConnectedToRemote ? 'Şu anda çalıyor' : 'Yerel oynatıcıya dön'}
              </Text>
            </View>
            {!isConnectedToRemote && (
              <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
            )}
          </TouchableOpacity>

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionTitle}>AYNI Wİ-Fİ AĞINDAKİ CİHAZLAR</Text>
          </View>

          {/* Discovered Wi-Fi Hosts List */}
          {discoveredHosts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={theme.primary} style={{ marginBottom: 8 }} />
              <Text style={styles.emptyText}>Wi-Fi ağındaki RunMusic cihazları aranıyor...</Text>
              <Text style={styles.emptySubtext}>
                Diğer cihazda Ayarlar &gt; RunMusic Connect özelliğinin açık olduğundan emin olun.
              </Text>
            </View>
          ) : (
            <FlatList
              data={discoveredHosts}
              keyExtractor={(item) => item.deviceId}
              style={styles.list}
              renderItem={({ item }) => {
                const isThisHostConnected =
                  isConnectedToRemote && connectedDeviceName === item.deviceName;
                const isConnecting =
                  mode === 'client' &&
                  (connectionStatus === 'connecting' || connectionStatus === 'pairing') &&
                  connectedDeviceName === item.deviceName;

                return (
                  <TouchableOpacity
                    style={[
                      styles.deviceItem,
                      isThisHostConnected && styles.activeDeviceItem,
                      { borderColor: isThisHostConnected ? theme.primary : theme.border },
                    ]}
                    onPress={() => handleSelectHost(item)}
                    disabled={isThisHostConnected || isConnecting}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.deviceIcon,
                        {
                          backgroundColor: isThisHostConnected
                            ? theme.primary + '25'
                            : 'rgba(255,255,255,0.06)',
                        },
                      ]}
                    >
                      <Ionicons
                        name="wifi"
                        size={20}
                        color={isThisHostConnected ? theme.primary : 'rgba(255,255,255,0.7)'}
                      />
                    </View>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>{item.deviceName}</Text>
                      <Text style={styles.deviceSubtitle}>{item.hostIp}:{item.port}</Text>
                    </View>

                    {isThisHostConnected ? (
                      <TouchableOpacity
                        style={[styles.disconnectBadge, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}
                        onPress={() => remoteSyncManager.disconnectClient()}
                      >
                        <Text style={styles.disconnectBadgeText}>Bağlantıyı Kes</Text>
                      </TouchableOpacity>
                    ) : isConnecting ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {/* Manual IP Fallback */}
          {showManualIp ? (
            <View style={[styles.manualBox, { borderColor: theme.border }]}>
              <Text style={styles.manualTitle}>IP Adresiyle Bağlan</Text>
              <View style={styles.manualRow}>
                <TextInput
                  style={[styles.manualInput, { borderColor: theme.border, flex: 2 }]}
                  value={manualIp}
                  onChangeText={setManualIp}
                  placeholder="192.168.1.50"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numbers-and-punctuation"
                  autoFocus
                />
                <TextInput
                  style={[styles.manualInput, { borderColor: theme.border, flex: 1 }]}
                  value={manualPort}
                  onChangeText={setManualPort}
                  placeholder="8945"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.manualActions}>
                <TouchableOpacity
                  style={[styles.manualBtn, { borderColor: theme.border, borderWidth: 1 }]}
                  onPress={() => setShowManualIp(false)}
                >
                  <Text style={styles.manualBtnText}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.manualBtn, { backgroundColor: theme.primary }]}
                  onPress={handleManualConnect}
                >
                  <Text style={[styles.manualBtnText, { color: '#FFFFFF', fontWeight: 'bold' }]}>
                    Bağlan
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.manualTriggerBtn}
              onPress={() => setShowManualIp(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="link-outline" size={18} color={theme.primary} />
              <Text style={[styles.manualTriggerText, { color: theme.primary }]}>
                IP Adresi ile Manuel Bağlan
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeBtn: {
    padding: 4,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#121214',
    borderWidth: 1,
    marginBottom: 10,
  },
  activeDeviceItem: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  deviceIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  deviceSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  disconnectBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  disconnectBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  sectionDivider: {
    marginTop: 12,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.4)',
  },
  list: {
    maxHeight: 220,
  },
  emptyContainer: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
  },
  manualTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
    marginTop: 8,
  },
  manualTriggerText: {
    fontSize: 14,
    fontWeight: '600',
  },
  manualBox: {
    backgroundColor: '#121214',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  manualTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 10,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  manualInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  manualActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  manualBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  manualBtnText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
});

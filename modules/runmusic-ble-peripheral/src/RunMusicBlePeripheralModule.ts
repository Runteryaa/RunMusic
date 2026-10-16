import { NativeModule, requireNativeModule } from 'expo';

export interface BlePeripheralEvents {
  onClientConnected: (event: { deviceAddress: string }) => void;
  onClientDisconnected: (event: { deviceAddress: string }) => void;
  onCharacteristicWrite: (event: {
    uuid: string;
    valueBase64: string;
    deviceAddress: string;
  }) => void;
  onNotificationSent: (event: { status: number }) => void;
  [key: string]: any;
}

declare class RunMusicBlePeripheralModuleType extends NativeModule<BlePeripheralEvents> {
  isSupported(): boolean;
  setCustomDeviceName(name: string): void;
  startAdvertising(deviceName: string): Promise<boolean>;
  stopAdvertising(): Promise<boolean>;
  sendNotification(characteristicUuid: string, valueBase64: string): Promise<boolean>;
}

let peripheralModule: RunMusicBlePeripheralModuleType | null = null;
try {
  peripheralModule = requireNativeModule<RunMusicBlePeripheralModuleType>('RunMusicBlePeripheral');
} catch (e) {
  console.warn('[RunMusicBlePeripheral] Native module not available (e.g. on web or unsupported):', e);
}

export default peripheralModule;
